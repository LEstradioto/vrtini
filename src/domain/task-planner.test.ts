import { describe, it, expect } from 'vitest';
import {
  mergeScenarioDefaults,
  createScreenshotTask,
  groupTasksByBrowser,
  getTotalTaskCount,
  filterScenarios,
  partitionGroupsByImageAvailability,
  findMissingImages,
  filterGroupsWithImages,
  type BrowserTaskGroup,
} from './task-planner.js';
import type { Scenario, Viewport, BrowserConfig } from '../config.js';

// Test fixtures
const baseScenario: Scenario = {
  name: 'homepage',
  url: 'https://example.com',
};

const scenarioWithOptions: Scenario = {
  name: 'login',
  url: 'https://example.com/login',
  waitFor: 'networkidle',
  selector: '#main',
};

const desktopViewport: Viewport = { name: 'desktop', width: 1920, height: 1080 };
const mobileViewport: Viewport = { name: 'mobile', width: 375, height: 812 };

function makeGroup(
  browser: 'chromium' | 'webkit',
  dockerImage = 'vrt-playwright:v1.49.1',
  tasks: BrowserTaskGroup['tasks'] = []
): BrowserTaskGroup {
  return {
    browserKey: browser,
    browser,
    dockerImage,
    tasks,
  };
}

describe('mergeScenarioDefaults', () => {
  it('returns scenario unchanged when no defaults', () => {
    const result = mergeScenarioDefaults(baseScenario);
    expect(result).toBe(baseScenario);
  });

  it('returns scenario unchanged when defaults is undefined', () => {
    const result = mergeScenarioDefaults(baseScenario, undefined);
    expect(result).toBe(baseScenario);
  });

  it('applies defaults to scenario without options', () => {
    const defaults = { waitFor: 'load' as const, fullPage: true };
    const result = mergeScenarioDefaults(baseScenario, defaults);
    expect(result).toEqual({
      name: 'homepage',
      url: 'https://example.com',
      waitFor: 'load',
      fullPage: true,
    });
  });

  it('scenario options override defaults', () => {
    const defaults = { waitFor: 'load' as const, fullPage: true };
    const result = mergeScenarioDefaults(scenarioWithOptions, defaults);
    expect(result.waitFor).toBe('networkidle'); // scenario value wins
    expect(result.fullPage).toBe(true); // default applied
    expect(result.selector).toBe('#main'); // scenario value preserved
  });

  it('preserves name and url from scenario', () => {
    const defaults = { waitFor: 'domcontentloaded' as const };
    const result = mergeScenarioDefaults(baseScenario, defaults);
    expect(result.name).toBe('homepage');
    expect(result.url).toBe('https://example.com');
  });
});

describe('createScreenshotTask', () => {
  it('creates task with required fields', () => {
    const task = createScreenshotTask(baseScenario, 'chromium', desktopViewport);
    expect(task).toEqual({
      scenario: baseScenario,
      browser: 'chromium',
      viewport: desktopViewport,
      version: undefined,
    });
  });

  it('creates task with version', () => {
    const task = createScreenshotTask(baseScenario, 'webkit', mobileViewport, '18.0');
    expect(task).toEqual({
      scenario: baseScenario,
      browser: 'webkit',
      viewport: mobileViewport,
      version: '18.0',
    });
  });

  it('preserves scenario reference', () => {
    const task = createScreenshotTask(scenarioWithOptions, 'chromium', desktopViewport);
    expect(task.scenario).toBe(scenarioWithOptions);
  });
});

