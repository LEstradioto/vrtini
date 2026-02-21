import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { compareImages } from './compare.js';

// Use process.cwd() for consistent paths regardless of where test runs from
const PROJECT_ROOT = process.cwd();
const FIXTURES_DIR = join(PROJECT_ROOT, 'test', 'fixtures');
const TEMP_DIFF_DIR = join(PROJECT_ROOT, 'test', 'temp');

const baselinePath = join(FIXTURES_DIR, 'baseline.png');
const modifiedPath = join(FIXTURES_DIR, 'modified.png');
const identicalPath = join(FIXTURES_DIR, 'identical.png');

function getDiffPath(name: string): string {
  return join(TEMP_DIFF_DIR, name);
}

type RGBA = [number, number, number, number];

const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [0, 0, 0, 255];

function setPixel(png: PNG, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = color[3];
}

function writeSolidPng(
  path: string,
  width: number,
  height: number,
  color: RGBA,
  mutate?: (png: PNG) => void
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = color[3];
  }
  mutate?.(png);
  writeFileSync(path, PNG.sync.write(png));
}

function writeDomSnapshot(path: string, text: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      viewport: { width: 100, height: 100 },
      scrollSize: { width: 100, height: 100 },
      capturedAt: new Date().toISOString(),
      elements: [
        {
          path: 'body > h1',
          tag: 'h1',
          box: { x: 10, y: 10, w: 80, h: 20 },
          text,
          styles: { color: '#000', fontSize: '16px' },
          children: [],
        },
      ],
    })
  );
}

