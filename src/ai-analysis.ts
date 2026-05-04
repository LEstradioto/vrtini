import { existsSync } from 'fs';
import { rm } from 'fs/promises';
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
import {
  prepareChunkedImages,
  normalizeVisionCompareOptions,
  type AIVisionCompareOptions,
  type VisionChunk,
} from './domain/vision-chunking.js';

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

export type { AIVisionCompareOptions };

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  anthropic: 'claude-haiku-4-5-20241022',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-3-flash-preview',
  google: 'gemini-3-flash',
};

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
