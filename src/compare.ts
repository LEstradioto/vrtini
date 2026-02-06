import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import { PNG } from 'pngjs';
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
import type { DomSnapshot } from './domain/dom-snapshot.js';

export type {
  ComparisonResult,
  ComparisonMatch,
  ComparisonDiff,
  ComparisonNoBaseline,
  ComparisonNoTest,
  ComparisonError,
} from './types/index.js';
export {
  isDiff,
  isMatch,
  hasPhash,
  hasAiAnalysis,
  getSsimScore,
  getDiffPath,
  getResultError,
} from './types/index.js';

import type {
  ComparisonResult,
  ComparisonMatch,
  ComparisonDiff,
  ComparisonNoBaseline,
  ComparisonNoTest,
  ComparisonError,
} from './types/index.js';

async function loadPNG(path: string): Promise<PNG> {
  const data = await readFile(path);
  return await new Promise<PNG>((resolve, reject) => {
    const png = new PNG();
    png.parse(data, (err, parsed) => {
      if (err) {
        reject(err);
        return;
      }
      if (!parsed) {
        reject(new Error('Failed to parse PNG.'));
        return;
      }
      resolve(parsed);
    });
  });
}

async function writePNG(path: string, png: PNG): Promise<void> {
  await pipeline(png.pack(), createWriteStream(path));
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
    const [img1, img2] = await Promise.all([loadPNG(baselinePath), loadPNG(testPath)]);
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
    const isMatch =
      (determineMatch(numDiffPixels, sizeMismatchForMatch) || withinPct || withinPixels) &&
      !sizeMismatchForMatch;

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
        await writePNG(diffPath, diff);
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
    await writePNG(diffPath, diff);

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

    // DOM diff: compare snapshots if both paths provided
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

export interface BatchCompareResult {
  results: ComparisonResult[];
  passed: number;
  failed: number;
  noBaseline: number;
}

export async function compareAll(
  comparisons: { baseline: string; test: string; diff: string }[],
  options: CompareOptions = {}
): Promise<BatchCompareResult> {
  const results = await Promise.all(
    comparisons.map(({ baseline, test, diff }) => compareImages(baseline, test, diff, options))
  );

  const passed = results.filter((r) => r.match).length;
  const failed = results.filter((r) => r.reason === 'diff').length;
  const noBaseline = results.filter((r) => r.reason === 'no-baseline').length;

  return { results, passed, failed, noBaseline };
}
