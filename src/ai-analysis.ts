import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PNG } from 'pngjs';
import {
  buildAnalysisPrompt,
  parseAIResponse,
  type AIAnalysisResult,
  type ChangeCategory,
  type Recommendation,
  type Severity,
  type DomDiffContext,
} from './domain/ai-prompt.js';
import {
  type AIProvider,
  type AIProviderName,
  createAnalysisResult,
  createAnthropicProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createGoogleProvider,
} from './adapters/index.js';

export type { AIAnalysisResult, ChangeCategory, Severity, Recommendation };
export type { AIProviderName as AIProvider };

export interface AIAnalysisOptions {
  provider: AIProviderName;
  apiKey?: string;
  authToken?: string;
  model?: string;
  baseUrl?: string;
  scenarioName?: string;
  url?: string;
  pixelDiff?: number;
  diffPercentage?: number;
  ssimScore?: number;
  domDiff?: DomDiffContext;
  visionCompare?: AIVisionCompareOptions;
}

export interface AIVisionCompareOptions {
  enabled?: boolean;
  chunks?: number;
  minImageHeight?: number;
  maxVerticalAlignShift?: number;
  includeDiffImage?: boolean;
}

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  anthropic: 'claude-haiku-4-5-20241022',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-3-flash-preview',
  google: 'gemini-3-flash',
};

const DEFAULT_VISION_COMPARE: Required<AIVisionCompareOptions> = {
  enabled: true,
  chunks: 6,
  minImageHeight: 1800,
  maxVerticalAlignShift: 220,
  includeDiffImage: false,
};

interface VisionChunk {
  index: number;
  y: number;
  height: number;
  baselineY: number;
  testY: number;
  alignedHeight: number;
  baselinePath: string;
  testPath: string;
  diffPath?: string;
}

