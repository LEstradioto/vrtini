import { compare, type ODiffResult, type ODiffOptions } from 'odiff-bin';
import { existsSync, chmodSync } from 'fs';
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { createRequire } from 'module';
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

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

let resolvedBinaryPathPromise: Promise<string | null> | null = null;

function getBundledRawBinaryPath(): string | null {
  try {
    const pkgJson = require.resolve('odiff-bin/package.json');
    const pkgDir = dirname(pkgJson);
    const key = `${process.platform}-${process.arch}`;
    const binaries: Record<string, string> = {
      'linux-x64': 'odiff-linux-x64',
      'linux-arm64': 'odiff-linux-arm64',
      'linux-risc64': 'odiff-linux-risc64',
      'darwin-arm64': 'odiff-macos-arm64',
      'darwin-x64': 'odiff-macos-x64',
      'win32-x64': 'odiff-windows-x64.exe',
      'win32-arm64': 'odiff-windows-arm64.exe',
    };
    const filename = binaries[key];
    if (!filename) return null;
    return join(pkgDir, 'raw_binaries', filename);
  } catch {
    return null;
  }
}

async function canRunBinary(binaryPath: string): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['--help']);
    return true;
  } catch {
    return false;
  }
}

async function resolveOdiffBinaryPath(): Promise<string | null> {
  const override = process.env.VRT_ODIFF_BINARY?.trim();
  if (override) {
    return (await canRunBinary(override)) ? override : null;
  }

  // Prefer odiff-bin's platform raw binary directly; avoids stale post-install links.
  const rawBinary = getBundledRawBinaryPath();
  if (rawBinary && existsSync(rawBinary)) {
    try {
      chmodSync(rawBinary, 0o755);
    } catch {
      // ignore chmod failure; canRunBinary below will fail if not executable.
    }
    if (await canRunBinary(rawBinary)) {
      return rawBinary;
    }
  }

  // Fallback to linked binary created by odiff-bin postinstall.
  try {
    const pkgJson = require.resolve('odiff-bin/package.json');
    const linkedBinary = join(dirname(pkgJson), 'bin', 'odiff.exe');
    if (existsSync(linkedBinary) && (await canRunBinary(linkedBinary))) {
      return linkedBinary;
    }
  } catch {
    // ignore
  }

  // Final fallback: PATH binary.
  if (await canRunBinary('odiff')) {
    return 'odiff';
  }

  return null;
}

async function getResolvedBinaryPath(): Promise<string | null> {
  if (!resolvedBinaryPathPromise) {
    resolvedBinaryPathPromise = resolveOdiffBinaryPath();
  }
  return resolvedBinaryPathPromise;
}

function withBinaryPath(options: ODiffOptions, binaryPath: string): ODiffOptions {
  return { ...(options as Record<string, unknown>), __binaryPath: binaryPath } as ODiffOptions;
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
  return (await getResolvedBinaryPath()) !== null;
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
    const binaryPath = await getResolvedBinaryPath();
    if (!binaryPath) {
      return makeErrorResult(`odiff binary not available for ${process.platform}-${process.arch}`);
    }
    const result = await compare(
      baseline,
      test,
      diffOutput,
      withBinaryPath(toOdiffOptions(config), binaryPath)
    );
    return resultToEngineResult(result, diffOutput);
  } catch (err: unknown) {
    return makeErrorResult(getErrorMessage(err));
  }
}
