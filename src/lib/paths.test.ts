import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import {
  DEFAULT_PATHS,
  getBaselineDir,
  getOutputDir,
  getDiffDir,
  getCustomDiffDir,
  getProjectDirs,
  getImagePath,
  getScreenshotFilename,
  parseScreenshotFilename,
  sanitizeForFilename,
  getAcceptancesPath,
  getReportPath,
  getVrtDir,
  getProjectStorePath,
  getBatchResultsPath,
  getTempInputDir,
} from './paths.js';

const PROJECT_ROOT = '/project';
const OUTPUT_ROOT = '/output';
const CWD_ROOT = '/cwd';

describe('DEFAULT_PATHS', () => {
  it('has expected baseline dir', () => {
    expect(DEFAULT_PATHS.baselineDir).toBe('./.vrt/baselines');
  });

  it('has expected output dir', () => {
    expect(DEFAULT_PATHS.outputDir).toBe('./.vrt/output');
  });
});

describe('getBaselineDir', () => {
  it('uses default path when no config provided', () => {
    const result = getBaselineDir(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/baselines'));
  });

  it('uses config baselineDir when provided', () => {
    const result = getBaselineDir(PROJECT_ROOT, {
      baselineDir: 'custom/baselines',
      outputDir: '',
    });
    expect(result).toBe(resolve(PROJECT_ROOT, 'custom/baselines'));
  });

  it('handles absolute config paths', () => {
    const result = getBaselineDir(PROJECT_ROOT, {
      baselineDir: '/absolute/baselines',
      outputDir: '',
    });
    expect(result).toBe('/absolute/baselines');
  });
});

describe('getOutputDir', () => {
  it('uses default path when no config provided', () => {
    const result = getOutputDir(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output'));
  });

  it('uses config outputDir when provided', () => {
    const result = getOutputDir(PROJECT_ROOT, { baselineDir: '', outputDir: 'custom/output' });
    expect(result).toBe(resolve(PROJECT_ROOT, 'custom/output'));
  });

  it('handles absolute config paths', () => {
    const result = getOutputDir(PROJECT_ROOT, { baselineDir: '', outputDir: '/absolute/output' });
    expect(result).toBe('/absolute/output');
  });
});

describe('getDiffDir', () => {
  it('appends diffs to output dir', () => {
    const result = getDiffDir(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'diffs'));
  });

  it('uses config outputDir', () => {
    const result = getDiffDir(PROJECT_ROOT, { baselineDir: '', outputDir: 'out' });
    expect(result).toBe(resolve(PROJECT_ROOT, 'out', 'diffs'));
  });
});

describe('getCustomDiffDir', () => {
  it('appends custom-diffs to output dir', () => {
    const result = getCustomDiffDir(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'custom-diffs'));
  });

  it('uses config outputDir', () => {
    const result = getCustomDiffDir(PROJECT_ROOT, { baselineDir: '', outputDir: 'out' });
    expect(result).toBe(resolve(PROJECT_ROOT, 'out', 'custom-diffs'));
  });
});

describe('getProjectDirs', () => {
  it('returns all directories', () => {
    const result = getProjectDirs(PROJECT_ROOT);
    expect(result).toEqual({
      baselineDir: resolve(PROJECT_ROOT, './.vrt/baselines'),
      outputDir: resolve(PROJECT_ROOT, './.vrt/output'),
      diffDir: resolve(PROJECT_ROOT, './.vrt/output', 'diffs'),
      customDiffDir: resolve(PROJECT_ROOT, './.vrt/output', 'custom-diffs'),
    });
  });

  it('uses custom config for all paths', () => {
    const config = { baselineDir: 'base', outputDir: 'out' };
    const result = getProjectDirs(PROJECT_ROOT, config);
    expect(result).toEqual({
      baselineDir: resolve(PROJECT_ROOT, 'base'),
      outputDir: resolve(PROJECT_ROOT, 'out'),
      diffDir: resolve(PROJECT_ROOT, 'out', 'diffs'),
      customDiffDir: resolve(PROJECT_ROOT, 'out', 'custom-diffs'),
    });
  });
});