describe('compareImages', () => {
  beforeAll(() => {
    // Verify fixtures exist
    if (!existsSync(baselinePath)) {
      throw new Error('Test fixtures not found. Run: npx tsx test/generate-test-fixtures.ts');
    }
    if (!existsSync(TEMP_DIFF_DIR)) {
      mkdirSync(TEMP_DIFF_DIR, { recursive: true });
    }
  });

  it('detects differences between baseline and modified images', async () => {
    const diffPath = getDiffPath('diff-modified.png');

    const result = await compareImages(baselinePath, modifiedPath, diffPath);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('diff');
    expect(result.pixelDiff).toBeGreaterThan(0);
    expect(result.diffPercentage).toBeGreaterThan(0);

    // Diff image should be created
    expect(existsSync(diffPath)).toBe(true);
  });

  it('detects no differences between identical images', async () => {
    const diffPath = getDiffPath('diff-identical.png');

    const result = await compareImages(baselinePath, identicalPath, diffPath);

    expect(result.match).toBe(true);
    expect(result.reason).toBe('match');
    expect(result.pixelDiff).toBe(0);
    expect(result.diffPercentage).toBe(0);
  });

  it('returns no-baseline when baseline does not exist', async () => {
    const nonExistentBaseline = join(FIXTURES_DIR, 'does-not-exist.png');
    const diffPath = getDiffPath('diff-no-baseline.png');

    const result = await compareImages(nonExistentBaseline, modifiedPath, diffPath);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('no-baseline');
  });

  it('returns no-test when test image does not exist', async () => {
    const nonExistentTest = join(FIXTURES_DIR, 'does-not-exist.png');
    const diffPath = getDiffPath('diff-no-test.png');

    const result = await compareImages(baselinePath, nonExistentTest, diffPath);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('no-test');
  });

  it('treats diffs within maxDiffPercentage as matches', async () => {
    const diffPath = getDiffPath('diff-max-pct.png');
    const baselineResult = await compareImages(baselinePath, modifiedPath, diffPath, {
      threshold: 0,
    });

    expect(baselineResult.reason).toBe('diff');
    expect(baselineResult.diffPercentage).toBeGreaterThan(0);

    const diffPathMatch = getDiffPath('diff-max-pct-match.png');
    const result = await compareImages(baselinePath, modifiedPath, diffPathMatch, {
      threshold: 0,
      maxDiffPercentage: baselineResult.diffPercentage + 0.0001,
    });

    expect(result.match).toBe(true);
    expect(result.reason).toBe('match');
  });

  it('treats diffs within maxDiffPixels as matches', async () => {
    const diffPath = getDiffPath('diff-max-pixels.png');
    const baselineResult = await compareImages(baselinePath, modifiedPath, diffPath, {
      threshold: 0,
    });

    expect(baselineResult.reason).toBe('diff');
    expect(baselineResult.pixelDiff).toBeGreaterThan(0);

    const diffPathMatch = getDiffPath('diff-max-pixels-match.png');
    const result = await compareImages(baselinePath, modifiedPath, diffPathMatch, {
      threshold: 0,
      maxDiffPixels: baselineResult.pixelDiff,
    });

    expect(result.match).toBe(true);
    expect(result.reason).toBe('match');
  });

  it('ignores maxDiffPixels for tall images', async () => {
    const tallBaseline = getDiffPath('tall-baseline.png');
    const tallTest = getDiffPath('tall-test.png');
    const tallDiff = getDiffPath('diff-tall.png');

    writeSolidPng(tallBaseline, 10, 4000, WHITE);
    writeSolidPng(tallTest, 10, 4000, WHITE, (png) => setPixel(png, 0, 0, BLACK));

    const result = await compareImages(tallBaseline, tallTest, tallDiff, {
      threshold: 0,
      maxDiffPixels: 1,
    });

    expect(result.match).toBe(false);
    expect(result.reason).toBe('diff');
    expect(result.pixelDiff).toBeGreaterThan(0);
  });

  it('does not include pixelmatch in diff engine results', async () => {
    const diffPath = getDiffPath('diff-no-pixelmatch.png');
    const result = await compareImages(baselinePath, modifiedPath, diffPath, {
      threshold: 0,
      engines: { odiff: { enabled: false } },
    });

    expect(result.reason).toBe('diff');
    if (result.reason === 'diff') {
      const engineResults = result.engineResults ?? [];
      expect(engineResults.some((engine) => engine.engine === 'pixelmatch')).toBe(false);
      expect(engineResults.length).toBeGreaterThan(0);
    }
  });

  it('trims uniform trailing bottom whitespace to avoid height-mismatch noise', async () => {
    const a = getDiffPath('trim-uniform-a.png');
    const b = getDiffPath('trim-uniform-b.png');
    const diffPath = getDiffPath('diff-trim-uniform.png');

    writeSolidPng(a, 10, 10, WHITE);
    writeSolidPng(b, 10, 12, WHITE); // Extra uniform rows at the bottom

    const result = await compareImages(a, b, diffPath);

    expect(result.match).toBe(true);
    expect(result.reason).toBe('match');
    expect(result.pixelDiff).toBe(0);
  });

  it('does not trim when extra bottom region is not uniform', async () => {
    const a = getDiffPath('trim-nonuniform-a.png');
    const b = getDiffPath('trim-nonuniform-b.png');
    const diffPath = getDiffPath('diff-trim-nonuniform.png');

    writeSolidPng(a, 10, 10, WHITE);
    writeSolidPng(b, 10, 12, WHITE, (png) => setPixel(png, 0, 11, BLACK)); // Extra region has content

    const result = await compareImages(a, b, diffPath);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('diff');
    expect(result.pixelDiff).toBeGreaterThan(0);
  });

  it('treats DOM text changes as diff even when pixel threshold would pass', async () => {
    const a = getDiffPath('dom-gate-a.png');
    const b = getDiffPath('dom-gate-b.png');
    const diffPath = getDiffPath('dom-gate-diff.png');
    const baseSnapshot = getDiffPath('dom-gate-baseline.snap.json');
    const testSnapshot = getDiffPath('dom-gate-test.snap.json');

    writeSolidPng(a, 10, 10, WHITE);
    writeSolidPng(b, 10, 10, WHITE);
    writeDomSnapshot(baseSnapshot, 'Old CTA text');
    writeDomSnapshot(testSnapshot, 'New CTA text');

    const result = await compareImages(a, b, diffPath, {
      threshold: 1,
      maxDiffPercentage: 100,
      baselineSnapshot: baseSnapshot,
      testSnapshot: testSnapshot,
      engines: {
        odiff: { enabled: false },
        ssim: { enabled: false },
        phash: { enabled: false },
      },
    });

    expect(result.match).toBe(false);
    expect(result.reason).toBe('diff');
    if (result.reason === 'diff') {
      expect(result.domDiff?.summary.text_changed).toBeGreaterThan(0);
    }
  });
});
