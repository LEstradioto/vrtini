import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IMAGE_METADATA_SCHEMA_VERSION } from '../../../src/core/image-metadata.js';
import { getImageMetadataPath } from '../../../src/core/paths.js';
import {
  parseImageFilename,
  computeAutoThresholdCaps,
  listImages,
  listImagesWithMetadata,
  loadImageFlags,
  setImageFlag,
  revokeImageFlag,
  type Acceptance,
} from './project-service.js';

describe('parseImageFilename', () => {
  it('parses simple filename without version', () => {
    const result = parseImageFilename('homepage_chromium_desktop.png');
    expect(result).toEqual({
      filename: 'homepage_chromium_desktop.png',
      scenario: 'homepage',
      browser: 'chromium',
      version: undefined,
      viewport: 'desktop',
    });
  });

  it('parses filename with integer version', () => {
    const result = parseImageFilename('homepage_chromium-v130_desktop.png');
    expect(result).toEqual({
      filename: 'homepage_chromium-v130_desktop.png',
      scenario: 'homepage',
      browser: 'chromium',
      version: '130',
      viewport: 'desktop',
    });
  });

  it('parses filename with dotted version', () => {
    const result = parseImageFilename('homepage_webkit-v17.4_tablet.png');
    expect(result).toEqual({
      filename: 'homepage_webkit-v17.4_tablet.png',
      scenario: 'homepage',
      browser: 'webkit',
      version: '17.4',
      viewport: 'tablet',
    });
  });

  it('parses multi-underscore scenario with dotted version', () => {
    const result = parseImageFilename(
      'Route_-contracts-marketing-agreement-download_webkit-v17.4_tablet.png'
    );
    expect(result).toEqual({
      filename: 'Route_-contracts-marketing-agreement-download_webkit-v17.4_tablet.png',
      scenario: 'Route_-contracts-marketing-agreement-download',
      browser: 'webkit',
      version: '17.4',
      viewport: 'tablet',
    });
  });

  it('parses complex scenario with browser without version', () => {
    const result = parseImageFilename('Route_-contracts-thanks_chromium_desktop.png');
    expect(result).toEqual({
      filename: 'Route_-contracts-thanks_chromium_desktop.png',
      scenario: 'Route_-contracts-thanks',
      browser: 'chromium',
      version: undefined,
      viewport: 'desktop',
    });
  });

  it('parses filename with multi-segment dotted version', () => {
    const result = parseImageFilename('homepage_webkit-v18.0_mobile.png');
    expect(result).toEqual({
      filename: 'homepage_webkit-v18.0_mobile.png',
      scenario: 'homepage',
      browser: 'webkit',
      version: '18.0',
      viewport: 'mobile',
    });
  });

  it('handles filename with fewer than 3 underscore segments', () => {
    const result = parseImageFilename('simple.png');
    expect(result).toEqual({
      filename: 'simple.png',
      scenario: 'simple',
      browser: 'unknown',
      viewport: 'unknown',
    });
  });

  it('falls back for unrecognized browser segment', () => {
    const result = parseImageFilename('scenario_unknownbrowser_desktop.png');
    expect(result).toEqual({
      filename: 'scenario_unknownbrowser_desktop.png',
      scenario: 'scenario',
      browser: 'unknownbrowser',
      viewport: 'desktop',
    });
  });

  it('parses complex scenario with underscores and version', () => {
    const result = parseImageFilename(
      'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png'
    );
    expect(result).toEqual({
      filename: 'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png',
      scenario: 'Modal_-contracts-marketing-agreement_-_Download_Modal',
      browser: 'webkit',
      version: '17.4',
      viewport: 'mobile',
    });
  });
});