interface PreparedChunking {
  chunked: boolean;
  chunks: VisionChunk[];
  verticalOffset: number;
  reason?: string;
  chunkDir?: string;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeVisionCompareOptions(
  input: AIVisionCompareOptions | undefined
): Required<AIVisionCompareOptions> {
  return {
    enabled: input?.enabled ?? DEFAULT_VISION_COMPARE.enabled,
    chunks: clampInt(input?.chunks ?? DEFAULT_VISION_COMPARE.chunks, 1, 12),
    minImageHeight: clampInt(
      input?.minImageHeight ?? DEFAULT_VISION_COMPARE.minImageHeight,
      400,
      12000
    ),
    maxVerticalAlignShift: clampInt(
      input?.maxVerticalAlignShift ?? DEFAULT_VISION_COMPARE.maxVerticalAlignShift,
      0,
      2000
    ),
    includeDiffImage: input?.includeDiffImage ?? DEFAULT_VISION_COMPARE.includeDiffImage,
  };
}

function ensureFileExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} image not found: ${path}`);
  }
}

function resolveModel(options: AIAnalysisOptions): string {
  return options.model || DEFAULT_MODELS[options.provider];
}

function getProvider(options: AIAnalysisOptions): AIProvider {
  switch (options.provider) {
    case 'anthropic':
      return createAnthropicProvider({ apiKey: options.apiKey, authToken: options.authToken });
    case 'openai':
      return createOpenAIProvider({ apiKey: options.apiKey });
    case 'openrouter':
      return createOpenRouterProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    case 'google':
      return createGoogleProvider({ apiKey: options.apiKey });
    default:
      throw new Error(`Unsupported AI provider: ${options.provider}`);
  }
}

function cropPng(png: PNG, y: number, height: number): PNG {
  const safeY = Math.max(0, Math.min(y, png.height - 1));
  const safeH = Math.max(1, Math.min(height, png.height - safeY));
  const out = new PNG({ width: png.width, height: safeH });

  for (let row = 0; row < safeH; row += 1) {
    const srcStart = (safeY + row) * png.width * 4;
    const srcEnd = srcStart + png.width * 4;
    const dstStart = row * png.width * 4;
    out.data.set(png.data.subarray(srcStart, srcEnd), dstStart);
  }

  return out;
}

async function readPngSafely(path?: string): Promise<PNG | null> {
  if (!path || !existsSync(path)) return null;
  try {
    const data = await readFile(path);
    return PNG.sync.read(data);
  } catch {
    return null;
  }
}

async function writePng(path: string, png: PNG): Promise<void> {
  await writeFile(path, PNG.sync.write(png));
}

function buildRowSignatureSeries(png: PNG): { luma: number; alpha: number }[] {
  const sampleStep = Math.max(1, Math.floor(png.width / 256));
  const rows = new Array<{ luma: number; alpha: number }>(png.height);

  for (let y = 0; y < png.height; y += 1) {
    let lumaSum = 0;
    let alphaSum = 0;
    let count = 0;
    for (let x = 0; x < png.width; x += sampleStep) {
      const idx = (y * png.width + x) * 4;
      const r = png.data[idx] ?? 0;
      const g = png.data[idx + 1] ?? 0;
      const b = png.data[idx + 2] ?? 0;
      const a = (png.data[idx + 3] ?? 255) / 255;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumaSum += luma * a;
      alphaSum += a;
      count += 1;
    }
    rows[y] = {
      luma: count > 0 ? lumaSum / count : 0,
      alpha: count > 0 ? alphaSum / count : 0,
    };
  }

  return rows;
}

function estimateVerticalOffset(baseline: PNG, test: PNG, requestedMaxShift: number): number {
  const safeMaxShift = Math.max(
    0,
    Math.min(requestedMaxShift, Math.floor(Math.min(baseline.height, test.height) * 0.2))
  );
  if (safeMaxShift === 0) return 0;

  const baselineRows = buildRowSignatureSeries(baseline);
  const testRows = buildRowSignatureSeries(test);
  const minOverlapRows = Math.max(120, Math.floor(Math.min(baseline.height, test.height) * 0.35));

  let bestShift = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let shift = -safeMaxShift; shift <= safeMaxShift; shift += 1) {
    const baselineStart = Math.max(0, -shift);
    const testStart = Math.max(0, shift);
    const overlap = Math.min(baseline.height - baselineStart, test.height - testStart);
    if (overlap < minOverlapRows) continue;

    let score = 0;
    for (let row = 0; row < overlap; row += 1) {
      const b = baselineRows[baselineStart + row];
      const t = testRows[testStart + row];
      score += Math.abs((b?.luma ?? 0) - (t?.luma ?? 0)) * 0.85;
      score += Math.abs((b?.alpha ?? 0) - (t?.alpha ?? 0)) * 0.15;
    }
    score /= overlap;

    if (score < bestScore || (score === bestScore && Math.abs(shift) < Math.abs(bestShift))) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return bestShift;
}

function buildChunkRanges(
  totalHeight: number,
  chunks: number
): { index: number; y: number; height: number }[] {
  if (chunks <= 1) return [{ index: 1, y: 0, height: totalHeight }];

  const ranges: { index: number; y: number; height: number }[] = [];
  const base = Math.floor(totalHeight / chunks);
  let remainder = totalHeight % chunks;
  let cursor = 0;
  for (let idx = 1; idx <= chunks; idx += 1) {
    const height = Math.max(1, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
    ranges.push({ index: idx, y: cursor, height });
    cursor += height;
  }
  return ranges.filter((range) => range.y < totalHeight);
}

function resolveAlignedRange(
  range: { y: number; height: number },
  baselineHeight: number,
  testHeight: number,
  verticalOffset: number
): { baselineY: number; testY: number; height: number } | null {
  let baselineY = range.y;
  let testY = baselineY + verticalOffset;
  let height = range.height;

  if (testY < 0) {
    const trim = -testY;
    baselineY += trim;
    height -= trim;
    testY = 0;
  }
  if (baselineY < 0) {
    const trim = -baselineY;
    testY += trim;
    height -= trim;
    baselineY = 0;
  }
  if (baselineY >= baselineHeight || testY >= testHeight) return null;

  const alignedHeight = Math.min(height, baselineHeight - baselineY, testHeight - testY);
  if (alignedHeight <= 0) return null;

  return { baselineY, testY, height: alignedHeight };
}

async function prepareChunkedImages(
  baselinePath: string,
  testPath: string,
  diffPath: string | undefined,
  vision: Required<AIVisionCompareOptions>
): Promise<PreparedChunking> {
  const baselinePng = await readPngSafely(baselinePath);
  const testPng = await readPngSafely(testPath);
  const diffPng = await readPngSafely(diffPath);

  if (!baselinePng || !testPng) {
    return {
      chunked: false,
      verticalOffset: 0,
      reason: 'Chunking disabled because baseline/test image is not PNG.',
      chunks: [
        {
          index: 1,
          y: 0,
          height: 0,
          baselineY: 0,
          testY: 0,
          alignedHeight: 0,
          baselinePath,
          testPath,
          diffPath,
        },
      ],
    };
  }

  const maxHeight = Math.max(baselinePng.height, testPng.height);
  if (!vision.enabled || vision.chunks <= 1 || maxHeight < vision.minImageHeight) {
    return {
      chunked: false,
      verticalOffset: 0,
      reason:
        maxHeight < vision.minImageHeight
          ? `Chunking disabled (height ${maxHeight}px < minImageHeight ${vision.minImageHeight}px).`
          : undefined,
      chunks: [
        {
          index: 1,
          y: 0,
          height: Math.min(baselinePng.height, testPng.height),
          baselineY: 0,
          testY: 0,
          alignedHeight: Math.min(baselinePng.height, testPng.height),
          baselinePath,
          testPath,
          diffPath,
        },
      ],
    };
  }

  const verticalOffset = estimateVerticalOffset(baselinePng, testPng, vision.maxVerticalAlignShift);
  const ranges = buildChunkRanges(baselinePng.height, vision.chunks);
  if (ranges.length <= 1) {
    return {
      chunked: false,
      verticalOffset,
      chunks: [
        {
          index: 1,
          y: 0,
          height: Math.min(baselinePng.height, testPng.height),
          baselineY: Math.max(0, verticalOffset > 0 ? 0 : -verticalOffset),
          testY: Math.max(0, verticalOffset),
          alignedHeight: Math.min(baselinePng.height, testPng.height),
          baselinePath,
          testPath,
          diffPath,
        },
      ],
    };
  }

  const chunkDir = await mkdtemp(join(tmpdir(), 'vrt-ai-chunks-'));
  const chunks: VisionChunk[] = [];

  for (const range of ranges) {
    const aligned = resolveAlignedRange(range, baselinePng.height, testPng.height, verticalOffset);
    if (!aligned) continue;

    const baselineChunkPath = join(chunkDir, `chunk-${range.index}-baseline.png`);
    const testChunkPath = join(chunkDir, `chunk-${range.index}-test.png`);
    await writePng(baselineChunkPath, cropPng(baselinePng, aligned.baselineY, aligned.height));
    await writePng(testChunkPath, cropPng(testPng, aligned.testY, aligned.height));

    let diffChunkPath: string | undefined;
    if (
      vision.includeDiffImage &&
      diffPng &&
      aligned.baselineY < diffPng.height &&
      existsSync(diffPath || '')
    ) {
      const diffHeight = Math.min(aligned.height, diffPng.height - aligned.baselineY);
      if (diffHeight > 0) {
        diffChunkPath = join(chunkDir, `chunk-${range.index}-diff.png`);
        await writePng(diffChunkPath, cropPng(diffPng, aligned.baselineY, diffHeight));
      }
    }

    chunks.push({
      index: range.index,
      y: range.y,
      height: range.height,
      baselineY: aligned.baselineY,
      testY: aligned.testY,
      alignedHeight: aligned.height,
      baselinePath: baselineChunkPath,
      testPath: testChunkPath,
      diffPath: diffChunkPath,
    });
  }

  if (chunks.length === 0) {
    return {
      chunked: false,
      chunkDir,
      verticalOffset,
      reason: 'Chunking produced no overlapping aligned regions.',
      chunks: [
        {
          index: 1,
          y: 0,
          height: Math.min(baselinePng.height, testPng.height),
          baselineY: 0,
          testY: 0,
          alignedHeight: Math.min(baselinePng.height, testPng.height),
          baselinePath,
          testPath,
          diffPath,
        },
      ],
    };
  }

  return { chunked: true, chunkDir, chunks, verticalOffset };
}

function aggregateChunkAnalyses(
  chunks: { chunk: VisionChunk; analysis: AIAnalysisResult }[],
  provider: AIProviderName,
  model: string,
  verticalOffset: number
): AIAnalysisResult {
  if (chunks.length === 1) {
    return chunks[0].analysis;
  }

  const recommendationScores: Record<Recommendation, number> = {
    approve: 1,
    review: 0,
    reject: -1,
  };
  const severityRank: Record<Severity, number> = {
    info: 0,
    warning: 1,
    critical: 2,
  };

  let weightedScore = 0;
  let weightedTotal = 0;
  let confidenceSum = 0;
  let tokensUsed = 0;
  let highestSeverity: Severity = 'info';
  let rejectCount = 0;

  const categoryWeights = new Map<ChangeCategory, number>();
  const detailLines: string[] = [];

  for (const { chunk, analysis } of chunks) {
    const confidence = Math.max(0, Math.min(1, analysis.confidence));
    weightedScore += (recommendationScores[analysis.recommendation] ?? 0) * confidence;
    weightedTotal += confidence;
    confidenceSum += confidence;
    tokensUsed += analysis.tokensUsed ?? 0;
    if (analysis.recommendation === 'reject') rejectCount += 1;
    if (severityRank[analysis.severity] > severityRank[highestSeverity]) {
      highestSeverity = analysis.severity;
    }
    categoryWeights.set(
      analysis.category,
      (categoryWeights.get(analysis.category) ?? 0) + confidence
    );
    detailLines.push(
      `Chunk ${chunk.index}: ${analysis.recommendation} (${(confidence * 100).toFixed(0)}%) - ${analysis.summary}`
    );
  }

  const averageScore = weightedTotal > 0 ? weightedScore / weightedTotal : 0;
  const avgConfidence = chunks.length > 0 ? confidenceSum / chunks.length : 0;
  let recommendation: Recommendation = 'review';
  if (averageScore >= 0.35 && rejectCount === 0) recommendation = 'approve';
  else if (averageScore <= -0.35 || rejectCount >= Math.ceil(chunks.length / 2)) {
    recommendation = 'reject';
  }
  if (recommendation === 'approve' && highestSeverity === 'critical') recommendation = 'review';

  let category: ChangeCategory = 'layout_shift';
  let bestCategoryWeight = -1;
  for (const [candidate, weight] of categoryWeights.entries()) {
    if (weight > bestCategoryWeight) {
      bestCategoryWeight = weight;
      category = candidate;
    }
  }

  const approveCount = chunks.filter((entry) => entry.analysis.recommendation === 'approve').length;
  const reviewCount = chunks.filter((entry) => entry.analysis.recommendation === 'review').length;
  const rejectChunks = chunks.length - approveCount - reviewCount;
  const summary =
    recommendation === 'approve'
      ? `Chunked AI compare approved (${approveCount}/${chunks.length} chunks).`
      : recommendation === 'reject'
        ? `Chunked AI compare rejected (${rejectChunks}/${chunks.length} chunks signaled reject).`
        : `Chunked AI compare requires review (approve:${approveCount}, review:${reviewCount}, reject:${rejectChunks}).`;

  return {
    category,
    severity: highestSeverity,
    confidence: Number(avgConfidence.toFixed(2)),
    summary,
    details: detailLines.slice(0, 12),
    recommendation,
    reasoning: `Aggregated from ${chunks.length} vertically aligned chunks (offset ${verticalOffset}px). Weighted score ${averageScore.toFixed(3)}.`,
    provider,
    model,
    tokensUsed,
  };
}

async function runSingleAnalysis(
  provider: AIProvider,
  model: string,
  baselinePath: string,
  testPath: string,
  diffPath: string | undefined,
  options: AIAnalysisOptions,
  chunkLabel?: string
): Promise<AIAnalysisResult> {
  const prompt = buildAnalysisPrompt({
    ...options,
    scenarioName: chunkLabel
      ? `${options.scenarioName ?? 'visual-compare'} [${chunkLabel}]`
      : options.scenarioName,
  });

  const response = await provider.analyze({
    images: {
      baseline: baselinePath,
      test: testPath,
      diff: diffPath && existsSync(diffPath) ? diffPath : undefined,
    },
    prompt,
    model,
  });

  const parsed = parseAIResponse(response.text);
  return createAnalysisResult(parsed, options.provider, model, response.tokensUsed);
}

/**
 * Analyze visual differences between two screenshots using AI vision.
 */
export async function analyzeWithAI(
  baselinePath: string,
  testPath: string,
  diffPath: string | undefined,
  options: AIAnalysisOptions
): Promise<AIAnalysisResult> {
  ensureFileExists(baselinePath, 'Baseline');
  ensureFileExists(testPath, 'Test');

  const provider = getProvider(options);
  const model = resolveModel(options);
  const vision = normalizeVisionCompareOptions(options.visionCompare);
  const prepared = await prepareChunkedImages(
    baselinePath,
    testPath,
    vision.includeDiffImage ? diffPath : undefined,
    vision
  );

  const cleanupDir = prepared.chunkDir;
  try {
    if (!prepared.chunked || prepared.chunks.length <= 1) {
      const chunk = prepared.chunks[0];
      return await runSingleAnalysis(
        provider,
        model,
        chunk?.baselinePath ?? baselinePath,
        chunk?.testPath ?? testPath,
        vision.includeDiffImage ? chunk?.diffPath : undefined,
        options,
        prepared.reason
      );
    }

    const results: { chunk: VisionChunk; analysis: AIAnalysisResult }[] = [];
    for (const chunk of prepared.chunks) {
      const analysis = await runSingleAnalysis(
        provider,
        model,
        chunk.baselinePath,
        chunk.testPath,
        vision.includeDiffImage ? chunk.diffPath : undefined,
        options,
        `chunk ${chunk.index}/${prepared.chunks.length} y=${chunk.baselineY}->${chunk.testY}`
      );
      results.push({ chunk, analysis });
    }

    return aggregateChunkAnalyses(results, options.provider, model, prepared.verticalOffset);
  } finally {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Batch analyze multiple image pairs.
 * Processes in parallel with concurrency limit.
 */
export async function analyzeMultiple(
  comparisons: {
    baseline: string;
    test: string;
    diff?: string;
    name: string;
  }[],
  options: AIAnalysisOptions,
  concurrency = 3
): Promise<Map<string, AIAnalysisResult | Error>> {
  const results = new Map<string, AIAnalysisResult | Error>();

  for (let i = 0; i < comparisons.length; i += concurrency) {
    const batch = comparisons.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((comp) =>
        analyzeWithAI(comp.baseline, comp.test, comp.diff, {
          ...options,
          scenarioName: comp.name,
        })
      )
    );

    for (let idx = 0; idx < batchResults.length; idx += 1) {
      const settled = batchResults[idx];
      const name = batch[idx]?.name || 'unknown';
      if (settled.status === 'fulfilled') {
        results.set(name, settled.value);
      } else {
        results.set(name, new Error(settled.reason?.message || 'Unknown error'));
      }
    }
  }

  return results;
}
