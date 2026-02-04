import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { calculateUnifiedConfidence, runEnabledEngines } from './index.js';
import { isOdiffAvailable } from './odiff.js';
import type { EngineResult } from './types.js';

const PROJECT_ROOT = process.cwd();
const ENGINE_FIXTURES_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'engines');
const TEMP_DIR = join(PROJECT_ROOT, 'test', 'temp');
const engineBaselinePath = join(ENGINE_FIXTURES_DIR, 'baseline.png');
const engineModifiedPath = join(ENGINE_FIXTURES_DIR, 'modified.png');
const engineIdenticalPath = join(ENGINE_FIXTURES_DIR, 'identical.png');

function makeResult(engine: EngineResult['engine'], similarity: number): EngineResult {
  return { engine, diffPercent: 0, similarity };
}

describe('calculateUnifiedConfidence', () => {
  it('returns 100 for all perfect similarities', () => {
    const results: EngineResult[] = [
      makeResult('pixelmatch', 1),
      makeResult('odiff', 1),
      makeResult('ssim', 1),
      makeResult('phash', 1),
    ];
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.score).toBe(100);
    expect(confidence.pass).toBe(true);
  });

  it('weights engines correctly (30% pm, 30% odiff, 25% ssim, 15% phash)', () => {
    const results: EngineResult[] = [
      makeResult('pixelmatch', 1),
      makeResult('odiff', 1),
      makeResult('ssim', 0.5),
      makeResult('phash', 0.5),
    ];
    // Expected: 0.30*1 + 0.30*1 + 0.25*0.5 + 0.15*0.5 = 0.80 = 80%
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.score).toBe(80);
  });

  it('redistributes weights when engine missing', () => {
    const results: EngineResult[] = [makeResult('pixelmatch', 1), makeResult('ssim', 1)];
    // Only pixelmatch (30%) and ssim (25%) = 55% total weight
    // Redistributed: pm = 30/55, ssim = 25/55
    // Score = 1 * (30/55) + 1 * (25/55) = 100%
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.score).toBe(100);
  });

  it('skips errored engines', () => {
    const results: EngineResult[] = [
      makeResult('pixelmatch', 1),
      { engine: 'odiff', diffPercent: 0, similarity: 0, error: 'failed' },
      makeResult('ssim', 1),
      makeResult('phash', 1),
    ];
    // odiff skipped due to error
    // Remaining: pm (30) + ssim (25) + phash (15) = 70% weight
    // Score = (1*30 + 1*25 + 1*15) / 70 = 100%
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.score).toBe(100);
  });

  it('returns pass verdict when score >= 95', () => {
    const results: EngineResult[] = [
      makeResult('pixelmatch', 0.95),
      makeResult('odiff', 0.95),
      makeResult('ssim', 0.95),
      makeResult('phash', 0.95),
    ];
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.verdict).toBe('pass');
  });

  it('returns warn verdict when score >= 80 but < 95', () => {
    const results: EngineResult[] = [
      makeResult('pixelmatch', 0.85),
      makeResult('odiff', 0.85),
      makeResult('ssim', 0.85),
      makeResult('phash', 0.85),
    ];
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.verdict).toBe('warn');
  });

  it('returns fail verdict when score < 80', () => {
    const results: EngineResult[] = [
      { engine: 'pixelmatch', diffPercent: 50, similarity: 0.5 },
      { engine: 'odiff', diffPercent: 50, similarity: 0.5 },
      { engine: 'ssim', diffPercent: 50, similarity: 0.5 },
      { engine: 'phash', diffPercent: 50, similarity: 0.5 },
    ];
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.verdict).toBe('fail');
  });

  it('returns 0 for empty results', () => {
    const confidence = calculateUnifiedConfidence([]);
    expect(confidence.score).toBe(0);
    expect(confidence.pass).toBe(false);
  });

  it('includes details for each engine', () => {
    const results: EngineResult[] = [
      { engine: 'pixelmatch', diffPercent: 1, similarity: 0.99 },
      { engine: 'odiff', diffPercent: 2, similarity: 0.98 },
    ];
    const confidence = calculateUnifiedConfidence(results);
    expect(confidence.details.pixelmatch).toBeDefined();
    expect(confidence.details.odiff).toBeDefined();
    expect(confidence.details.pixelmatch?.similarity).toBe(0.99);
    expect(confidence.details.odiff?.similarity).toBe(0.98);
  });
});

describe('runEnabledEngines', () => {
  it('returns empty array for non-existent files', async () => {
    const results = await runEnabledEngines('/fake/a.png', '/fake/b.png', '/fake/diff', {});
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('returns array of EngineResult', async () => {
    const results = await runEnabledEngines('/fake/a.png', '/fake/b.png', '/fake/diff', {});
    expect(Array.isArray(results)).toBe(true);
  });

  it('respects disabled engines', async () => {
    const results = await runEnabledEngines('/fake/a.png', '/fake/b.png', '/fake/diff', {
      pixelmatch: { enabled: false },
      odiff: { enabled: false },
      ssim: { enabled: false },
      phash: { enabled: false },
    });
    expect(results).toHaveLength(0);
  });
});

describe('runEnabledEngines (fixtures)', () => {
  beforeAll(() => {
    if (!existsSync(engineBaselinePath)) {
      throw new Error('Engine fixtures not found. Run: npx tsx test/generate-test-fixtures.ts');
    }
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  it('returns perfect similarities for identical fixtures', async () => {
    const diffBase = join(TEMP_DIR, 'engine-identical');
    const results = await runEnabledEngines(engineBaselinePath, engineIdenticalPath, diffBase, {});

    const pixelmatchResult = results.find((result) => result.engine === 'pixelmatch');
    const ssimResult = results.find((result) => result.engine === 'ssim');
    const phashResult = results.find((result) => result.engine === 'phash');

    expect(pixelmatchResult?.diffPercent).toBe(0);
    expect(pixelmatchResult?.similarity).toBe(1);
    expect(ssimResult?.similarity).toBeCloseTo(1, 4);
    expect(phashResult?.similarity).toBeCloseTo(1, 4);
    expect(existsSync(`${diffBase}-pixelmatch.png`)).toBe(true);
  });

  it('returns diff signals for modified fixtures', async () => {
    const diffBase = join(TEMP_DIR, 'engine-modified');
    const results = await runEnabledEngines(engineBaselinePath, engineModifiedPath, diffBase, {});

    const pixelmatchResult = results.find((result) => result.engine === 'pixelmatch');
    const ssimResult = results.find((result) => result.engine === 'ssim');
    const phashResult = results.find((result) => result.engine === 'phash');

    expect(pixelmatchResult?.diffPercent).toBeGreaterThan(0);
    expect(ssimResult?.similarity).toBeLessThan(1);
    expect(phashResult?.similarity).toBeLessThan(1);

    if (await isOdiffAvailable()) {
      expect(results.some((result) => result.engine === 'odiff')).toBe(true);
    }
  });
});
