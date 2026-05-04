import { resolve, basename, dirname, join } from 'path';
import type { VRTConfig, Scenario, Viewport } from './config.js';
import { normalizeBrowserConfig } from './browser-versions.js';
import { getScreenshotFilename, getSnapshotFilename } from './paths.js';
import type { CompareOptions } from '../compare.js';
import { type AutoThresholdCaps, resolveDiffThresholds } from '../domain/auto-threshold.js';

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

function deriveSnapshotPath(imagePath: string): string {
  return join(dirname(imagePath), getSnapshotFilename(basename(imagePath)));
}

/**
 * Build the per-task `compareImages` options for a (scenario, viewport)
 * pair. Single source of truth so the CLI and web runners agree on:
 *
 * - which engines to enable (delegates to `buildEnginesConfig`),
 * - whether to compute the perceptual hash (respects
 *   `config.engines.phash.enabled` — previously the CLI ignored this knob
 *   and always ran phash unless `--quick`),
 * - the effective diff thresholds (auto-threshold caps applied when
 *   `caps` is provided, otherwise scenario → config fallback),
 * - DOM snapshot sidecar paths derived from each side's own image
 *   filename (so cross-compare's mismatched-browser case still resolves
 *   the right `.snapshot.json` for each side).
 *
 * `overrides` lets cross-compare add its own knobs (verticalAlign,
 * sizeNormalization, sizeMismatchHandling, keepDiffOnMatch override)
 * without forking the helper.
 */
export function buildCompareOptions(
  config: VRTConfig,
  scenario: Scenario,
  viewport: Viewport,
  task: { baselinePath: string; testPath: string },
  options: {
    quickMode: boolean;
    autoThresholdCaps?: AutoThresholdCaps | null;
    overrides?: Partial<CompareOptions>;
  }
): CompareOptions {
  const { quickMode, autoThresholdCaps = null, overrides = {} } = options;
  const enginesConfig = buildEnginesConfig(quickMode, config.engines);
  const phashEnabled = config.engines?.phash?.enabled ?? true;
  const thresholds = resolveDiffThresholds(scenario, viewport, config, autoThresholdCaps);

  const snapshotEnabled = !!config.domSnapshot?.enabled;
  const baselineSnapshot = snapshotEnabled ? deriveSnapshotPath(task.baselinePath) : undefined;
  const testSnapshot = snapshotEnabled ? deriveSnapshotPath(task.testPath) : undefined;

  return {
    threshold: config.threshold,
    diffColor: config.diffColor,
    computePHash: !quickMode && phashEnabled,
    engines: enginesConfig,
    antialiasing: config.engines?.pixelmatch?.antialiasing,
    keepDiffOnMatch: config.keepDiffOnMatch,
    maxDiffPercentage: thresholds.maxDiffPercentage,
    maxDiffPixels: thresholds.maxDiffPixels,
    baselineSnapshot,
    testSnapshot,
    ...overrides,
  };
}
