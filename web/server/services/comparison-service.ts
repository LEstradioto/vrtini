import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { compareImages } from '../../../src/core/compare.js';
import { getSsimScore } from '../../../src/core/types.js';
import {
  getImagePath,
  getCustomDiffDir,
  type ImageType,
  type PathConfig,
} from '../../../src/core/paths.js';

export interface CompareInput {
  type: ImageType;
  filename: string;
}

export interface ComparisonResultWithUrl {
  diffUrl: string;
  diffFilename: string;
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  phash?: {
    similarity: number;
    baselineHash: string;
    testHash: string;
  };
}

export function resolveImagePaths(
  projectPath: string,
  left: CompareInput,
  right: CompareInput,
  config?: PathConfig
): { leftPath: string; rightPath: string } {
  const leftPath = getImagePath(projectPath, left.type, left.filename, config);
  const rightPath = getImagePath(projectPath, right.type, right.filename, config);
  return { leftPath, rightPath };
}

export function validateImageExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} image not found`);
  }
}

function stripPngExtension(filename: string): string {
  return filename.replace(/\.png$/, '');
}

export function generateDiffFilename(leftFilename: string, rightFilename: string): string {
  const timestamp = Date.now();
  const leftBase = stripPngExtension(leftFilename);
  const rightBase = stripPngExtension(rightFilename);
  return `compare_${timestamp}_${leftBase}_vs_${rightBase}.png`;
}

export async function compareImagesWithDiff(
  projectId: string,
  projectPath: string,
  left: CompareInput,
  right: CompareInput,
  threshold = 0.1,
  config?: PathConfig
): Promise<ComparisonResultWithUrl> {
  const { leftPath, rightPath } = resolveImagePaths(projectPath, left, right, config);

  validateImageExists(leftPath, 'Left');
  validateImageExists(rightPath, 'Right');

  const customDiffDir = getCustomDiffDir(projectPath, config);
  await mkdir(customDiffDir, { recursive: true });

  const diffFilename = generateDiffFilename(left.filename, right.filename);
  const diffPath = resolve(customDiffDir, diffFilename);

  const result = await compareImages(leftPath, rightPath, diffPath, {
    threshold,
    computePHash: true,
    keepDiffOnMatch: true,
  });

  // Extract phash if available (match, diff, or error results have it)
  const phash = 'phash' in result && result.phash ? result.phash : undefined;

  return {
    diffUrl: `/api/projects/${projectId}/images/custom-diff/${diffFilename}`,
    diffFilename,
    pixelDiff: result.pixelDiff,
    diffPercentage: result.diffPercentage,
    ssimScore: getSsimScore(result),
    phash,
  };
}

export function getCustomDiffPath(
  projectPath: string,
  filename: string,
  config?: PathConfig
): string | null {
  const customDiffDir = getCustomDiffDir(projectPath, config);
  const filepath = resolve(customDiffDir, filename);

  if (!existsSync(filepath)) {
    return null;
  }

  return filepath;
}

export function getCustomDiffDirectory(projectPath: string, config?: PathConfig): string {
  return getCustomDiffDir(projectPath, config);
}
