/**
 * Row-signature analysis: per-row weighted-luma + mean-alpha summaries used
 * to estimate a vertical shift between two screenshots without a full
 * pixel-level compare. Pure — operates on raw RGBA buffers and the tiny
 * PngLike shape.
 *
 * Split from vertical-align.ts so the signature/estimation primitives can be
 * reused (vision-chunking) independently of the in-place alignment pass.
 */

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

/**
 * Find the vertical shift (in rows) that best aligns `test` to `baseline`.
 * Used by the vision-chunking pipeline to align two screenshots before
 * splitting into chunks. Lighter cousin of `applyVerticalAlignment`:
 * returns just the shift (does not mutate, no confidence gating).
 *
 * `requestedMaxShift` is clamped to 20% of the smaller image height.
 */
export function estimateVerticalOffset(
  baseline: PngLike,
  test: PngLike,
  requestedMaxShift: number
): number {
  const safeMaxShift = Math.max(
    0,
    Math.min(requestedMaxShift, Math.floor(Math.min(baseline.height, test.height) * 0.2))
  );
  if (safeMaxShift === 0) return 0;

  const baselineRows = buildRowSignatureSeries(baseline.data, baseline.width, baseline.height);
  const testRows = buildRowSignatureSeries(test.data, test.width, test.height);
  const minOverlapRows = Math.max(120, Math.floor(Math.min(baseline.height, test.height) * 0.35));

  let bestShift = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let shift = -safeMaxShift; shift <= safeMaxShift; shift += 1) {
    const score = scoreRowAlignment(
      baselineRows,
      testRows,
      baseline.height,
      test.height,
      shift,
      minOverlapRows
    );
    if (!Number.isFinite(score)) continue;

    if (score < bestScore || (score === bestScore && Math.abs(shift) < Math.abs(bestShift))) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return bestShift;
}