describe('computeAutoThresholdCaps', () => {
  const baseAcceptance = (overrides: Partial<Acceptance>): Acceptance => ({
    filename: 'landing_chromium_desktop.png',
    acceptedAt: '2026-02-03T00:00:00.000Z',
    comparedAgainst: { filename: 'landing_chromium_desktop.png', type: 'baseline' },
    metrics: { diffPercentage: 0.1, pixelDiff: 10 },
    signals: { scenario: 'landing', viewport: 'desktop' },
    ...overrides,
  });

  it('computes P95 caps per scenario+viewport and skips undersampled groups', () => {
    const acceptances: Acceptance[] = [
      baseAcceptance({ metrics: { diffPercentage: 0.1, pixelDiff: 10 } }),
      baseAcceptance({ metrics: { diffPercentage: 0.2, pixelDiff: 20 } }),
      baseAcceptance({ metrics: { diffPercentage: 0.3, pixelDiff: 30 } }),
      baseAcceptance({ metrics: { diffPercentage: 0.4, pixelDiff: 40 } }),
      baseAcceptance({ metrics: { diffPercentage: 0.5, pixelDiff: 50 } }),
      baseAcceptance({
        filename: 'landing_chromium_mobile.png',
        metrics: { diffPercentage: 0.15, pixelDiff: 15 },
        signals: { scenario: 'landing', viewport: 'mobile' },
      }),
      baseAcceptance({
        filename: 'landing_chromium_mobile.png',
        metrics: { diffPercentage: 0.25, pixelDiff: 25 },
        signals: { scenario: 'landing', viewport: 'mobile' },
      }),
    ];

    const result = computeAutoThresholdCaps(acceptances);

    expect(result.percentile).toBe(0.95);
    expect(result.minSampleSize).toBe(5);
    expect(Object.keys(result.caps)).toEqual(['landing::desktop']);
    expect(result.caps['landing::desktop']).toEqual({
      scenario: 'landing',
      viewport: 'desktop',
      sampleSize: 5,
      p95DiffPercentage: 0.5,
      p95PixelDiff: 50,
      pixelSampleSize: 5,
    });
  });

  it('falls back to filename metadata and honors custom sampling options', () => {
    const acceptances: Acceptance[] = [
      baseAcceptance({
        filename: 'about_webkit_tablet.png',
        metrics: { diffPercentage: 1.2, pixelDiff: 120 },
        signals: undefined,
      }),
      baseAcceptance({
        filename: 'about_webkit_tablet.png',
        metrics: { diffPercentage: 2.4, pixelDiff: 240 },
        signals: undefined,
      }),
      baseAcceptance({
        filename: 'about_webkit_tablet.png',
        metrics: { diffPercentage: 3.6 },
        signals: undefined,
      }),
    ];

    const result = computeAutoThresholdCaps(acceptances, { percentile: 0.9, minSampleSize: 2 });

    expect(result.percentile).toBe(0.9);
    expect(result.minSampleSize).toBe(2);
    expect(result.caps['about::tablet']).toEqual({
      scenario: 'about',
      viewport: 'tablet',
      sampleSize: 3,
      p95DiffPercentage: 3.6,
      p95PixelDiff: 240,
      pixelSampleSize: 2,
    });
  });
});

describe('image flags', () => {
  it('persists, updates, and revokes flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vrt-flags-'));

    try {
      const first = await setImageFlag(dir, {
        filename: 'homepage_chromium_desktop.png',
        reason: 'Needs product review',
      });
      expect(first.flaggedAt).toEqual(expect.any(String));
      expect(first.reason).toBe('Needs product review');

      const updated = await setImageFlag(dir, {
        filename: 'homepage_chromium_desktop.png',
        reason: 'Still under review',
      });
      expect(updated.flaggedAt).toEqual(expect.any(String));
      expect(updated.reason).toBe('Still under review');

      const flags = await loadImageFlags(dir);
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({
        filename: 'homepage_chromium_desktop.png',
        reason: 'Still under review',
      });

      expect(await revokeImageFlag(dir, 'homepage_chromium_desktop.png')).toBe(true);
      expect(await loadImageFlags(dir)).toEqual([]);
      expect(await revokeImageFlag(dir, 'homepage_chromium_desktop.png')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('listImagesWithMetadata', () => {
  it('prefers persisted metadata when available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vrt-meta-'));
    try {
      const filename = 'My_Page_chromium_desktop.png';
      await writeFile(join(dir, filename), '');

      const metadataFile = {
        schemaVersion: IMAGE_METADATA_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        images: {
          [filename]: {
            filename,
            scenario: 'My Page',
            browser: 'chromium',
            viewport: 'desktop',
          },
        },
      };

      await writeFile(getImageMetadataPath(dir), JSON.stringify(metadataFile, null, 2));

      const result = await listImagesWithMetadata(dir);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename,
        scenario: 'My Page',
        browser: 'chromium',
        viewport: 'desktop',
      });
      expect(result[0].updatedAt).toEqual(expect.any(String));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores unsupported metadata schema versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vrt-meta-'));
    try {
      const filename = 'My_Page_chromium_desktop.png';
      await writeFile(join(dir, filename), '');

      const metadataFile = {
        schemaVersion: IMAGE_METADATA_SCHEMA_VERSION + 1,
        generatedAt: new Date().toISOString(),
        images: {
          [filename]: {
            filename,
            scenario: 'My Page',
            browser: 'chromium',
            viewport: 'desktop',
          },
        },
      };

      await writeFile(getImageMetadataPath(dir), JSON.stringify(metadataFile, null, 2));

      const result = await listImagesWithMetadata(dir);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename,
        scenario: 'My_Page',
        browser: 'chromium',
        viewport: 'desktop',
      });
      expect(result[0].updatedAt).toEqual(expect.any(String));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('listImages', () => {
  it('excludes engine artifact png files from listings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vrt-images-'));
    try {
      await Promise.all([
        writeFile(join(dir, 'Route_-about_webkit_mobile.png'), ''),
        writeFile(join(dir, 'Route_-about_webkit_mobile-odiff.png'), ''),
        writeFile(join(dir, 'Route_-about_webkit_mobile-pixelmatch.png'), ''),
        writeFile(join(dir, 'readme.txt'), ''),
      ]);

      const result = await listImages(dir);

      expect(result).toEqual(['Route_-about_webkit_mobile.png']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
