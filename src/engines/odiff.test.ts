import { describe, it, expect } from 'vitest';
import { compareWithOdiff, isOdiffAvailable } from './odiff.js';
import type { OdiffConfig } from './types.js';

const FAKE_BASELINE = '/fake/a.png';
const FAKE_TEST = '/fake/b.png';
const FAKE_DIFF = '/fake/diff.png';

describe('odiff adapter', () => {
  describe('isOdiffAvailable', () => {
    it('returns boolean', async () => {
      const result = await isOdiffAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('compareWithOdiff', () => {
    const defaultConfig: OdiffConfig = {
      enabled: true,
      threshold: 0.1,
      antialiasing: true,
      failOnLayoutDiff: true,
      outputDiffMask: false,
    };

    it('returns EngineResult with engine name odiff', async () => {
      const result = await compareWithOdiff(FAKE_BASELINE, FAKE_TEST, FAKE_DIFF, defaultConfig);
      expect(result.engine).toBe('odiff');
    });

    it('returns error when files do not exist', async () => {
      const result = await compareWithOdiff(
        '/nonexistent/a.png',
        '/nonexistent/b.png',
        '/fake/diff.png',
        defaultConfig
      );
      expect(result.error).toBeDefined();
      expect(result.similarity).toBe(0);
    });

    it('includes diffPercent and similarity in result', async () => {
      const result = await compareWithOdiff(FAKE_BASELINE, FAKE_TEST, FAKE_DIFF, defaultConfig);
      expect(typeof result.diffPercent).toBe('number');
      expect(typeof result.similarity).toBe('number');
    });
  });
});