describe('groupTasksByBrowser', () => {
  it('creates groups for single browser string config', () => {
    const scenarios = [baseScenario];
    const browsers: BrowserConfig[] = ['chromium'];
    const viewports = [desktopViewport];

    const groups = groupTasksByBrowser(scenarios, browsers, viewports);

    expect(groups.size).toBe(1);
    expect(groups.has('chromium')).toBe(true);

    const group = groups.get('chromium')!;
    expect(group.browser).toBe('chromium');
    expect(group.version).toBeUndefined();
    expect(group.tasks.length).toBe(1);
    expect(group.tasks[0].scenario.name).toBe('homepage');
  });

  it('creates groups for browser object with version', () => {
    const scenarios = [baseScenario];
    const browsers: BrowserConfig[] = [{ name: 'chromium', version: '130' }];
    const viewports = [desktopViewport];

    const groups = groupTasksByBrowser(scenarios, browsers, viewports);

    expect(groups.size).toBe(1);
    expect(groups.has('chromium-v130')).toBe(true);

    const group = groups.get('chromium-v130')!;
    expect(group.browser).toBe('chromium');
    expect(group.version).toBe('130');
    expect(group.dockerImage).toBe('vrt-playwright:v1.49.1');
  });

  it('creates separate groups for different browser versions', () => {
    const scenarios = [baseScenario];
    const browsers: BrowserConfig[] = [
      { name: 'chromium', version: '130' },
      { name: 'chromium', version: '120' },
    ];
    const viewports = [desktopViewport];

    const groups = groupTasksByBrowser(scenarios, browsers, viewports);

    expect(groups.size).toBe(2);
    expect(groups.has('chromium-v130')).toBe(true);
    expect(groups.has('chromium-v120')).toBe(true);
  });

  it('creates cartesian product of scenarios and viewports', () => {
    const scenarios = [baseScenario, scenarioWithOptions];
    const browsers: BrowserConfig[] = ['chromium'];
    const viewports = [desktopViewport, mobileViewport];

    const groups = groupTasksByBrowser(scenarios, browsers, viewports);
    const group = groups.get('chromium')!;

    expect(group.tasks.length).toBe(4); // 2 scenarios × 2 viewports
    expect(group.tasks.map((t) => `${t.scenario.name}-${t.viewport.name}`)).toEqual([
      'homepage-desktop',
      'homepage-mobile',
      'login-desktop',
      'login-mobile',
    ]);
  });

  it('applies scenario defaults', () => {
    const scenarios = [baseScenario];
    const browsers: BrowserConfig[] = ['chromium'];
    const viewports = [desktopViewport];
    const defaults = { waitFor: 'networkidle' as const, fullPage: true };

    const groups = groupTasksByBrowser(scenarios, browsers, viewports, defaults);
    const task = groups.get('chromium')!.tasks[0];

    expect(task.scenario.waitFor).toBe('networkidle');
    expect(task.scenario.fullPage).toBe(true);
  });

  it('returns empty map for empty browsers', () => {
    const groups = groupTasksByBrowser([baseScenario], [], [desktopViewport]);
    expect(groups.size).toBe(0);
  });

  it('returns groups with empty tasks for empty scenarios', () => {
    const groups = groupTasksByBrowser([], ['chromium'], [desktopViewport]);
    expect(groups.size).toBe(1);
    expect(groups.get('chromium')!.tasks.length).toBe(0);
  });

  it('returns groups with empty tasks for empty viewports', () => {
    const groups = groupTasksByBrowser([baseScenario], ['chromium'], []);
    expect(groups.size).toBe(1);
    expect(groups.get('chromium')!.tasks.length).toBe(0);
  });
});

