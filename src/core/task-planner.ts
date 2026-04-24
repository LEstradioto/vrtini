/**
 * Pure functions for planning and grouping screenshot tasks.
 * No I/O, no side effects - just data transformations.
 */

import type { Scenario, Viewport, BrowserConfig } from './config.js';
import {
  normalizeBrowserConfig,
  getDockerImageTag,
  getBrowserDisplayName,
} from './browser-versions.js';

/** A screenshot task to be executed */
export interface ScreenshotTask {
  scenario: Scenario;
  browser: 'chromium' | 'webkit';
  version?: string;
  viewport: Viewport;
}

/** A group of tasks sharing the same browser+version (run in one container) */
export interface BrowserTaskGroup {
  browserKey: string;
  browser: 'chromium' | 'webkit';
  version?: string;
  dockerImage: string;
  tasks: ScreenshotTask[];
}

/** Scenario options that can be inherited from defaults */
type ScenarioOptions = Omit<Scenario, 'name' | 'url'>;

/**
 * Merge scenario defaults with a specific scenario.
 * Scenario values take precedence over defaults.
 */
export function mergeScenarioDefaults(scenario: Scenario, defaults?: ScenarioOptions): Scenario {
  if (!defaults) return scenario;
  const mergeArray = (base?: string[], override?: string[]): string[] | undefined => {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;
    return Array.from(new Set([...base, ...override]));
  };

  const combinedBeforeScreenshot =
    defaults.beforeScreenshot && scenario.beforeScreenshot
      ? `(async () => { ${defaults.beforeScreenshot}; ${scenario.beforeScreenshot}; })()`
      : (scenario.beforeScreenshot ?? defaults.beforeScreenshot);

  return {
    ...defaults,
    ...scenario,
    beforeScreenshot: combinedBeforeScreenshot,
    hideSelectors: mergeArray(defaults.hideSelectors, scenario.hideSelectors),
    removeSelectors: mergeArray(defaults.removeSelectors, scenario.removeSelectors),
    blockUrls: mergeArray(defaults.blockUrls, scenario.blockUrls),
  };
}

/**
 * Create a screenshot task for a scenario/browser/viewport combination.
 */
export function createScreenshotTask(
  scenario: Scenario,
  browser: 'chromium' | 'webkit',
  viewport: Viewport,
  version?: string
): ScreenshotTask {
  return { scenario, browser, version, viewport };
}

function createBrowserGroup(params: {
  browserKey: string;
  browser: 'chromium' | 'webkit';
  version?: string;
  dockerImage: string;
}): BrowserTaskGroup {
  return {
    browserKey: params.browserKey,
    browser: params.browser,
    version: params.version,
    dockerImage: params.dockerImage,
    tasks: [],
  };
}

function getOrCreateGroup(
  groups: Map<string, BrowserTaskGroup>,
  browserKey: string,
  browser: 'chromium' | 'webkit',
  version: string | undefined,
  dockerImage: string
): BrowserTaskGroup {
  const existing = groups.get(browserKey);
  if (existing) return existing;

  const created = createBrowserGroup({ browserKey, browser, version, dockerImage });
  groups.set(browserKey, created);
  return created;
}

/**
 * Group scenarios by browser+version for batch processing.
 * Returns a map where each entry represents tasks that can share a Docker container.
 *
 * @param scenarios - Scenarios to process
 * @param browsers - Browser configurations from config
 * @param viewports - Viewports to capture
 * @param scenarioDefaults - Optional default scenario options
 * @returns Map of browserKey -> BrowserTaskGroup
 */
export function groupTasksByBrowser(
  scenarios: Scenario[],
  browsers: BrowserConfig[],
  viewports: Viewport[],
  scenarioDefaults?: ScenarioOptions
): Map<string, BrowserTaskGroup> {
  const groups = new Map<string, BrowserTaskGroup>();

  for (const browserConfig of browsers) {
    const normalized = normalizeBrowserConfig(browserConfig);
    const { name: browser, version } = normalized;
    const browserKey = getBrowserDisplayName(browserConfig);
    const dockerImage = getDockerImageTag(browser, version);

    const group = getOrCreateGroup(groups, browserKey, browser, version, dockerImage);

    for (const scenario of scenarios) {
      const mergedScenario = mergeScenarioDefaults(scenario, scenarioDefaults);
      for (const viewport of viewports) {
        group.tasks.push(createScreenshotTask(mergedScenario, browser, viewport, version));
      }
    }
  }

  return groups;
}

/**
 * Get total task count from browser task groups.
 */
export function getTotalTaskCount(groups: Map<string, BrowserTaskGroup>): number {
  let total = 0;
  for (const group of groups.values()) {
    total += group.tasks.length;
  }
  return total;
}

/**
 * Filter scenarios by name.
 * Returns all scenarios if filter is empty/undefined.
 */
export function filterScenarios(scenarios: Scenario[], filter?: string[]): Scenario[] {
  if (!filter || filter.length === 0) return scenarios;
  return scenarios.filter((s) => filter.includes(s.name));
}

/**
 * Partition groups by Docker image availability.
 * Returns groups with images and the list of missing image tags.
 */
export function partitionGroupsByImageAvailability(
  groups: Map<string, BrowserTaskGroup>,
  imageExists: Map<string, boolean>
): { available: Map<string, BrowserTaskGroup>; missingImages: string[] } {
  const available = new Map<string, BrowserTaskGroup>();
  const missingImages: string[] = [];

  for (const [browserKey, group] of groups) {
    if (imageExists.get(browserKey) === true) {
      available.set(browserKey, group);
    } else {
      missingImages.push(group.dockerImage);
    }
  }

  return { available, missingImages };
}

/**
 * Extract browser keys that are missing Docker images.
 * Takes a map of browserKey -> hasImage boolean.
 */
export function findMissingImages(
  groups: Map<string, BrowserTaskGroup>,
  imageExists: Map<string, boolean>
): string[] {
  return partitionGroupsByImageAvailability(groups, imageExists).missingImages;
}

/**
 * Remove groups with missing Docker images.
 * Returns a new map without the missing groups.
 */
export function filterGroupsWithImages(
  groups: Map<string, BrowserTaskGroup>,
  imageExists: Map<string, boolean>
): Map<string, BrowserTaskGroup> {
  return partitionGroupsByImageAvailability(groups, imageExists).available;
}