describe('getImagePath', () => {
  it('returns baseline path', () => {
    const result = getImagePath(PROJECT_ROOT, 'baseline', 'test.png');
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/baselines', 'test.png'));
  });

  it('returns test path', () => {
    const result = getImagePath(PROJECT_ROOT, 'test', 'test.png');
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'test.png'));
  });

  it('returns diff path', () => {
    const result = getImagePath(PROJECT_ROOT, 'diff', 'test.png');
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'diffs', 'test.png'));
  });

  it('returns custom-diff path', () => {
    const result = getImagePath(PROJECT_ROOT, 'custom-diff', 'test.png');
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'custom-diffs', 'test.png'));
  });

  it('uses config for path resolution', () => {
    const config = { baselineDir: 'base', outputDir: 'out' };
    const result = getImagePath(PROJECT_ROOT, 'baseline', 'img.png', config);
    expect(result).toBe(resolve(PROJECT_ROOT, 'base', 'img.png'));
  });

  it('throws on invalid image type', () => {
    expect(() => getImagePath('/project', 'invalid' as never, 'test.png')).toThrow(
      'Invalid image type: invalid'
    );
  });
});

describe('sanitizeForFilename', () => {
  it('replaces forward slashes with dashes', () => {
    expect(sanitizeForFilename('Route: /contracts/thanks')).toBe('Route_-contracts-thanks');
  });

  it('replaces backslashes with dashes', () => {
    expect(sanitizeForFilename('path\\to\\file')).toBe('path-to-file');
  });

  it('replaces whitespace with underscores', () => {
    expect(sanitizeForFilename('my page name')).toBe('my_page_name');
  });

  it('replaces illegal characters', () => {
    expect(sanitizeForFilename('file<>:"|?*name')).toBe('file_name');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeForFilename('a//b///c')).toBe('a-b-c');
  });

  it('collapses multiple underscores', () => {
    expect(sanitizeForFilename('a   b    c')).toBe('a_b_c');
  });

  it('trims leading and trailing dashes/underscores', () => {
    expect(sanitizeForFilename('/start')).toBe('start');
    expect(sanitizeForFilename('end/')).toBe('end');
    expect(sanitizeForFilename(' padded ')).toBe('padded');
  });

  it('handles complex scenario names', () => {
    expect(sanitizeForFilename('Modal: /contracts/marketing-agreement - Download Modal')).toBe(
      'Modal_-contracts-marketing-agreement_-_Download_Modal'
    );
  });
});

describe('getScreenshotFilename', () => {
  it('formats filename without version', () => {
    const result = getScreenshotFilename('homepage', 'chromium', 'desktop');
    expect(result).toBe('homepage_chromium_desktop.png');
  });

  it('formats filename with version', () => {
    const result = getScreenshotFilename('homepage', 'chromium', 'desktop', '130');
    expect(result).toBe('homepage_chromium-v130_desktop.png');
  });

  it('handles special characters in scenario name', () => {
    const result = getScreenshotFilename('my-page', 'firefox', 'mobile');
    expect(result).toBe('my-page_firefox_mobile.png');
  });

  it('handles empty version string', () => {
    const result = getScreenshotFilename('test', 'webkit', 'tablet', '');
    expect(result).toBe('test_webkit_tablet.png');
  });

  it('sanitizes scenario names with slashes', () => {
    const result = getScreenshotFilename('Route: /contracts/thanks', 'chromium', 'desktop');
    expect(result).toBe('Route_-contracts-thanks_chromium_desktop.png');
  });

  it('sanitizes modal scenario names', () => {
    const result = getScreenshotFilename(
      'Modal: /contracts/marketing-agreement - Download Modal',
      'webkit',
      'mobile',
      '17.4'
    );
    expect(result).toBe(
      'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png'
    );
  });
});

describe('getAcceptancesPath', () => {
  it('returns acceptances.json path in .vrt dir', () => {
    const result = getAcceptancesPath(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, '.vrt', 'acceptances.json'));
  });
});

describe('getReportPath', () => {
  it('returns report.html in output dir', () => {
    const result = getReportPath(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, './.vrt/output', 'report.html'));
  });

  it('uses config outputDir', () => {
    const result = getReportPath(PROJECT_ROOT, { baselineDir: '', outputDir: 'custom' });
    expect(result).toBe(resolve(PROJECT_ROOT, 'custom', 'report.html'));
  });
});

describe('getVrtDir', () => {
  it('returns .vrt directory path', () => {
    const result = getVrtDir(PROJECT_ROOT);
    expect(result).toBe(resolve(PROJECT_ROOT, '.vrt'));
  });
});

