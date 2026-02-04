/**
 * Browser version mappings for multi-version VRT support.
 *
 * Each Playwright version bundles specific Chromium and WebKit versions.
 * We map user-friendly browser versions to Playwright versions.
 */

export interface BrowserVersionInfo {
  playwrightVersion: string;
  chromiumVersion: string;
  webkitVersion: string;
  year: number;
  baseImage: string; // Docker base image suffix (focal, jammy, noble)
}

// Playwright version → bundled browser versions
// Source: https://playwright.dev/docs/release-notes
// Base images: focal (20.04), jammy (22.04), noble (24.04)
export const PLAYWRIGHT_VERSIONS: Record<string, BrowserVersionInfo> = {
  '1.49.1': {
    playwrightVersion: '1.49.1',
    chromiumVersion: '130',
    webkitVersion: '18.0',
    year: 2024,
    baseImage: 'noble',
  },
  '1.40.0': {
    playwrightVersion: '1.40.0',
    chromiumVersion: '120',
    webkitVersion: '17.4',
    year: 2023,
    baseImage: 'jammy',
  },
  '1.30.0': {
    playwrightVersion: '1.30.0',
    chromiumVersion: '108',
    webkitVersion: '16.4',
    year: 2022,
    baseImage: 'jammy',
  },
  '1.20.0': {
    playwrightVersion: '1.20.0',
    chromiumVersion: '93',
    webkitVersion: '15.4',
    year: 2021,
    baseImage: 'focal',
  },
  '1.10.0': {
    playwrightVersion: '1.10.0',
    chromiumVersion: '80',
    webkitVersion: '14.1',
    year: 2020,
    baseImage: 'focal',
  },
};

// Browser version → Playwright version lookup
const CHROMIUM_TO_PLAYWRIGHT: Record<string, string> = {};
const WEBKIT_TO_PLAYWRIGHT: Record<string, string> = {};

// Build reverse lookups
for (const [pwVersion, info] of Object.entries(PLAYWRIGHT_VERSIONS)) {
  CHROMIUM_TO_PLAYWRIGHT[info.chromiumVersion] = pwVersion;
  WEBKIT_TO_PLAYWRIGHT[info.webkitVersion] = pwVersion;
}

export const LATEST_PLAYWRIGHT_VERSION = '1.49.1';

function isLatestVersion(version?: string): version is undefined | 'latest' {
  return !version || version === 'latest';
}

/**
 * Get base image suffix for a Playwright version.
 */
export function getBaseImage(playwrightVersion: string): string {
  const info = PLAYWRIGHT_VERSIONS[playwrightVersion];
  if (!info) {
    return 'noble'; // Default to latest
  }
  return info.baseImage;
}

/**
 * Get Playwright version for a browser version.
 */
export function getPlaywrightVersion(browser: 'chromium' | 'webkit', version?: string): string {
  if (isLatestVersion(version)) {
    return LATEST_PLAYWRIGHT_VERSION;
  }

  const lookup = browser === 'chromium' ? CHROMIUM_TO_PLAYWRIGHT : WEBKIT_TO_PLAYWRIGHT;
  const pwVersion = lookup[version];

  if (!pwVersion) {
    const available = Object.keys(lookup).join(', ');
    throw new Error(`Unknown ${browser} version: ${version}. Available: ${available}`);
  }

  return pwVersion;
}

/**
 * Get Docker image tag for a browser version.
 */
export function getDockerImageTag(browser: 'chromium' | 'webkit', version?: string): string {
  const pwVersion = getPlaywrightVersion(browser, version);
  return `vrt-playwright:v${pwVersion}`;
}

/**
 * Get baseline directory suffix for a browser version.
 * Returns empty string for latest, "-vXXX" for specific versions.
 */
export function getBaselineSuffix(browser: 'chromium' | 'webkit', version?: string): string {
  if (isLatestVersion(version)) {
    return '';
  }
  return `-v${version}`;
}

/**
 * Get all unique Playwright versions needed for a set of browser configs.
 */
export function getRequiredPlaywrightVersions(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[]
): string[] {
  const versions = new Set<string>();

  for (const browser of browsers) {
    if (typeof browser === 'string') {
      versions.add(LATEST_PLAYWRIGHT_VERSION);
    } else {
      versions.add(getPlaywrightVersion(browser.name, browser.version));
    }
  }

  return Array.from(versions);
}

/**
 * Normalize browser config to standard format.
 */
export function normalizeBrowserConfig(
  browser: string | { name: 'chromium' | 'webkit'; version?: string }
): { name: 'chromium' | 'webkit'; version?: string } {
  if (typeof browser === 'string') {
    return { name: browser as 'chromium' | 'webkit' };
  }
  return browser;
}

/**
 * Get display name for a browser config.
 */
export function getBrowserDisplayName(
  browser: string | { name: 'chromium' | 'webkit'; version?: string }
): string {
  const config = normalizeBrowserConfig(browser);
  if (config.version) {
    return `${config.name}-v${config.version}`;
  }
  return config.name;
}

/**
 * List all available browser versions.
 */
export function listAvailableVersions(): { chromium: string[]; webkit: string[] } {
  return {
    chromium: Object.values(PLAYWRIGHT_VERSIONS).map((v) => v.chromiumVersion),
    webkit: Object.values(PLAYWRIGHT_VERSIONS).map((v) => v.webkitVersion),
  };
}
