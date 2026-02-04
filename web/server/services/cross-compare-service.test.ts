import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { copyFile, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VRTConfig } from '../../../src/config.js';
import {
  deleteCrossItems,
  loadCrossResults,
  runCrossCompare,
  revokeCrossAcceptance,
  setCrossAcceptance,
  type CrossResults,
} from './cross-compare-service.js';
import { getScreenshotFilename } from '../../../src/core/paths.js';

const PROJECT_ROOT = process.cwd();
const FIXTURES_DIR = join(PROJECT_ROOT, 'test', 'fixtures');
const TEMP_ROOT = join(PROJECT_ROOT, 'test', 'temp', 'cross-compare-smart-pass');

const scenarioName = 'homepage';
const viewportName = 'desktop';

const config: VRTConfig = {
  baselineDir: './.vrt/baselines',
  outputDir: './.vrt/output',
  browsers: ['chromium', { name: 'chromium', version: '90' }],
  viewports: [{ name: viewportName, width: 800, height: 600 }],
  threshold: 0.1,
  diffThreshold: { maxDiffPercentage: 100 },
  disableAnimations: true,
  diffColor: '#ff00ff',
  keepDiffOnMatch: false,
  concurrency: 1,
  quickMode: true,
  scenarios: [{ name: scenarioName, url: 'https://example.com' }],
};

async function seedCrossCompareImages(outputDir: string): Promise<void> {
  const baselinePath = join(FIXTURES_DIR, 'baseline.png');
  const modifiedPath = join(FIXTURES_DIR, 'modified.png');

  if (!existsSync(baselinePath) || !existsSync(modifiedPath)) {
    throw new Error('Test fixtures not found. Run: npx tsx test/generate-test-fixtures.ts');
  }

  await mkdir(outputDir, { recursive: true });

  const latestFilename = getScreenshotFilename(scenarioName, 'chromium', viewportName);
  const oldFilename = getScreenshotFilename(scenarioName, 'chromium', viewportName, '90');

  await copyFile(baselinePath, join(outputDir, latestFilename));
  await copyFile(modifiedPath, join(outputDir, oldFilename));
}

describe('cross-compare smart pass rerun', () => {
  const outputDir = resolve(TEMP_ROOT, '.vrt', 'output');

  beforeAll(async () => {
    await rm(TEMP_ROOT, { recursive: true, force: true });
    await seedCrossCompareImages(outputDir);
  });

  afterAll(async () => {
    await rm(TEMP_ROOT, { recursive: true, force: true });
  });

  it('restores smart-pass diffs after rerun', async () => {
    const [report] = await runCrossCompare('demo', TEMP_ROOT, config);
    const key = report.key;

    const firstRun = await loadCrossResults(TEMP_ROOT, config, key);
    expect(firstRun.items.length).toBe(1);

    const item = firstRun.items[0];
    expect(item.match).toBe(true);
    expect(item.diffPercentage).toBeGreaterThan(0);
    expect(item.itemKey).toBeTruthy();
    expect(item.diff).toBeTruthy();

    const diffPath = resolve(TEMP_ROOT, item.diff as string);
    expect(existsSync(diffPath)).toBe(true);

    await deleteCrossItems(TEMP_ROOT, config, key, [item.itemKey as string]);
    expect(existsSync(diffPath)).toBe(false);

    await runCrossCompare('demo', TEMP_ROOT, config);

    const rerun = await loadCrossResults(TEMP_ROOT, config, key);
    const rerunItem = rerun.items.find((result) => result.itemKey === item.itemKey);

    expect(rerunItem).toBeTruthy();
    expect(rerunItem?.match).toBe(true);
    expect(rerunItem?.diffPercentage).toBeGreaterThan(0);
    expect(rerunItem?.diff).toBeTruthy();

    const rerunDiffPath = resolve(TEMP_ROOT, rerunItem?.diff as string);
    expect(existsSync(rerunDiffPath)).toBe(true);
  });

  it('persists cross approvals in results.json', async () => {
    const [report] = await runCrossCompare('demo', TEMP_ROOT, config);
    const key = report.key;

    const results = await loadCrossResults(TEMP_ROOT, config, key);
    const itemKey = results.items[0].itemKey as string;

    await setCrossAcceptance(TEMP_ROOT, key, itemKey, undefined, config);

    const resultsPath = resolve(TEMP_ROOT, '.vrt', 'output', 'cross-reports', key, 'results.json');
    const acceptedData = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
    const acceptedItem = acceptedData.items.find((item) => item.itemKey === itemKey);

    expect(acceptedItem?.accepted).toBe(true);
    expect(acceptedItem?.acceptedAt).toBeTruthy();

    await revokeCrossAcceptance(TEMP_ROOT, key, itemKey, config);

    const revokedData = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
    const revokedItem = revokedData.items.find((item) => item.itemKey === itemKey);

    expect(revokedItem?.accepted).toBeUndefined();
    expect(revokedItem?.acceptedAt).toBeUndefined();
  });
});
