import { existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as ImageSSIM from 'image-ssim';
import { comparePerceptualHash } from '../phash.js';
import { compareWithOdiff, isOdiffAvailable } from './odiff.js';
import { getErrorMessage } from '../core/errors.js';
import type { EngineResult, EnginesConfig, EngineName, PixelmatchConfig } from './types.js';
import { DEFAULT_ENGINES_CONFIG } from './types.js';

export { DEFAULT_ENGINES_CONFIG } from './types.js';
export type { EngineResult, EnginesConfig, EngineConfig, EngineName } from './types.js';

const ENGINE_WEIGHTS: Record<EngineName, number> = {
  pixelmatch: 0.3,
  odiff: 0.3,
  ssim: 0.25,
  phash: 0.15,
};

const SSIM_MAX_DIMENSION = 3000;

export interface UnifiedConfidence {
  score: number; // 0-100
  pass: boolean;
  verdict: 'pass' | 'warn' | 'fail';
  details: Partial<Record<EngineName, EngineResult>>;
}

export interface ConfidenceThresholds {
  pass: number;
  warn: number;
}

const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  pass: 95,
  warn: 80,
};

interface SsimCompareResult {
  ssim: number;
}
type SsimCompareFn = (a: ImageSSIM.IImage, b: ImageSSIM.IImage) => SsimCompareResult;

function resolveSsimCompare(): SsimCompareFn {
  // `image-ssim` exports differ between CJS/ESM environments.
  // Try all known shapes to keep runtime stable.
  const moduleCandidate = ImageSSIM as unknown as {
    compare?: unknown;
    default?: { compare?: unknown };
    ['module.exports']?: { compare?: unknown };
  };
  const compareFn =
    moduleCandidate.compare ??
    moduleCandidate.default?.compare ??
    moduleCandidate['module.exports']?.compare;
  if (typeof compareFn !== 'function') {
    throw new Error('image-ssim compare() is not available in current module format');
  }
  return compareFn as SsimCompareFn;
}

function buildEnginesConfig(config: Partial<EnginesConfig>): EnginesConfig {
  return {
    pixelmatch: { ...DEFAULT_ENGINES_CONFIG.pixelmatch, ...config.pixelmatch },
    odiff: { ...DEFAULT_ENGINES_CONFIG.odiff, ...config.odiff },
    ssim: { ...DEFAULT_ENGINES_CONFIG.ssim, ...config.ssim },
    phash: { ...DEFAULT_ENGINES_CONFIG.phash, ...config.phash },
  };
}

export function calculateUnifiedConfidence(
  results: EngineResult[],
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): UnifiedConfidence {
  const details: Partial<Record<EngineName, EngineResult>> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    if (result.error) continue;

    details[result.engine] = result;
    const weight = ENGINE_WEIGHTS[result.engine];
    totalWeight += weight;
    weightedSum += result.similarity * weight;
  }

  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
  const verdict = score >= thresholds.pass ? 'pass' : score >= thresholds.warn ? 'warn' : 'fail';

  return {
    score,
    pass: score >= thresholds.pass,
    verdict,
    details,
  };
}

async function runPixelmatch(
  baseline: string,
  test: string,
  diffOutput: string,
  config: PixelmatchConfig
): Promise<EngineResult> {
  try {
    const img1 = PNG.sync.read(readFileSync(baseline));
    const img2 = PNG.sync.read(readFileSync(test));

    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);
    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, {
      threshold: config.threshold ?? 0.1,
      includeAA: !config.antialiasing,
      alpha: config.alpha ?? 0.1,
    });

    await mkdir(dirname(diffOutput), { recursive: true });
    writeFileSync(diffOutput, PNG.sync.write(diff));

    const totalPixels = width * height;
    const diffPercent = (numDiffPixels / totalPixels) * 100;

    return {
      engine: 'pixelmatch',
      diffPixels: numDiffPixels,
      diffPercent,
      similarity: Math.max(0, 1 - diffPercent / 100),
      diffImagePath: diffOutput,
    };
  } catch (err) {
    return {
      engine: 'pixelmatch',
      diffPercent: 0,
      similarity: 0,
      error: getErrorMessage(err, 'pixelmatch failed'),
    };
  }
}

