import { resolve } from 'path';
import type { VRTConfig, Scenario, Viewport } from './config.js';
import { normalizeBrowserConfig } from './browser-versions.js';
import { getScreenshotFilename } from './paths.js';

export function buildEnginesConfig(
  quickMode: boolean,
  engines: VRTConfig['engines']
): VRTConfig['engines'] {
  if (!quickMode) return engines;
  return {
    pixelmatch: { enabled: true },
    ssim: { enabled: false },
    phash: { enabled: false },
    odiff: { enabled: false },
  };
}

export interface ComparisonTask {
  scenario: Scenario;
  browser: 'chromium' | 'webkit';
  version?: string;
  viewport: Viewport;
  filename: string;
  baselinePath: string;
  testPath: string;
  diffPath: string;
}

export function buildComparisonMatrix(
  outputDir: string,
  baselineDir: string,
  diffDir: string,
  scenarios: VRTConfig['scenarios'],
  config: VRTConfig
): ComparisonTask[] {
  const comparisons: ComparisonTask[] = [];

  for (const scenario of scenarios) {
    for (const browserConfig of config.browsers) {
      const { name: browser, version } = normalizeBrowserConfig(browserConfig);
      for (const viewport of config.viewports) {
        const filename = getScreenshotFilename(scenario.name, browser, viewport.name, version);
        comparisons.push({
          scenario,
          browser,
          version,
          viewport,
          filename,
          testPath: resolve(outputDir, filename),
          baselinePath: resolve(baselineDir, filename),
          diffPath: resolve(diffDir, filename),
        });
      }
    }
  }

  return comparisons;
}

export function buildComparisons(
  outputDir: string,
  baselineDir: string,
  diffDir: string,
  scenarios: VRTConfig['scenarios'],
  config: VRTConfig
): {
  baselinePath: string;
  testPath: string;
  diffPath: string;
}[] {
  return buildComparisonMatrix(outputDir, baselineDir, diffDir, scenarios, config).map(
    ({ baselinePath, testPath, diffPath }) => ({
      baselinePath,
      testPath,
      diffPath,
    })
  );
}
