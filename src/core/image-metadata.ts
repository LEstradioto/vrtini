import type { VRTConfig } from './config.js';
import { normalizeBrowserConfig } from './browser-versions.js';
import { getScreenshotFilename } from './paths.js';

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
