import { existsSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';
import { PNG } from 'pngjs';
import { loadPng, writePng } from './core/png-io.js';
import pixelmatch from 'pixelmatch';
import { comparePerceptualHash, type PerceptualHashResult } from './phash.js';
import { getErrorMessage } from './core/errors.js';
import {
  parseHexColor,
  calculateDiffPercentage,
  computeTargetDimensions,
  padImageData,
  cropImageData,
  resizeImageData,
  determineMatch,
  buildSizeMismatchError,
} from './domain/image-diff.js';
import {
  runEnabledEngines,
  calculateUnifiedConfidence,
  type EnginesConfig,
  type ConfidenceThresholds,
} from './engines/index.js';
import { compareDomSnapshots } from './engines/dom-diff.js';
import { applyVerticalAlignment, trimUniformBottom } from './domain/vertical-align.js';
import type { DomSnapshot } from './domain/dom-snapshot.js';

import type {
  ComparisonResult,
  ComparisonMatch,
  ComparisonDiff,
  ComparisonNoBaseline,
  ComparisonNoTest,
  ComparisonError,
} from './types/index.js';

// PNG I/O is centralized in src/core/png-io.ts
// (loadPng throws, loadPngSafely returns null, writePng sync-encodes).

function hasCriticalDomTextChanges(domDiff: ComparisonDiff['domDiff']): boolean {
  return (domDiff?.summary.text_changed ?? 0) > 0;
}

export interface CompareOptions {
  threshold?: number;
  antialiasing?: boolean;
  diffColor?: string;
  computePHash?: boolean;
  keepDiffOnMatch?: boolean;
  engines?: Partial<EnginesConfig>;
  confidenceThresholds?: ConfidenceThresholds;
  sizeNormalization?: 'pad' | 'resize' | 'crop';
  sizeMismatchHandling?: 'strict' | 'ignore';
  /**
   * Vertical alignment for long/full-page cross-browser comparisons.
   * Finds a small Y-offset between baseline and test and crops to overlapping
   * content before computing pixel diff.
   */
  verticalAlign?:
    | boolean
    | {
        enabled?: boolean;
        maxShift?: number;
        minConfidence?: number;
      };
  /**
   * When baseline/test heights differ, allow trimming the taller image if the
   * extra bottom region is effectively uniform (usually just trailing
   * whitespace/background). This prevents noisy "height mismatch" diffs.
   */
  trimUniformBottom?: boolean | { threshold?: number; samplePixels?: number };
  maxDiffPercentage?: number;
  maxDiffPixels?: number;
  baselineSnapshot?: string;
  testSnapshot?: string;
}

function buildMissingResult(
  reason: 'no-baseline' | 'no-test',
  baselinePath: string,
  testPath: string
): ComparisonNoBaseline | ComparisonNoTest {
  return {
    reason,
    match: false,
    baseline: baselinePath,
    test: testPath,
    pixelDiff: 0,
    diffPercentage: 0,
  };
}

// Vertical-alignment + trim-uniform-bottom live in domain/vertical-align.ts.

export async function compareImages(
  baselinePath: string,
  testPath: string,
  diffPath: string,
  options: CompareOptions = {}
): Promise<ComparisonResult> {
  const {
    threshold = 0.1,
    diffColor = '#ff00ff',
    computePHash = true,
    keepDiffOnMatch = false,
    sizeNormalization = 'pad',
    sizeMismatchHandling = 'strict',
  } = options;

  if (!existsSync(baselinePath)) {
    return buildMissingResult('no-baseline', baselinePath, testPath);
  }

  if (!existsSync(testPath)) {
    return buildMissingResult('no-test', baselinePath, testPath);
  }

  try {
    const [img1, img2] = await Promise.all([loadPng(baselinePath), loadPng(testPath)]);
    trimUniformBottom(img1, img2, options.trimUniformBottom);
    applyVerticalAlignment(img1, img2, options.verticalAlign);
    const maxOriginalHeight = Math.max(img1.height, img2.height);
    const tallPage = maxOriginalHeight >= 4000;

    const sizeMismatchOriginal = img1.width !== img2.width || img1.height !== img2.height;
    const sizeMismatchForMatch = sizeMismatchHandling === 'strict' ? sizeMismatchOriginal : false;

    let width = 0;
    let height = 0;
    let data1: Buffer;
    let data2: Buffer;

    if (sizeNormalization === 'resize') {
      width = Math.min(img1.width, img2.width);
      height = Math.min(img1.height, img2.height);
      data1 = resizeImageData(img1.data, img1.width, img1.height, width, height);
      data2 = resizeImageData(img2.data, img2.width, img2.height, width, height);
    } else if (sizeNormalization === 'crop') {
      width = Math.min(img1.width, img2.width);
      height = Math.min(img1.height, img2.height);
      data1 = cropImageData(img1.data, img1.width, img1.height, width, height);
      data2 = cropImageData(img2.data, img2.width, img2.height, width, height);
    } else {
      const target = computeTargetDimensions(img1.width, img1.height, img2.width, img2.height);
      width = target.width;
      height = target.height;
      data1 = padImageData(img1.data, img1.width, img1.height, width, height);
      data2 = padImageData(img2.data, img2.width, img2.height, width, height);
    }

    const diffData = Buffer.alloc(width * height * 4);

    const [r, g, b] = parseHexColor(diffColor);

    const numDiffPixels = pixelmatch(data1, data2, diffData, width, height, {
      threshold,
      diffColor: [r, g, b],
      diffColorAlt: [r, g, b],
      alpha: 0,
      includeAA: options.antialiasing === undefined ? true : !options.antialiasing,
    });

    const totalPixels = width * height;
    const diffPct = calculateDiffPercentage(numDiffPixels, totalPixels);
    const withinPct =
      options.maxDiffPercentage !== undefined && diffPct <= options.maxDiffPercentage;
    const effectiveMaxDiffPixels = tallPage ? undefined : options.maxDiffPixels;
    const withinPixels =
      effectiveMaxDiffPixels !== undefined && numDiffPixels <= effectiveMaxDiffPixels;
    // DOM diff: compare snapshots when available. We run this before final match decision
    // so text changes can be treated as a critical review signal.
    let domDiff: ComparisonDiff['domDiff'];
    if (options.baselineSnapshot && options.testSnapshot) {
      try {
        const [baseSnap, testSnap] = await Promise.all([
          readFile(options.baselineSnapshot, 'utf-8').then((s) => JSON.parse(s) as DomSnapshot),
          readFile(options.testSnapshot, 'utf-8').then((s) => JSON.parse(s) as DomSnapshot),
        ]);
        domDiff = compareDomSnapshots(baseSnap, testSnap);
      } catch {
        // Snapshot comparison failed, continue without it
      }
    }

    const domTextGateFailed = hasCriticalDomTextChanges(domDiff);
    const isMatch =
      (determineMatch(numDiffPixels, sizeMismatchForMatch) || withinPct || withinPixels) &&
      !sizeMismatchForMatch &&
      !domTextGateFailed;

    if (isMatch) {
      // For matches, only compute SSIM/pHash if requested (quick check)
      let phash: PerceptualHashResult | undefined;

      if (computePHash) {
        try {
          phash = comparePerceptualHash(baselinePath, testPath);
        } catch {
          // pHash calculation failed, continue without it
        }
      }

      const matchReason = numDiffPixels === 0 ? 'exact' : 'tolerance';
      const ssimScore = matchReason === 'exact' ? 1 : undefined;
      let diffPathValue: string | undefined;
      if (keepDiffOnMatch) {
        await mkdir(dirname(diffPath), { recursive: true });
        const diff = new PNG({ width, height });
        diff.data = diffData;
        await writePng(diffPath, diff);
        diffPathValue = diffPath;
      }

      return {
        reason: 'match',
        match: true,
        baseline: baselinePath,
        test: testPath,
        pixelDiff: numDiffPixels,
        diffPercentage: diffPct,
        ssimScore,
        phash,
        diffPath: diffPathValue,
        matchReason,
      } satisfies ComparisonMatch;
    }

    // For diffs: run enabled engines ONCE for all metrics (no duplication)
    // Disable pixelmatch in engines since we already ran it above
    await mkdir(dirname(diffPath), { recursive: true });
    const diff = new PNG({ width, height });
    diff.data = diffData;
    await writePng(diffPath, diff);

    const engineConfig = {
      ...options.engines,
      pixelmatch: { enabled: false }, // Already ran above
    };

    const engineResults = await runEnabledEngines(
      baselinePath,
      testPath,
      diffPath.replace(/\.png$/, ''),
      engineConfig
    );

    // Extract SSIM and pHash from engine results
    const ssimResult = engineResults.find((r) => r.engine === 'ssim');
    const phashResult = engineResults.find((r) => r.engine === 'phash');

    const ssimScore = ssimResult && !ssimResult.error ? ssimResult.similarity : undefined;
    const phash: PerceptualHashResult | undefined = phashResult
      ? {
          baselineHash: '',
          testHash: '',
          hammingDistance: 0,
          similarity: phashResult.similarity,
        }
      : undefined;

    const unifiedConfidence = calculateUnifiedConfidence(
      engineResults,
      options.confidenceThresholds
    );

    return {
      reason: 'diff',
      match: false,
      baseline: baselinePath,
      test: testPath,
      diffPath,
      pixelDiff: numDiffPixels,
      diffPercentage: diffPct,
      ssimScore,
      sizeMismatchError:
        sizeMismatchHandling === 'strict' && sizeMismatchOriginal
          ? buildSizeMismatchError(img1.width, img1.height, img2.width, img2.height)
          : undefined,
      phash,
      engineResults,
      unifiedConfidence,
      domDiff,
    } satisfies ComparisonDiff;
  } catch (err: unknown) {
    return {
      reason: 'error',
      match: false,
      baseline: baselinePath,
      test: testPath,
      pixelDiff: 0,
      diffPercentage: 0,
      error: getErrorMessage(err),
    } satisfies ComparisonError;
  }
}
