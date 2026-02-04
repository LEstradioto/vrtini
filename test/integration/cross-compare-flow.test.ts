import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, copyFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { projectsRoutes } from '../../web/server/api/projects.js';
import { crossCompareRoutes } from '../../web/server/api/cross-compare.js';
import { getScreenshotFilename } from '../../src/core/paths.js';

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures');
const BASELINE_FIXTURE = join(FIXTURES_DIR, 'baseline.png');
const MODIFIED_FIXTURE = join(FIXTURES_DIR, 'modified.png');

const scenarioName = 'homepage';
const viewportName = 'desktop';

const config = {
  baselineDir: './.vrt/baselines',
  outputDir: './.vrt/output',
  browsers: [
    'chromium',
    { name: 'chromium', version: '90' },
    'webkit',
    { name: 'webkit', version: '15' },
  ],
  viewports: [{ name: viewportName, width: 800, height: 600 }],
  threshold: 0.1,
  diffThreshold: { maxDiffPercentage: 100 },
  scenarios: [{ name: scenarioName, url: 'https://example.com' }],
  quickMode: true,
};

describe('cross-compare integration', () => {
  let tempDir = '';
  let fastify: FastifyInstance;
  let originalCwd = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vrt-cross-compare-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    await writeFile(join(tempDir, 'vrt.config.json'), JSON.stringify(config, null, 2));

    const outputDir = join(tempDir, '.vrt', 'output');
    await mkdir(outputDir, { recursive: true });

    const latestChromium = getScreenshotFilename(scenarioName, 'chromium', viewportName);
    const oldChromium = getScreenshotFilename(scenarioName, 'chromium', viewportName, '90');
    const latestWebkit = getScreenshotFilename(scenarioName, 'webkit', viewportName);
    const oldWebkit = getScreenshotFilename(scenarioName, 'webkit', viewportName, '15');

    await copyFile(BASELINE_FIXTURE, join(outputDir, latestChromium));
    await copyFile(MODIFIED_FIXTURE, join(outputDir, oldChromium));
    await copyFile(BASELINE_FIXTURE, join(outputDir, latestWebkit));
    await copyFile(MODIFIED_FIXTURE, join(outputDir, oldWebkit));

    fastify = Fastify({ logger: false });
    await fastify.register(projectsRoutes, { prefix: '/api' });
    await fastify.register(crossCompareRoutes, { prefix: '/api' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists cross-compare results and acceptances', async () => {
    const projectResponse = await fastify.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Demo', path: tempDir, configFile: 'vrt.config.json' },
    });

    expect(projectResponse.statusCode).toBe(201);
    const projectPayload = JSON.parse(projectResponse.payload) as { project: { id: string } };
    const projectId = projectPayload.project.id;

    const compareResponse = await fastify.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/cross-compare`,
    });

    expect(compareResponse.statusCode).toBe(200);
    const comparePayload = JSON.parse(compareResponse.payload) as { reports: { key: string }[] };
    expect(comparePayload.reports.length).toBeGreaterThan(0);
    const key = comparePayload.reports[0].key;

    const resultsResponse = await fastify.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cross-results/${key}`,
    });

    expect(resultsResponse.statusCode).toBe(200);
    const resultsPayload = JSON.parse(resultsResponse.payload) as {
      results: { items: { itemKey?: string; accepted?: boolean }[] };
    };
    expect(resultsPayload.results.items.length).toBeGreaterThan(0);

    const itemKey = resultsPayload.results.items[0].itemKey;
    expect(itemKey).toBeTruthy();
    if (!itemKey) throw new Error('Expected cross-compare itemKey');

    const acceptResponse = await fastify.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/cross-accept`,
      payload: { key, itemKey, reason: 'Approved in integration test' },
    });

    expect(acceptResponse.statusCode).toBe(200);

    const acceptedResponse = await fastify.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cross-results/${key}`,
    });

    expect(acceptedResponse.statusCode).toBe(200);
    const acceptedPayload = JSON.parse(acceptedResponse.payload) as {
      results: { items: { itemKey?: string; accepted?: boolean; acceptedAt?: string }[] };
    };
    const acceptedItem = acceptedPayload.results.items.find((item) => item.itemKey === itemKey);
    expect(acceptedItem?.accepted).toBe(true);
    expect(acceptedItem?.acceptedAt).toBeTruthy();

    const resultsPath = join(tempDir, '.vrt', 'output', 'cross-reports', key, 'results.json');
    const persisted = JSON.parse(await readFile(resultsPath, 'utf-8')) as {
      items: { itemKey?: string; accepted?: boolean; acceptedAt?: string }[];
    };
    const persistedItem = persisted.items.find((item) => item.itemKey === itemKey);
    expect(persistedItem?.accepted).toBe(true);
    expect(persistedItem?.acceptedAt).toBeTruthy();
  });
});