describe('getTotalTaskCount', () => {
  it('returns 0 for empty map', () => {
    const groups = new Map<string, BrowserTaskGroup>();
    expect(getTotalTaskCount(groups)).toBe(0);
  });

  it('counts tasks from single group', () => {
    const groups = new Map<string, BrowserTaskGroup>([
      [
        'chromium',
        {
          browserKey: 'chromium',
          browser: 'chromium',
          dockerImage: 'vrt-playwright:v1.49.1',
          tasks: [
            createScreenshotTask(baseScenario, 'chromium', desktopViewport),
            createScreenshotTask(baseScenario, 'chromium', mobileViewport),
          ],
        },
      ],
    ]);
    expect(getTotalTaskCount(groups)).toBe(2);
  });

  it('sums tasks across multiple groups', () => {
    const groups = new Map<string, BrowserTaskGroup>([
      [
        'chromium',
        {
          browserKey: 'chromium',
          browser: 'chromium',
          dockerImage: 'vrt-playwright:v1.49.1',
          tasks: [createScreenshotTask(baseScenario, 'chromium', desktopViewport)],
        },
      ],
      [
        'webkit',
        {
          browserKey: 'webkit',
          browser: 'webkit',
          dockerImage: 'vrt-playwright:v1.49.1',
          tasks: [
            createScreenshotTask(baseScenario, 'webkit', desktopViewport),
            createScreenshotTask(baseScenario, 'webkit', mobileViewport),
          ],
        },
      ],
    ]);
    expect(getTotalTaskCount(groups)).toBe(3);
  });

  it('handles groups with empty tasks', () => {
    const groups = new Map<string, BrowserTaskGroup>([
      [
        'chromium',
        {
          browserKey: 'chromium',
          browser: 'chromium',
          dockerImage: 'vrt-playwright:v1.49.1',
          tasks: [],
        },
      ],
    ]);
    expect(getTotalTaskCount(groups)).toBe(0);
  });
});

describe('filterScenarios', () => {
  const scenarios: Scenario[] = [
    { name: 'homepage', url: 'https://example.com' },
    { name: 'login', url: 'https://example.com/login' },
    { name: 'dashboard', url: 'https://example.com/dashboard' },
  ];

  it('returns all scenarios when filter is undefined', () => {
    const result = filterScenarios(scenarios, undefined);
    expect(result).toBe(scenarios);
  });

  it('returns all scenarios when filter is empty array', () => {
    const result = filterScenarios(scenarios, []);
    expect(result).toBe(scenarios);
  });

  it('filters scenarios by single name', () => {
    const result = filterScenarios(scenarios, ['homepage']);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('homepage');
  });

  it('filters scenarios by multiple names', () => {
    const result = filterScenarios(scenarios, ['homepage', 'login']);
    expect(result.length).toBe(2);
    expect(result.map((s) => s.name)).toEqual(['homepage', 'login']);
  });

  it('returns empty array when no matches', () => {
    const result = filterScenarios(scenarios, ['nonexistent']);
    expect(result).toEqual([]);
  });

  it('returns empty array when filtering empty scenarios', () => {
    const result = filterScenarios([], ['homepage']);
    expect(result).toEqual([]);
  });

  it('ignores filter names that do not exist', () => {
    const result = filterScenarios(scenarios, ['homepage', 'nonexistent']);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('homepage');
  });
});

describe('partitionGroupsByImageAvailability', () => {
  const chromiumGroup = makeGroup('chromium', 'vrt-playwright:v1.49.1', [
    createScreenshotTask(baseScenario, 'chromium', desktopViewport),
  ]);

  const webkitGroup = makeGroup('webkit', 'vrt-playwright:v1.49.1', [
    createScreenshotTask(baseScenario, 'webkit', desktopViewport),
  ]);

  it('returns all groups as available when all images exist', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', true],
      ['webkit', true],
    ]);

    const result = partitionGroupsByImageAvailability(groups, imageExists);

    expect(result.available.size).toBe(2);
    expect(result.missingImages).toEqual([]);
  });

  it('partitions groups by image availability', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', true],
      ['webkit', false],
    ]);

    const result = partitionGroupsByImageAvailability(groups, imageExists);

    expect(result.available.size).toBe(1);
    expect(result.available.has('chromium')).toBe(true);
    expect(result.missingImages).toEqual(['vrt-playwright:v1.49.1']);
  });

  it('returns all groups as missing when no images exist', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', false],
      ['webkit', false],
    ]);

    const result = partitionGroupsByImageAvailability(groups, imageExists);

    expect(result.available.size).toBe(0);
    expect(result.missingImages.length).toBe(2);
  });

  it('handles empty groups', () => {
    const groups = new Map<string, BrowserTaskGroup>();
    const imageExists = new Map<string, boolean>();

    const result = partitionGroupsByImageAvailability(groups, imageExists);

    expect(result.available.size).toBe(0);
    expect(result.missingImages).toEqual([]);
  });

  it('treats missing imageExists entries as unavailable', () => {
    const groups = new Map([['chromium', chromiumGroup]]);
    const imageExists = new Map<string, boolean>(); // empty

    const result = partitionGroupsByImageAvailability(groups, imageExists);

    expect(result.available.size).toBe(0);
    expect(result.missingImages).toEqual(['vrt-playwright:v1.49.1']);
  });
});

