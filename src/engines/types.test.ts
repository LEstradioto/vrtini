import { describe, it, expect } from 'vitest';
import { DEFAULT_ENGINES_CONFIG } from './types.js';

const config = DEFAULT_ENGINES_CONFIG;

describe('EnginesConfig', () => {
  it('has core engines enabled by default', () => {
    expect(config.pixelmatch.enabled).toBe(true);
    expect(config.ssim.enabled).toBe(true);
    expect(config.phash.enabled).toBe(true);
  });

  it('has all engines enabled by default', () => {
    // All engines enabled for comprehensive comparison
    expect(config.odiff.enabled).toBe(true);
  });

  it('has web-optimized defaults', () => {
    expect(config.pixelmatch.antialiasing).toBe(true);
    expect(config.odiff.antialiasing).toBe(true);
    expect(config.pixelmatch.threshold).toBe(0.1);
  });

  it('has odiff-specific configuration', () => {
    expect(config.odiff.failOnLayoutDiff).toBe(true);
    expect(config.odiff.outputDiffMask).toBe(false);
  });

  it('has pixelmatch alpha configured', () => {
    expect(config.pixelmatch.alpha).toBe(0.1);
  });
});
