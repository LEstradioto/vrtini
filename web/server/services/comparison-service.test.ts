import { describe, it, expect } from 'vitest';
import { generateDiffFilename } from './comparison-service.js';

describe('generateDiffFilename', () => {
  it('strips .png extension from simple filenames', () => {
    const result = generateDiffFilename('left.png', 'right.png');
    expect(result).toMatch(/^compare_\d+_left_vs_right\.png$/);
  });

  it('strips only trailing .png from filenames with dots in the base name', () => {
    const result = generateDiffFilename(
      'Route_-contracts-marketing-agreement-download_webkit-v17.4_tablet.png',
      'Route_-contracts-thanks_chromium_desktop.png'
    );
    expect(result).toMatch(
      /^compare_\d+_Route_-contracts-marketing-agreement-download_webkit-v17\.4_tablet_vs_Route_-contracts-thanks_chromium_desktop\.png$/
    );
  });

  it('handles filenames without .png extension', () => {
    const result = generateDiffFilename('noext', 'alsonoext');
    expect(result).toMatch(/^compare_\d+_noext_vs_alsonoext\.png$/);
  });

  it('does not strip .png from the middle of a filename', () => {
    const result = generateDiffFilename('file.png.bak.png', 'other.png');
    // Only the trailing .png is stripped; the internal .png.bak remains
    expect(result).toMatch(/^compare_\d+_file\.png\.bak_vs_other\.png$/);
  });
});
