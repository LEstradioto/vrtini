import { describe, it, expect } from 'vitest';
import {
  parseHexColor,
  calculateDiffPercentage,
  computeTargetDimensions,
  padImageData,
  determineMatch,
  buildSizeMismatchError,
  GRAY_FILL,
  type RGBA,
} from './image-diff.js';

describe('parseHexColor', () => {
  it('parses black', () => {
    expect(parseHexColor('#000000')).toEqual([0, 0, 0]);
  });

  it('parses white', () => {
    expect(parseHexColor('#ffffff')).toEqual([255, 255, 255]);
  });

  it('parses red', () => {
    expect(parseHexColor('#ff0000')).toEqual([255, 0, 0]);
  });

  it('parses magenta', () => {
    expect(parseHexColor('#ff00ff')).toEqual([255, 0, 255]);
  });

  it('parses arbitrary color', () => {
    expect(parseHexColor('#1a2b3c')).toEqual([26, 43, 60]);
  });
});

describe('calculateDiffPercentage', () => {
  it('returns 0 when no diff pixels', () => {
    expect(calculateDiffPercentage(0, 1000)).toBe(0);
  });

  it('returns 100 when all pixels differ', () => {
    expect(calculateDiffPercentage(1000, 1000)).toBe(100);
  });

  it('returns 50 when half differ', () => {
    expect(calculateDiffPercentage(500, 1000)).toBe(50);
  });

  it('handles 0 total pixels', () => {
    expect(calculateDiffPercentage(0, 0)).toBe(0);
  });

  it('calculates fractional percentages', () => {
    expect(calculateDiffPercentage(1, 3)).toBeCloseTo(33.333, 2);
  });
});

describe('computeTargetDimensions', () => {
  it('returns same dimensions when images match', () => {
    const result = computeTargetDimensions(100, 200, 100, 200);
    expect(result).toEqual({ width: 100, height: 200, sizeMismatch: false });
  });

  it('detects width mismatch', () => {
    const result = computeTargetDimensions(100, 200, 150, 200);
    expect(result).toEqual({ width: 150, height: 200, sizeMismatch: true });
  });

  it('detects height mismatch', () => {
    const result = computeTargetDimensions(100, 200, 100, 250);
    expect(result).toEqual({ width: 100, height: 250, sizeMismatch: true });
  });

  it('uses max dimensions when both differ', () => {
    const result = computeTargetDimensions(100, 200, 150, 180);
    expect(result).toEqual({ width: 150, height: 200, sizeMismatch: true });
  });
});

describe('padImageData', () => {
  const expectPixel = (buffer: Buffer, index: number, rgba: RGBA) => {
    expect([buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]]).toEqual(rgba);
  };

  it('returns original buffer when dimensions match', () => {
    const src = Buffer.from([255, 0, 0, 255]); // 1x1 red pixel
    const result = padImageData(src, 1, 1, 1, 1);
    expect(result).toBe(src); // same reference
  });

  it('pads with gray fill by default', () => {
    const src = Buffer.from([255, 0, 0, 255]); // 1x1 red pixel
    const result = padImageData(src, 1, 1, 2, 2);

    expect(result.length).toBe(16); // 2x2 * 4 bytes

    // Top-left: original red pixel
    expectPixel(result, 0, [255, 0, 0, 255]);

    // Top-right: gray fill
    expectPixel(result, 4, [...GRAY_FILL]);

    // Bottom-left: gray fill
    expectPixel(result, 8, [...GRAY_FILL]);

    // Bottom-right: gray fill
    expectPixel(result, 12, [...GRAY_FILL]);
  });

  it('pads with custom fill color', () => {
    const src = Buffer.from([255, 0, 0, 255]); // 1x1 red pixel
    const customFill: RGBA = [0, 255, 0, 255]; // green
    const result = padImageData(src, 1, 1, 2, 1, customFill);

    expect(result.length).toBe(8); // 2x1 * 4 bytes

    // Left: original red pixel
    expectPixel(result, 0, [255, 0, 0, 255]);

    // Right: green fill
    expectPixel(result, 4, [0, 255, 0, 255]);
  });

  it('preserves 2x2 source in 3x3 target', () => {
    // 2x2 image: red, green, blue, white
    const src = Buffer.from([
      255,
      0,
      0,
      255, // (0,0) red
      0,
      255,
      0,
      255, // (1,0) green
      0,
      0,
      255,
      255, // (0,1) blue
      255,
      255,
      255,
      255, // (1,1) white
    ]);

    const result = padImageData(src, 2, 2, 3, 3);
    expect(result.length).toBe(36); // 3x3 * 4 bytes

    // Row 0: red, green, gray
    expectPixel(result, 0, [255, 0, 0, 255]);
    expectPixel(result, 4, [0, 255, 0, 255]);
    expectPixel(result, 8, [...GRAY_FILL]);

    // Row 1: blue, white, gray
    expectPixel(result, 12, [0, 0, 255, 255]);
    expectPixel(result, 16, [255, 255, 255, 255]);
    expectPixel(result, 20, [...GRAY_FILL]);

    // Row 2: gray, gray, gray
    expectPixel(result, 24, [...GRAY_FILL]);
    expectPixel(result, 28, [...GRAY_FILL]);
    expectPixel(result, 32, [...GRAY_FILL]);
  });
});

describe('determineMatch', () => {
  it('returns true when no diff and no size mismatch', () => {
    expect(determineMatch(0, false)).toBe(true);
  });

  it('returns false when diff pixels exist', () => {
    expect(determineMatch(1, false)).toBe(false);
  });

  it('returns false when size mismatch exists', () => {
    expect(determineMatch(0, true)).toBe(false);
  });

  it('returns false when both diff and size mismatch exist', () => {
    expect(determineMatch(5, true)).toBe(false);
  });
});

describe('buildSizeMismatchError', () => {
  it('builds descriptive error message', () => {
    const msg = buildSizeMismatchError(100, 200, 150, 250);
    expect(msg).toBe('Size mismatch: 100x200 vs 150x250');
  });

  it('handles same dimensions', () => {
    const msg = buildSizeMismatchError(100, 100, 100, 100);
    expect(msg).toBe('Size mismatch: 100x100 vs 100x100');
  });
});