describe('findMissingImages', () => {
  const chromiumGroup = makeGroup('chromium', 'vrt-playwright:v1.49.1');
  const webkitGroup = makeGroup('webkit', 'vrt-playwright:v1.40.0');

  it('returns empty array when all images exist', () => {
    const groups = new Map([['chromium', chromiumGroup]]);
    const imageExists = new Map([['chromium', true]]);

    expect(findMissingImages(groups, imageExists)).toEqual([]);
  });

  it('returns docker images for missing entries', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', true],
      ['webkit', false],
    ]);

    expect(findMissingImages(groups, imageExists)).toEqual(['vrt-playwright:v1.40.0']);
  });

  it('returns all docker images when none exist', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', false],
      ['webkit', false],
    ]);

    const missing = findMissingImages(groups, imageExists);
    expect(missing.length).toBe(2);
    expect(missing).toContain('vrt-playwright:v1.49.1');
    expect(missing).toContain('vrt-playwright:v1.40.0');
  });

  it('returns empty array for empty groups', () => {
    const groups = new Map<string, BrowserTaskGroup>();
    const imageExists = new Map<string, boolean>();

    expect(findMissingImages(groups, imageExists)).toEqual([]);
  });
});

describe('filterGroupsWithImages', () => {
  const chromiumGroup = makeGroup('chromium', 'vrt-playwright:v1.49.1', [
    createScreenshotTask(baseScenario, 'chromium', desktopViewport),
  ]);

  const webkitGroup = makeGroup('webkit', 'vrt-playwright:v1.49.1', [
    createScreenshotTask(baseScenario, 'webkit', desktopViewport),
  ]);

  it('returns all groups when all images exist', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', true],
      ['webkit', true],
    ]);

    const result = filterGroupsWithImages(groups, imageExists);

    expect(result.size).toBe(2);
    expect(result.has('chromium')).toBe(true);
    expect(result.has('webkit')).toBe(true);
  });

  it('filters out groups with missing images', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', true],
      ['webkit', false],
    ]);

    const result = filterGroupsWithImages(groups, imageExists);

    expect(result.size).toBe(1);
    expect(result.has('chromium')).toBe(true);
    expect(result.has('webkit')).toBe(false);
  });

  it('returns empty map when no images exist', () => {
    const groups = new Map([
      ['chromium', chromiumGroup],
      ['webkit', webkitGroup],
    ]);
    const imageExists = new Map([
      ['chromium', false],
      ['webkit', false],
    ]);

    const result = filterGroupsWithImages(groups, imageExists);

    expect(result.size).toBe(0);
  });

  it('returns empty map for empty groups', () => {
    const groups = new Map<string, BrowserTaskGroup>();
    const imageExists = new Map<string, boolean>();

    const result = filterGroupsWithImages(groups, imageExists);

    expect(result.size).toBe(0);
  });

  it('preserves original group references', () => {
    const groups = new Map([['chromium', chromiumGroup]]);
    const imageExists = new Map([['chromium', true]]);

    const result = filterGroupsWithImages(groups, imageExists);

    expect(result.get('chromium')).toBe(chromiumGroup);
  });
});
