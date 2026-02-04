import { compare, type ODiffResult, type ODiffOptions } from 'odiff-bin';
import { existsSync } from 'fs';
import type { EngineResult, OdiffConfig } from './types.js';
import { getErrorMessage } from '../core/errors.js';

function makeErrorResult(error: string): EngineResult {
  return {
    engine: 'odiff',
    diffPercent: 0,
    similarity: 0,
    error,
  };
}

function makeSuccessResult(
  diffPixels: number,
  diffPercent: number,
  diffImagePath: string
): EngineResult {
  return {
    engine: 'odiff',
    diffPixels,
    diffPercent,
    similarity: Math.max(0, 1 - diffPercent / 100),
    diffImagePath,
  };
}

function toOdiffOptions(config: OdiffConfig): ODiffOptions {
  return {
    threshold: config.threshold,
    antialiasing: config.antialiasing,
    failOnLayoutDiff: config.failOnLayoutDiff,
    outputDiffMask: config.outputDiffMask,
    noFailOnFsErrors: true,
  };
}

function resultToEngineResult(result: ODiffResult, diffOutput: string): EngineResult {
  if (result.match) {
    return makeSuccessResult(0, 0, diffOutput);
  }

  switch (result.reason) {
    case 'pixel-diff':
      return makeSuccessResult(result.diffCount, result.diffPercentage, diffOutput);
    case 'layout-diff':
      return makeErrorResult('Layout differs between images');
    case 'file-not-exists':
      return makeErrorResult(`File not found: ${result.file}`);
  }
}

export async function isOdiffAvailable(): Promise<boolean> {
  return true;
}

export async function compareWithOdiff(
  baseline: string,
  test: string,
  diffOutput: string,
  config: OdiffConfig
): Promise<EngineResult> {
  if (!existsSync(baseline) || !existsSync(test)) {
    return makeErrorResult('Input files not found');
  }

  try {
    const result = await compare(baseline, test, diffOutput, toOdiffOptions(config));
    return resultToEngineResult(result, diffOutput);
  } catch (err: unknown) {
    return makeErrorResult(getErrorMessage(err));
  }
}
