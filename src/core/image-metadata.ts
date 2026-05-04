import { readdir } from 'fs/promises';
import type { VRTConfig } from './config.js';
import { normalizeBrowserConfig } from './browser-versions.js';
import { getScreenshotFilename, getImageMetadataPath } from './paths.js';
import { saveJsonFile } from './json-file-store.js';

export interface ImageMetadata {
  filename: string;
  scenario: string;
  browser: string;
  version?: string;
  viewport: string;
}

export const IMAGE_METADATA_SCHEMA_VERSION = 1;

export interface ImageMetadataFile {
  schemaVersion: number;
  generatedAt: string;
  images: Record<string, ImageMetadata>;
}

async function listPngFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith('.png'));
  } catch {
    return [];
  }
}

/**
 * Atomically write the metadata sidecar (.image-metadata.json) for one
 * directory, keying entries by the PNG filenames currently present on disk.
 * Files in `metadataIndex` that aren't on disk are skipped; PNGs without a
 * matching entry simply don't get a sidecar entry.
 */
export async function writeImageMetadataFile(
  dir: string,
  metadataIndex: Record<string, ImageMetadata>
): Promise<void> {
  const files = await listPngFiles(dir);
  const images: Record<string, ImageMetadata> = {};

  for (const filename of files) {
    const metadata = metadataIndex[filename];
    if (metadata) {
      images[filename] = metadata;
    }
  }

  const payload: ImageMetadataFile = {
    schemaVersion: IMAGE_METADATA_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    images,
  };

  await saveJsonFile(getImageMetadataPath(dir), payload);
}

/**
 * Build the metadata index for the (config, scenarios) pair and write it
 * to all three directories (output, diff, baseline) in parallel.
 */
export async function persistImageMetadata(
  config: VRTConfig,
  scenarios: VRTConfig['scenarios'],
  dirs: { outputDir: string; baselineDir: string; diffDir: string }
): Promise<void> {
  const metadataIndex = buildImageMetadataIndex(config, scenarios);
  await Promise.all([
    writeImageMetadataFile(dirs.outputDir, metadataIndex),
    writeImageMetadataFile(dirs.diffDir, metadataIndex),
    writeImageMetadataFile(dirs.baselineDir, metadataIndex),
  ]);
}

export function buildImageMetadataIndex(
  config: VRTConfig,
  scenarios: VRTConfig['scenarios'] = config.scenarios
): Record<string, ImageMetadata> {
  const index: Record<string, ImageMetadata> = {};

  for (const scenario of scenarios) {
    for (const browserConfig of config.browsers) {
      const { name: browser, version } = normalizeBrowserConfig(browserConfig);
      for (const viewport of config.viewports) {
        const filename = getScreenshotFilename(scenario.name, browser, viewport.name, version);
        index[filename] = {
          filename,
          scenario: scenario.name,
          browser,
          version,
          viewport: viewport.name,
        };
      }
    }
  }

  return index;
}