describe('getProjectStorePath', () => {
  it('returns projects.json path in .vrt dir', () => {
    const result = getProjectStorePath(CWD_ROOT);
    expect(result).toBe(resolve(CWD_ROOT, '.vrt', 'projects.json'));
  });
});

describe('getBatchResultsPath', () => {
  it('returns batch-results.json in output dir', () => {
    const result = getBatchResultsPath(OUTPUT_ROOT);
    expect(result).toBe(resolve(OUTPUT_ROOT, 'batch-results.json'));
  });
});

describe('getTempInputDir', () => {
  it('returns .tmp-input in output dir', () => {
    const result = getTempInputDir(OUTPUT_ROOT);
    expect(result).toBe(resolve(OUTPUT_ROOT, '.tmp-input'));
  });
});

describe('parseScreenshotFilename', () => {
  const scenarios = [
    { name: 'Route: /contracts/thanks' },
    { name: 'Route: /contracts/marketing-agreement-download' },
    { name: 'Modal: /contracts/marketing-agreement - Download Modal' },
  ];
  const viewports = [{ name: 'desktop' }, { name: 'tablet' }, { name: 'mobile' }];

  it('parses simple filename without version', () => {
    const browsers = ['chromium'];
    const result = parseScreenshotFilename(
      'Route_-contracts-thanks_chromium_desktop.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toEqual({
      scenario: 'Route: /contracts/thanks',
      browser: 'chromium',
      version: undefined,
      viewport: 'desktop',
    });
  });

  it('parses filename with dotted version in config', () => {
    const browsers = [{ name: 'webkit', version: '17.4' }];
    const result = parseScreenshotFilename(
      'Route_-contracts-marketing-agreement-download_webkit-v17.4_tablet.png',
      scenarios,
      browsers as (string | { name: string; version?: string })[],
      viewports
    );
    expect(result).toEqual({
      scenario: 'Route: /contracts/marketing-agreement-download',
      browser: 'webkit',
      version: '17.4',
      viewport: 'tablet',
    });
  });

  it('parses filename with dotted version NOT in config (fallback)', () => {
    const browsers = ['webkit'];
    const result = parseScreenshotFilename(
      'Route_-contracts-marketing-agreement-download_webkit-v17.4_tablet.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toEqual({
      scenario: 'Route: /contracts/marketing-agreement-download',
      browser: 'webkit',
      version: '17.4',
      viewport: 'tablet',
    });
  });

  it('parses filename with integer version NOT in config (fallback)', () => {
    const browsers = ['chromium'];
    const result = parseScreenshotFilename(
      'Route_-contracts-thanks_chromium-v130_desktop.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toEqual({
      scenario: 'Route: /contracts/thanks',
      browser: 'chromium',
      version: '130',
      viewport: 'desktop',
    });
  });

  it('parses filename with multi-segment dotted version (fallback)', () => {
    const browsers = ['webkit'];
    const result = parseScreenshotFilename(
      'Route_-contracts-thanks_webkit-v18.0_desktop.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toEqual({
      scenario: 'Route: /contracts/thanks',
      browser: 'webkit',
      version: '18.0',
      viewport: 'desktop',
    });
  });

  it('parses filename with complex scenario name and version', () => {
    const browsers = ['webkit'];
    const result = parseScreenshotFilename(
      'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toEqual({
      scenario: 'Modal: /contracts/marketing-agreement - Download Modal',
      browser: 'webkit',
      version: '17.4',
      viewport: 'mobile',
    });
  });

  it('returns null for unrecognized filename', () => {
    const browsers = ['chromium'];
    const result = parseScreenshotFilename('unknown_file_name.png', scenarios, browsers, viewports);
    expect(result).toBeNull();
  });

  it('skips fallback for browsers that already have version in config', () => {
    // If config has { name: "webkit", version: "18.0" }, don't re-detect version
    const browsers: (string | { name: string; version?: string })[] = [
      { name: 'webkit', version: '18.0' },
    ];
    // File with 17.4 won't match config with 18.0
    const result = parseScreenshotFilename(
      'Route_-contracts-thanks_webkit-v17.4_desktop.png',
      scenarios,
      browsers,
      viewports
    );
    expect(result).toBeNull();
  });
});