async function runSSIM(baseline: string, test: string): Promise<EngineResult> {
  try {
    const compareFn = resolveSsimCompare();
    const loadPNG = (path: string): PNG => PNG.sync.read(readFileSync(path));

    const toImage = (img: PNG): ImageSSIM.IImage => ({
      data: new Uint8Array(img.data),
      width: img.width,
      height: img.height,
      channels: 4 as ImageSSIM.Channels,
    });

    const padPNG = (img: PNG, width: number, height: number): PNG => {
      if (img.width === width && img.height === height) return img;
      const padded = new PNG({ width, height });
      padded.data.fill(255);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const srcIdx = (y * img.width + x) * 4;
          const dstIdx = (y * width + x) * 4;
          padded.data[dstIdx] = img.data[srcIdx];
          padded.data[dstIdx + 1] = img.data[srcIdx + 1];
          padded.data[dstIdx + 2] = img.data[srcIdx + 2];
          padded.data[dstIdx + 3] = img.data[srcIdx + 3];
        }
      }
      return padded;
    };

    const resizePNG = (img: PNG, targetWidth: number, targetHeight: number): PNG => {
      if (img.width === targetWidth && img.height === targetHeight) return img;
      const resized = new PNG({ width: targetWidth, height: targetHeight });
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const srcX = (x / targetWidth) * img.width;
          const srcY = (y / targetHeight) * img.height;
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = Math.min(x0 + 1, img.width - 1);
          const y1 = Math.min(y0 + 1, img.height - 1);
          const xFrac = srcX - x0;
          const yFrac = srcY - y0;
          const dstIdx = (targetWidth * y + x) * 4;
          for (let c = 0; c < 4; c++) {
            const v00 = img.data[(img.width * y0 + x0) * 4 + c];
            const v10 = img.data[(img.width * y0 + x1) * 4 + c];
            const v01 = img.data[(img.width * y1 + x0) * 4 + c];
            const v11 = img.data[(img.width * y1 + x1) * 4 + c];
            const value =
              v00 * (1 - xFrac) * (1 - yFrac) +
              v10 * xFrac * (1 - yFrac) +
              v01 * (1 - xFrac) * yFrac +
              v11 * xFrac * yFrac;
            resized.data[dstIdx + c] = Math.round(value);
          }
        }
      }
      return resized;
    };

    let img1 = loadPNG(baseline);
    let img2 = loadPNG(test);

    const maxWidth = Math.max(img1.width, img2.width);
    const maxHeight = Math.max(img1.height, img2.height);
    img1 = padPNG(img1, maxWidth, maxHeight);
    img2 = padPNG(img2, maxWidth, maxHeight);

    if (maxWidth > SSIM_MAX_DIMENSION || maxHeight > SSIM_MAX_DIMENSION) {
      const scale = Math.min(SSIM_MAX_DIMENSION / maxWidth, SSIM_MAX_DIMENSION / maxHeight);
      const targetWidth = Math.max(1, Math.floor(maxWidth * scale));
      const targetHeight = Math.max(1, Math.floor(maxHeight * scale));
      img1 = resizePNG(img1, targetWidth, targetHeight);
      img2 = resizePNG(img2, targetWidth, targetHeight);
    }

    const result = compareFn(toImage(img1), toImage(img2));

    return {
      engine: 'ssim',
      diffPercent: (1 - result.ssim) * 100,
      similarity: result.ssim,
    };
  } catch (err) {
    return {
      engine: 'ssim',
      diffPercent: 0,
      similarity: 0,
      error: getErrorMessage(err, 'SSIM failed'),
    };
  }
}

function runPHash(baseline: string, test: string): EngineResult {
  try {
    const result = comparePerceptualHash(baseline, test);
    return {
      engine: 'phash',
      diffPercent: (1 - result.similarity) * 100,
      similarity: result.similarity,
    };
  } catch (err) {
    return {
      engine: 'phash',
      diffPercent: 0,
      similarity: 0,
      error: getErrorMessage(err, 'pHash failed'),
    };
  }
}

export async function runEnabledEngines(
  baseline: string,
  test: string,
  diffOutputBase: string,
  config: Partial<EnginesConfig> = {}
): Promise<EngineResult[]> {
  const cfg = buildEnginesConfig(config);

  if (!existsSync(baseline) || !existsSync(test)) {
    return [];
  }

  const tasks: Promise<EngineResult>[] = [];

  if (cfg.pixelmatch.enabled) {
    tasks.push(runPixelmatch(baseline, test, `${diffOutputBase}-pixelmatch.png`, cfg.pixelmatch));
  }

  if (cfg.odiff.enabled && (await isOdiffAvailable())) {
    tasks.push(compareWithOdiff(baseline, test, `${diffOutputBase}-odiff.png`, cfg.odiff));
  }

  if (cfg.ssim.enabled) {
    tasks.push(runSSIM(baseline, test));
  }

  if (cfg.phash.enabled) {
    tasks.push(Promise.resolve(runPHash(baseline, test)));
  }

  return Promise.all(tasks);
}
