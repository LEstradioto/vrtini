import { describe, it, expect } from 'vitest';
import { buildImageMetadataIndex } from './image-metadata.js';
import { ConfigSchema } from './config.js';

const config = ConfigSchema.parse({
  scenarios: [
    { name: 'Route: /contracts/thanks', url: 'https://example.com/thanks' },
    {
      name: 'Modal: /contracts/marketing-agreement - Download Modal',
      url: 'https://example.com/modal',
    },
  ],
  browsers: ['chromium', { name: 'webkit', version: '17.4' }],
  viewports: [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'mobile', width: 375, height: 812 },
  ],
});

describe('buildImageMetadataIndex', () => {
  it('builds metadata entries for each scenario/browser/viewport', () => {
    const index = buildImageMetadataIndex(config);

    expect(Object.keys(index)).toHaveLength(8);

    const chromiumDesktop = 'Route_-contracts-thanks_chromium_desktop.png';
    expect(index[chromiumDesktop]).toEqual({
      filename: chromiumDesktop,
      scenario: 'Route: /contracts/thanks',
      browser: 'chromium',
      version: undefined,
      viewport: 'desktop',
    });

    const webkitMobile =
      'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png';
    expect(index[webkitMobile]).toEqual({
      filename: webkitMobile,
      scenario: 'Modal: /contracts/marketing-agreement - Download Modal',
      browser: 'webkit',
      version: '17.4',
      viewport: 'mobile',
    });
  });

  it('honors an explicit scenarios list', () => {
    const index = buildImageMetadataIndex(config, [config.scenarios[0]]);

    expect(Object.keys(index)).toHaveLength(4);

    const filenames = Object.values(index).map((entry) => entry.filename);
    expect(filenames).toContain('Route_-contracts-thanks_chromium_desktop.png');
    expect(filenames).toContain('Route_-contracts-thanks_webkit-v17.4_mobile.png');
    expect(filenames).not.toContain(
      'Modal_-contracts-marketing-agreement_-_Download_Modal_webkit-v17.4_mobile.png'
    );
  });
});
