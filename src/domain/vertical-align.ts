/**
 * Vertical-alignment + bottom-trim helpers: per-row signatures, shift
 * scoring, the top-level `applyVerticalAlignment` pass that mutates a pair
 * of images in place, and `trimUniformBottom` for height-mismatch noise.
 * All pure — operates on raw RGBA pixel buffers and the (tiny) PngLike
 * shape, so the module doesn't depend on pngjs directly.
 */

import { cropImageData } from './image-diff.js';

/** Minimal mutable-PNG shape — `PNG` from `pngjs` satisfies this structurally. */
export interface PngLike {
  width: number;
  height: number;
  data: Buffer;
}

export interface RowSignature {
  luma: number;
  alpha: number;
}

/**
 * One signature per image row: weighted-luma and mean-alpha across sampled
 * columns. Used for fast row-to-row matching without a full pixel compare.
 */
export function buildRowSignatureSeries(
  data: Buffer,
  width: number,
  height: number
): RowSignature[] {
  const sampleStep = Math.max(1, Math.floor(width / 256));
  const rows = new Array<RowSignature>(height);

  for (let y = 0; y < height; y += 1) {
    let lumaSum = 0;
    let alphaSum = 0;
    let count = 0;
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const a = (data[idx + 3] ?? 255) / 255;
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

/**
 * Mean distance between aligned rows at a given vertical `shift`, weighted
 * 85% luma / 15% alpha. Returns +Infinity when the overlap is below
 * `minOverlapRows`.
 */
export function scoreRowAlignment(
  baselineRows: RowSignature[],
  testRows: RowSignature[],
  baselineHeight: number,
  testHeight: number,
  shift: number,
  minOverlapRows: number
): number {
  const baselineStart = Math.max(0, -shift);
  const testStart = Math.max(0, shift);
  const overlap = Math.min(baselineHeight - baselineStart, testHeight - testStart);
  if (overlap < minOverlapRows) return Number.POSITIVE_INFINITY;

  let score = 0;
  for (let row = 0; row < overlap; row += 1) {
    const b = baselineRows[baselineStart + row];
    const t = testRows[testStart + row];
    score += Math.abs((b?.luma ?? 0) - (t?.luma ?? 0)) * 0.85;
    score += Math.abs((b?.alpha ?? 0) - (t?.alpha ?? 0)) * 0.15;
  }
  return score / overlap;
}

// ─── Apply-vertical-alignment pass ──────────────────────────────────────────

export interface VerticalAlignOptions {
  enabled?: boolean;
  maxShift?: number;
  minConfidence?: number;
}

export interface TrimUniformBottomOptions {
  threshold?: number;
  samplePixels?: number;
}

interface ResolvedVerticalAlign {
  enabled: boolean;
  maxShift: number;
  minConfidence: number;
}

const DEFAULT_MIN_CONFIDENCE = 0.12;
const DEFAULT_MAX_SHIFT = 260;

function resolveVerticalAlignOptions(
  raw: boolean | VerticalAlignOptions | undefined,
  minHeight: number
): ResolvedVerticalAlign {
  if (!raw) return { enabled: false, maxShift: 0, minConfidence: DEFAULT_MIN_CONFIDENCE };

  const requestedEnabled = raw === true ? true : (raw.enabled ?? true);
  if (!requestedEnabled) {
    return { enabled: false, maxShift: 0, minConfidence: DEFAULT_MIN_CONFIDENCE };
  }

  const requestedMaxShift = raw === true ? DEFAULT_MAX_SHIFT : (raw.maxShift ?? DEFAULT_MAX_SHIFT);
  const safeMaxShift = Math.max(0, Math.min(requestedMaxShift, Math.floor(minHeight * 0.25)));
  if (safeMaxShift < 1) {
    return { enabled: false, maxShift: 0, minConfidence: DEFAULT_MIN_CONFIDENCE };
  }

  const minConfidence =
    raw === true ? DEFAULT_MIN_CONFIDENCE : (raw.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  return { enabled: true, maxShift: safeMaxShift, minConfidence };
}

function cropVerticalRegion(
  srcData: Buffer,
  srcWidth: number,
  srcHeight: number,
  startY: number,
  targetHeight: number
): Buffer {
  const safeStartY = Math.max(0, Math.min(startY, srcHeight));
  const safeTargetHeight = Math.max(0, Math.min(targetHeight, srcHeight - safeStartY));
  const rowBytes = srcWidth * 4;
  const result = Buffer.alloc(srcWidth * safeTargetHeight * 4);
  for (let y = 0; y < safeTargetHeight; y += 1) {
    const srcStart = (safeStartY + y) * rowBytes;
    const dstStart = y * rowBytes;
    srcData.copy(result, dstStart, srcStart, srcStart + rowBytes);
  }
  return result;
}

/**
 * If the two images can be vertically re-aligned to a higher-overlap
 * configuration, mutate them in place to the aligned region. No-op when
 * alignment is disabled, below confidence, or can't improve on shift=0.
 */
export function applyVerticalAlignment(
  img1: PngLike,
  img2: PngLike,
  options: boolean | VerticalAlignOptions | undefined
): void {
  const minHeight = Math.min(img1.height, img2.height);
  const cfg = resolveVerticalAlignOptions(options, minHeight);
  if (!cfg.enabled) return;

  const baselineRows = buildRowSignatureSeries(img1.data, img1.width, img1.height);
  const testRows = buildRowSignatureSeries(img2.data, img2.width, img2.height);
  const minOverlapRows = Math.max(120, Math.floor(minHeight * 0.35));

  let bestShift = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondBestScore = Number.POSITIVE_INFINITY;

  for (let shift = -cfg.maxShift; shift <= cfg.maxShift; shift += 1) {
    const score = scoreRowAlignment(
      baselineRows,
      testRows,
      img1.height,
      img2.height,
      shift,
      minOverlapRows
    );
    if (!Number.isFinite(score)) continue;

    if (score < bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestShift = shift;
    } else if (score < secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!Number.isFinite(bestScore) || bestShift === 0) return;

  const zeroScore = scoreRowAlignment(
    baselineRows,
    testRows,
    img1.height,
    img2.height,
    0,
    minOverlapRows
  );
  const improvement =
    Number.isFinite(zeroScore) && zeroScore > 0 ? (zeroScore - bestScore) / zeroScore : 0;
  const confidence = Number.isFinite(secondBestScore)
    ? Math.max(0, Math.min(1, (secondBestScore - bestScore) / (secondBestScore || 1)))
    : 1;

  if (improvement < cfg.minConfidence && confidence < cfg.minConfidence) return;

  const baselineStart = Math.max(0, -bestShift);
  const testStart = Math.max(0, bestShift);
  const overlap = Math.min(img1.height - baselineStart, img2.height - testStart);
  if (overlap < minOverlapRows) return;

  img1.data = cropVerticalRegion(img1.data, img1.width, img1.height, baselineStart, overlap);
  img1.height = overlap;
  img2.data = cropVerticalRegion(img2.data, img2.width, img2.height, testStart, overlap);
  img2.height = overlap;
}

// ─── Trim uniform bottom ────────────────────────────────────────────────────

const DEFAULT_TRIM_THRESHOLD = 0.995;
const DEFAULT_TRIM_SAMPLE_PIXELS = 8000;

interface ResolvedTrim {
  enabled: boolean;
  threshold: number;
  samplePixels: number;
}

function resolveTrimOptions(raw: boolean | TrimUniformBottomOptions | undefined): ResolvedTrim {
  if (raw === false) {
    return {
      enabled: false,
      threshold: DEFAULT_TRIM_THRESHOLD,
      samplePixels: DEFAULT_TRIM_SAMPLE_PIXELS,
    };
  }
  if (raw === true || raw === undefined) {
    return {
      enabled: true,
      threshold: DEFAULT_TRIM_THRESHOLD,
      samplePixels: DEFAULT_TRIM_SAMPLE_PIXELS,
    };
  }
  return {
    enabled: true,
    threshold: raw.threshold ?? DEFAULT_TRIM_THRESHOLD,
    samplePixels: raw.samplePixels ?? DEFAULT_TRIM_SAMPLE_PIXELS,
  };
}

function pixelKey(data: Buffer, offset: number): number {
  // Pack RGBA into a single 32-bit value for fast equality checks.
  return (
    ((data[offset] ?? 0) << 24) |
    ((data[offset + 1] ?? 0) << 16) |
    ((data[offset + 2] ?? 0) << 8) |
    (data[offset + 3] ?? 0)
  );
}

function modeFractionInRegion(
  data: Buffer,
  width: number,
  yStart: number,
  yEndExclusive: number,
  samplePixels: number
): number {
  const h = yEndExclusive - yStart;
  if (h <= 0 || width <= 0) return 0;
  const total = width * h;
  const step = Math.max(1, Math.floor(total / Math.max(1, samplePixels)));
  const counts = new Map<number, number>();

  const startOffset = yStart * width * 4;
  let sampled = 0;
  let maxCount = 0;

  for (let p = 0; p < total; p += step) {
    const off = startOffset + p * 4;
    const key = pixelKey(data, off);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    sampled += 1;
    if (next > maxCount) maxCount = next;
  }

  return sampled === 0 ? 0 : maxCount / sampled;
}

/**
 * If the two images have matching widths but different heights and the
 * extra bottom region of the taller image is effectively uniform
 * (whitespace/background), trim the taller image to match. De-flakes
 * "height mismatch" diffs that are really just trailing empty space.
 * Mutates the taller image in place when triggered.
 */
export function trimUniformBottom(
  img1: PngLike,
  img2: PngLike,
  options: boolean | TrimUniformBottomOptions | undefined
): void {
  const trim = resolveTrimOptions(options);
  if (!trim.enabled) return;
  if (img1.width !== img2.width) return;
  if (img1.height === img2.height) return;

  const shortH = Math.min(img1.height, img2.height);
  const taller = img1.height > img2.height ? img1 : img2;
  const frac = modeFractionInRegion(
    taller.data,
    taller.width,
    shortH,
    taller.height,
    trim.samplePixels
  );
  if (frac < trim.threshold) return;

  taller.data = cropImageData(taller.data, taller.width, taller.height, taller.width, shortH);
  taller.height = shortH;
}
