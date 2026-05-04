/**
 * Post-capture diagnostics: count expected vs captured screenshots/snapshots,
 * sample missing filenames, and turn capture-failure shapes into terse user
 * warnings. The fs-touching scan is in `collectCaptureDiagnostics`; the rest
 * is pure.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import type { VRTConfig } from '../core/config.js';
import { normalizeBrowserConfig } from '../core/browser-versions.js';
import { getScreenshotFilename, getSnapshotFilename } from '../core/paths.js';

export interface CaptureDiagnostics {
  expectedScreenshots: number;
  capturedScreenshots: number;
  expectedSnapshots: number;
  capturedSnapshots: number;
  missingScreenshotSamples: string[];
  missingSnapshotSamples: string[];
}

const MAX_MISSING_SAMPLES = 8;
const MAX_FAILURE_SAMPLES = 3;

interface DiagnosticDirs {
  outputDir: string;
}

/**
 * Walk every (scenario × browser × viewport) the run was supposed to
 * produce and check whether each expected screenshot (and DOM snapshot,
 * if enabled) is present on disk. Returns counts + a small sample of
 * missing filenames for the user-facing warning.
 */
export function collectCaptureDiagnostics(
  dirs: DiagnosticDirs,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): CaptureDiagnostics {
  let expectedScreenshots = 0;
  let capturedScreenshots = 0;
  let expectedSnapshots = 0;
  let capturedSnapshots = 0;
  const missingScreenshotSamples: string[] = [];
  const missingSnapshotSamples: string[] = [];
  const captureSnapshots = !!config.domSnapshot?.enabled;

  for (const scenario of scenarios) {
    for (const browserConfig of config.browsers) {
      const { name: browser, version } = normalizeBrowserConfig(browserConfig);
      for (const viewport of config.viewports) {
        const screenshotName = getScreenshotFilename(
          scenario.name,
          browser,
          viewport.name,
          version
        );
        const screenshotPath = resolve(dirs.outputDir, screenshotName);
        expectedScreenshots += 1;
        if (existsSync(screenshotPath)) {
          capturedScreenshots += 1;
        } else if (missingScreenshotSamples.length < MAX_MISSING_SAMPLES) {
          missingScreenshotSamples.push(screenshotName);
        }

        if (!captureSnapshots) continue;

        const snapshotName = getSnapshotFilename(screenshotName);
        const snapshotPath = resolve(dirs.outputDir, snapshotName);
        expectedSnapshots += 1;
        if (existsSync(snapshotPath)) {
          capturedSnapshots += 1;
        } else if (missingSnapshotSamples.length < MAX_MISSING_SAMPLES) {
          missingSnapshotSamples.push(snapshotName);
        }
      }
    }
  }

  return {
    expectedScreenshots,
    capturedScreenshots,
    expectedSnapshots,
    capturedSnapshots,
    missingScreenshotSamples,
    missingSnapshotSamples,
  };
}

/**
 * Build the warning lines that summarize how many expected artifacts
 * were missing after capture. Pure.
 */
export function buildDiagnosticWarnings(
  diagnostics: CaptureDiagnostics,
  domSnapshotEnabled: boolean
): string[] {
  const warnings: string[] = [];

  if (diagnostics.capturedScreenshots < diagnostics.expectedScreenshots) {
    warnings.push(
      `Captured ${diagnostics.capturedScreenshots}/${diagnostics.expectedScreenshots} screenshot(s).`
    );
  }

  if (domSnapshotEnabled) {
    if (diagnostics.capturedSnapshots < diagnostics.expectedSnapshots) {
      warnings.push(
        `Captured ${diagnostics.capturedSnapshots}/${diagnostics.expectedSnapshots} DOM snapshot(s).`
      );
    }
    if (diagnostics.expectedSnapshots > 0 && diagnostics.capturedSnapshots === 0) {
      warnings.push(
        'DOM snapshot is enabled but no snapshots were generated. Rebuild/update Docker image and rerun tests.'
      );
    }
  }

  return warnings;
}

/** Minimal shape from src/docker.ts ScreenshotResult — kept loose so domain
 *  doesn't import upstream. */
interface CaptureResultLike {
  success: boolean;
  warning?: string;
  task: {
    scenario: { name: string };
    browser: string;
    version?: string;
    viewport: { name: string };
  };
}

function formatTaskLabel(result: CaptureResultLike): string {
  const versionSuffix = result.task.version ? `-v${result.task.version}` : '';
  return `${result.task.scenario.name} · ${result.task.browser}${versionSuffix} · ${result.task.viewport.name}`;
}

/**
 * Build the warning lines that summarize per-task capture fallbacks and
 * outright failures. Pure given the array of capture results.
 */
export function buildCaptureResultWarnings(results: CaptureResultLike[]): string[] {
  const warnings: string[] = [];

  const fallbacks = results.filter(
    (result) => typeof result.warning === 'string' && result.warning.trim().length > 0
  );
  if (fallbacks.length > 0) {
    const samples = fallbacks.slice(0, MAX_FAILURE_SAMPLES).map(formatTaskLabel).join(', ');
    warnings.push(
      `Capture fallback was used for ${fallbacks.length}/${results.length} screenshot(s). Samples: ${samples}`
    );
  }

  const failed = results.filter((result) => !result.success);
  if (failed.length > 0) {
    const samples = failed.slice(0, MAX_FAILURE_SAMPLES).map(formatTaskLabel).join(', ');
    warnings.push(
      `Screenshot capture failed for ${failed.length}/${results.length} item(s). Samples: ${samples}`
    );
  }

  return warnings;
}
