import { readFile, readdir, copyFile, unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { getErrorMessage } from '../../../src/core/errors.js';
import { log } from '../../../src/core/logger.js';
import {
  getProjectDirs,
  getBaselineDir,
  getOutputDir,
  getDiffDir,
  getImageMetadataPath,
  type PathConfig,
} from '../../../src/core/paths.js';
import { IMAGE_METADATA_SCHEMA_VERSION } from '../../../src/core/image-metadata.js';
import type { Acceptance, ImageFlag } from '../../../src/domain/acceptance.js';
import {
  computeAutoThresholdCaps,
  type AutoThresholdCaps,
} from '../../../src/domain/auto-threshold.js';
import { parseImageFilename } from '../../../src/domain/image-naming.js';
import { NotFoundError } from '../../../src/core/api-errors.js';
import {
  loadAcceptances,
  loadImageFlags,
  acceptancesToMap,
  imageFlagsToMap,
} from './acceptance-service.js';

export interface ImageMetadata {
  filename: string;
  scenario: string;
  browser: string;
  version?: string;
  viewport: string;
  /** Screenshot file mtime (ISO). */
  updatedAt?: string;
}

type ImageType = 'baseline' | 'test' | 'diff';

function getProjectImagePaths(projectPath: string, filename: string, config?: PathConfig) {
  const baselineDir = getBaselineDir(projectPath, config);
  const outputDir = getOutputDir(projectPath, config);
  const diffDir = getDiffDir(projectPath, config);
  return {
    baselineDir,
    outputDir,
    diffDir,
    testPath: resolve(outputDir, filename),
    baselinePath: resolve(baselineDir, filename),
    diffPath: resolve(diffDir, filename),
  };
}

export async function listImages(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files.filter((filename) => {
    if (!filename.endsWith('.png')) return false;
    // Skip engine artifacts ("foo_webkit_mobile-odiff.png") — only canonical
    // screenshot/diff files go to the UI.
    const stem = filename.slice(0, -4);
    if (stem.endsWith('-odiff') || stem.endsWith('-pixelmatch')) return false;
    return true;
  });
}

function normalizeImageMetadata(filename: string, value: unknown): ImageMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.scenario !== 'string') return null;
  if (typeof record.browser !== 'string') return null;
  if (typeof record.viewport !== 'string') return null;

  const metadata: ImageMetadata = {
    filename,
    scenario: record.scenario,
    browser: record.browser,
    viewport: record.viewport,
  };

  if (typeof record.version === 'string' && record.version.length > 0) {
    metadata.version = record.version;
  }

  return metadata;
}

async function loadImageMetadataIndex(dir: string): Promise<Record<string, ImageMetadata> | null> {
  const metadataPath = getImageMetadataPath(dir);
  if (!existsSync(metadataPath)) return null;

  try {
    const content = await readFile(metadataPath, 'utf-8');
    const raw = JSON.parse(content) as unknown;
    const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const schemaVersion =
      rawObject && typeof rawObject.schemaVersion === 'number' ? rawObject.schemaVersion : 0;

    if (schemaVersion > IMAGE_METADATA_SCHEMA_VERSION) {
      log.warn(`Unsupported image metadata schema version ${schemaVersion} in ${metadataPath}.`);
      return null;
    }

    const images = rawObject && 'images' in rawObject ? rawObject.images : raw;

    if (!images || typeof images !== 'object') return null;

    const index: Record<string, ImageMetadata> = {};
    for (const [filename, value] of Object.entries(images as Record<string, unknown>)) {
      const metadata = normalizeImageMetadata(filename, value);
      if (metadata) {
        index[filename] = metadata;
      }
    }
    return index;
  } catch (err) {
    log.warn(`Failed to load image metadata from ${metadataPath}:`, getErrorMessage(err));
    return null;
  }
}

export async function listImagesWithMetadata(dir: string): Promise<ImageMetadata[]> {
  const files = await listImages(dir);
  const metadataIndex = await loadImageMetadataIndex(dir);
  const updatedAtByFilename = new Map<string, string | undefined>();
  await Promise.all(
    files.map(async (filename) => {
      try {
        const s = await stat(join(dir, filename));
        updatedAtByFilename.set(filename, s.mtime.toISOString());
      } catch {
        updatedAtByFilename.set(filename, undefined);
      }
    })
  );

  return files.map((filename) => {
    const base = metadataIndex?.[filename] ?? parseImageFilename(filename);
    return { ...base, updatedAt: updatedAtByFilename.get(filename) };
  });
}

