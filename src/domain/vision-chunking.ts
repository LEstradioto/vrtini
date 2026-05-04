/**
 * Long-page vision chunking for AI analysis: split tall screenshots into
 * vertically-aligned chunk pairs that each fit comfortably in a vision-model
 * context. Used by `analyzeWithAI` so the model gets coherent regions
 * instead of one downscaled blob.
 *
 * Pure image math + tmp-dir I/O. The orchestrator (ai-analysis.ts) wires
 * this up with provider calls.
 */

import { existsSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PNG } from 'pngjs';
import { loadPngSafely, writePng } from '../core/png-io.js';
import { estimateVerticalOffset } from './vertical-align.js';

// ─── Public types ───────────────────────────────────────────────────────────

export interface AIVisionCompareOptions {
  enabled?: boolean;
  chunks?: number;
  minImageHeight?: number;
  maxVerticalAlignShift?: number;
  includeDiffImage?: boolean;
}

export interface VisionChunk {
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

export interface PreparedChunking {
  chunked: boolean;
  chunks: VisionChunk[];
  verticalOffset: number;
  reason?: string;
  chunkDir?: string;
}

// ─── Defaults + option normalization ────────────────────────────────────────

export const DEFAULT_VISION_COMPARE: Required<AIVisionCompareOptions> = {
  enabled: true,
  chunks: 6,
  minImageHeight: 1800,
  maxVerticalAlignShift: 220,
  includeDiffImage: false,
};

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function normalizeVisionCompareOptions(
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

// ─── Pure helpers ───────────────────────────────────────────────────────────

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

/**
 * Carve `totalHeight` into `chunks` near-equal vertical ranges. Pure.
 * Returns one entry per chunk with `index` (1-based), `y`, `height`.
 */
export function buildChunkRanges(
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

/**
 * Given a chunk range against the baseline image, find the matching
 * region in the test image (offset by the estimated vertical shift),
 * clamping to both image bounds. Returns null when the overlap is empty.
 * Pure.
 */
export function resolveAlignedRange(
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

// ─── Orchestrator: read PNGs, decide whether to chunk, write chunk pairs ────

/**
 * Inspect baseline + test images and decide whether to split them into
 * aligned chunks for vision analysis. Writes chunk PNGs to a fresh temp
 * directory so callers can pass the chunk paths to a vision provider.
 *
 * The caller owns cleanup of `chunkDir` (when set) — this fn does not
 * delete it on failure.
 */
export async function prepareChunkedImages(
  baselinePath: string,
  testPath: string,
  diffPath: string | undefined,
  vision: Required<AIVisionCompareOptions>
): Promise<PreparedChunking> {
  const baselinePng = await loadPngSafely(baselinePath);
  const testPng = await loadPngSafely(testPath);
  const diffPng = await loadPngSafely(diffPath);

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
