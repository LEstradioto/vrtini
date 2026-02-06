/**
 * Centralized path resolution for VRT.
 */
import { resolve } from 'path';

export interface PathConfig {
  baselineDir: string;
  outputDir: string;
}

export const DEFAULT_PATHS: PathConfig = {
  baselineDir: './.vrt/baselines',
  outputDir: './.vrt/output',
};

export type ImageType = 'baseline' | 'test' | 'diff' | 'custom-diff';

export function getBaselineDir(projectPath: string, config?: PathConfig): string {
  const dir = config?.baselineDir ?? DEFAULT_PATHS.baselineDir;
  return resolve(projectPath, dir);
}

export function getOutputDir(projectPath: string, config?: PathConfig): string {
  const dir = config?.outputDir ?? DEFAULT_PATHS.outputDir;
  return resolve(projectPath, dir);
}

export function getDiffDir(projectPath: string, config?: PathConfig): string {
  return resolve(getOutputDir(projectPath, config), 'diffs');
}

export function getCustomDiffDir(projectPath: string, config?: PathConfig): string {
  return resolve(getOutputDir(projectPath, config), 'custom-diffs');
}

export function getProjectDirs(
  projectPath: string,
  config?: PathConfig
): {
  baselineDir: string;
  outputDir: string;
  diffDir: string;
  customDiffDir: string;
} {
  return {
    baselineDir: getBaselineDir(projectPath, config),
    outputDir: getOutputDir(projectPath, config),
    diffDir: getDiffDir(projectPath, config),
    customDiffDir: getCustomDiffDir(projectPath, config),
  };
}

export function getImagePath(
  projectPath: string,
  type: ImageType,
  filename: string,
  config?: PathConfig
): string {
  switch (type) {
    case 'baseline':
      return resolve(getBaselineDir(projectPath, config), filename);
    case 'test':
      return resolve(getOutputDir(projectPath, config), filename);
    case 'diff':
      return resolve(getDiffDir(projectPath, config), filename);
    case 'custom-diff':
      return resolve(getCustomDiffDir(projectPath, config), filename);
    default:
      throw new Error(`Invalid image type: ${type}`);
  }
}

/**
 * Sanitize a string for use in filenames.
 * Replaces problematic characters with safe alternatives.
 */
export function sanitizeForFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '-') // Replace path separators with dash
    .replace(/[<>:"|?*]/g, '_') // Replace other illegal chars with underscore
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^[-_]+|[-_]+$/g, ''); // Trim leading/trailing dashes/underscores
}

/**
 * Format: scenarioName_browser-vVersion_viewport.png
 * Example: homepage_chromium-v130_desktop.png
 */
export function getScreenshotFilename(
  scenarioName: string,
  browser: string,
  viewportName: string,
  version?: string
): string {
  const sanitizedName = sanitizeForFilename(scenarioName);
  const browserPart = version ? `${browser}-v${version}` : browser;
  return `${sanitizedName}_${browserPart}_${viewportName}.png`;
}

/**
 * Derive snapshot filename from screenshot filename.
 * e.g., "homepage_chromium_desktop.png" -> "homepage_chromium_desktop.snapshot.json"
 */
export function getSnapshotFilename(screenshotFilename: string): string {
  return screenshotFilename.replace(/\.png$/, '.snapshot.json');
}

export function getAcceptancesPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances.json');
}

export function getReportPath(projectPath: string, config?: PathConfig): string {
  return resolve(getOutputDir(projectPath, config), 'report.html');
}

export function getVrtDir(projectPath: string): string {
  return resolve(projectPath, '.vrt');
}

export function getProjectStorePath(cwd: string): string {
  return resolve(cwd, '.vrt', 'projects.json');
}

export function getBatchResultsPath(outputDir: string): string {
  return resolve(outputDir, 'batch-results.json');
}

export function getTempInputDir(outputDir: string): string {
  return resolve(outputDir, '.tmp-input');
}

export function getImageMetadataPath(dir: string): string {
  return resolve(dir, 'metadata.json');
}

/**
 * Extract a version suffix from the browser segment of a filename.
 * Matches patterns like "webkit-v17.4" -> "17.4", "chromium-v130" -> "130".
 */
function extractVersionFromBrowserSegment(filename: string, browser: string): string | undefined {
  const versionPattern = new RegExp(`_${browser}-v(\\d+(?:\\.\\d+)*)_`);
  const match = filename.match(versionPattern);
  return match?.[1];
}

/**
 * Given a screenshot filename and config arrays, find which scenario/browser/viewport
 * produced it by brute-force matching against getScreenshotFilename output.
 *
 * First tries exact config matches. If that fails, attempts to detect versioned
 * browser names in the filename (e.g., "webkit-v17.4") even when the config only
 * specifies a bare browser name (e.g., "webkit").
 */
export function parseScreenshotFilename(
  filename: string,
  scenarios: { name: string }[],
  browsers: (string | { name: string; version?: string })[],
  viewports: { name: string }[]
): { scenario: string; browser: string; version?: string; viewport: string } | null {
  const firstMatch = findScreenshotMatch(
    filename,
    scenarios,
    browsers,
    viewports,
    (browserConfig) => (typeof browserConfig === 'string' ? undefined : browserConfig.version)
  );
  if (firstMatch) return firstMatch;

  // Fallback: try detecting versioned browser names not explicitly in config.
  // Handles cases where config has "webkit" but files have "webkit-v17.4".
  return findScreenshotMatch(filename, scenarios, browsers, viewports, (browserConfig, browser) => {
    const configVersion = typeof browserConfig === 'string' ? undefined : browserConfig.version;
    if (configVersion) return null;
    return extractVersionFromBrowserSegment(filename, browser) ?? null;
  });
}

type BrowserConfig = string | { name: string; version?: string };
type VersionSelector = (browserConfig: BrowserConfig, browser: string) => string | undefined | null;

function findScreenshotMatch(
  filename: string,
  scenarios: { name: string }[],
  browsers: BrowserConfig[],
  viewports: { name: string }[],
  getVersion: VersionSelector
): { scenario: string; browser: string; version?: string; viewport: string } | null {
  for (const scenario of scenarios) {
    for (const browserConfig of browsers) {
      const browser = typeof browserConfig === 'string' ? browserConfig : browserConfig.name;
      const version = getVersion(browserConfig, browser);
      if (version === null) continue;
      for (const viewport of viewports) {
        const candidate = getScreenshotFilename(scenario.name, browser, viewport.name, version);
        if (candidate === filename) {
          return {
            scenario: scenario.name,
            browser,
            version: version ?? undefined,
            viewport: viewport.name,
          };
        }
      }
    }
  }
  return null;
}