export interface ProjectImages {
  baselines: string[];
  tests: string[];
  diffs: string[];
  paths: { baselineDir: string; outputDir: string; diffDir: string };
  metadata: {
    baselines: ImageMetadata[];
    tests: ImageMetadata[];
    diffs: ImageMetadata[];
  };
  acceptances: Record<string, Acceptance>;
  flags: Record<string, ImageFlag>;
  autoThresholdCaps: AutoThresholdCaps;
}

export async function getProjectImages(
  projectPath: string,
  config?: PathConfig
): Promise<ProjectImages> {
  const { baselineDir, outputDir, diffDir } = getProjectDirs(projectPath, config);

  const [baselines, tests, diffs, acceptancesList, flagsList] = await Promise.all([
    listImages(baselineDir),
    listImages(outputDir),
    listImages(diffDir),
    loadAcceptances(projectPath),
    loadImageFlags(projectPath),
  ]);

  const [baselinesWithMeta, testsWithMeta, diffsWithMeta] = await Promise.all([
    listImagesWithMetadata(baselineDir),
    listImagesWithMetadata(outputDir),
    listImagesWithMetadata(diffDir),
  ]);

  return {
    baselines,
    tests,
    diffs,
    paths: { baselineDir, outputDir, diffDir },
    metadata: {
      baselines: baselinesWithMeta,
      tests: testsWithMeta,
      diffs: diffsWithMeta,
    },
    acceptances: acceptancesToMap(acceptancesList),
    flags: imageFlagsToMap(flagsList),
    autoThresholdCaps: computeAutoThresholdCaps(acceptancesList),
  };
}

export function getImageDirectory(
  projectPath: string,
  type: ImageType | string,
  config?: PathConfig
): string | null {
  switch (type) {
    case 'baseline':
      return getBaselineDir(projectPath, config);
    case 'test':
      return getOutputDir(projectPath, config);
    case 'diff':
      return getDiffDir(projectPath, config);
    default:
      return null;
  }
}

export async function approveImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const { testPath, baselinePath, diffPath, outputDir, baselineDir } = getProjectImagePaths(
    projectPath,
    filename,
    config
  );

  if (!existsSync(testPath)) {
    throw new NotFoundError('Test image not found');
  }

  await copyFile(testPath, baselinePath);

  const snapshotFilename = filename.replace(/\.png$/, '.snapshot.json');
  const testSnapshotPath = resolve(outputDir, snapshotFilename);
  const baselineSnapshotPath = resolve(baselineDir, snapshotFilename);
  if (existsSync(testSnapshotPath)) {
    await copyFile(testSnapshotPath, baselineSnapshotPath);
  }

  if (existsSync(diffPath)) {
    await unlink(diffPath);
  }
}

export async function rejectImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const { testPath, diffPath } = getProjectImagePaths(projectPath, filename, config);

  if (existsSync(testPath)) await unlink(testPath);
  if (existsSync(diffPath)) await unlink(diffPath);
}

export interface BulkApproveFailure {
  filename: string;
  error: string;
}

export interface BulkApproveResult {
  approved: string[];
  failed: BulkApproveFailure[];
}

export async function bulkApproveImages(
  projectPath: string,
  filenames: string[],
  config?: PathConfig
): Promise<BulkApproveResult> {
  const approved: string[] = [];
  const failed: BulkApproveFailure[] = [];

  for (const filename of filenames) {
    try {
      await approveImage(projectPath, filename, config);
      approved.push(filename);
    } catch (err) {
      failed.push({
        filename,
        error: getErrorMessage(err, 'Unknown error'),
      });
    }
  }

  return { approved, failed };
}

export async function revertImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const baselineDir = getBaselineDir(projectPath, config);
  const baselinePath = resolve(baselineDir, filename);

  if (!existsSync(baselinePath)) {
    throw new NotFoundError('Baseline image not found');
  }

  await unlink(baselinePath);
}
