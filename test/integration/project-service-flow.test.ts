import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { projectsRoutes } from '../../web/server/api/projects.js';
import { configRoutes } from '../../web/server/api/config.js';
import { imagesRoutes } from '../../web/server/api/images.js';
import {
  getProjectDirs,
  getScreenshotFilename,
  getImageMetadataPath,
  getAcceptancesPath,
} from '../../src/core/paths.js';
import { IMAGE_METADATA_SCHEMA_VERSION } from '../../src/core/image-metadata.js';

const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'baseline.png');

describe('project service integration', () => {
  const scenarioName = 'Marketing Home';
  const viewportName = 'desktop';
  const config = {
    baselineDir: './.custom/baselines',
    outputDir: './.custom/output',
    browsers: ['chromium'],
    viewports: [{ name: viewportName, width: 800, height: 600 }],
    threshold: 0.1,
    scenarios: [{ name: scenarioName, url: 'https://example.com' }],
  };

  let tempDir = '';
  let fastify!: FastifyInstance;
  let originalCwd = '';
  let filename = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vrt-project-service-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    await writeFile(join(tempDir, 'vrt.config.json'), JSON.stringify(config, null, 2));

    const { baselineDir, outputDir, diffDir } = getProjectDirs(tempDir, config);
    await mkdir(baselineDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await mkdir(diffDir, { recursive: true });

    filename = getScreenshotFilename(scenarioName, 'chromium', viewportName);
    await copyFile(FIXTURE_PATH, join(baselineDir, filename));
    await copyFile(FIXTURE_PATH, join(outputDir, filename));
    await copyFile(FIXTURE_PATH, join(diffDir, filename));

    const metadataFile = {
      schemaVersion: IMAGE_METADATA_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      images: {
        [filename]: {
          filename,
          scenario: scenarioName,
          browser: 'chromium',
          viewport: viewportName,
        },
      },
    };

    await writeFile(getImageMetadataPath(baselineDir), JSON.stringify(metadataFile, null, 2));
    await writeFile(getImageMetadataPath(outputDir), JSON.stringify(metadataFile, null, 2));
    await writeFile(getImageMetadataPath(diffDir), JSON.stringify(metadataFile, null, 2));

    await mkdir(join(tempDir, '.vrt'), { recursive: true });

    const acceptances = {
      acceptances: [
        {
          filename,
          acceptedAt: '2026-02-03T12:00:00.000Z',
          comparedAgainst: { filename, type: 'baseline' },
          metrics: { diffPercentage: 0.05 },
          signals: { scenario: scenarioName, viewport: viewportName },
        },
      ],
    };

    await writeFile(getAcceptancesPath(tempDir), JSON.stringify(acceptances, null, 2));

    fastify = Fastify({ logger: false });
    await fastify.register(projectsRoutes, { prefix: '/api' });
    await fastify.register(configRoutes, { prefix: '/api' });
    await fastify.register(imagesRoutes, { prefix: '/api' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads config, persists updates, and returns images with metadata', async () => {
    const projectResponse = await fastify.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Demo', path: tempDir, configFile: 'vrt.config.json' },
    });

    expect(projectResponse.statusCode).toBe(201);
    const projectPayload = JSON.parse(projectResponse.payload) as { project: { id: string } };
    const projectId = projectPayload.project.id;

    const configResponse = await fastify.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/config`,
    });

    expect(configResponse.statusCode).toBe(200);
    const configPayload = JSON.parse(configResponse.payload) as {
      valid: boolean;
      config: { baselineDir: string; threshold: number };
    };

    expect(configPayload.valid).toBe(true);
    expect(configPayload.config.baselineDir).toBe(config.baselineDir);

    const updatedConfig = {
      ...config,
      threshold: 0.2,
      keepDiffOnMatch: true,
      autoThresholds: {
        enabled: true,
        percentile: 0.97,
        minSampleSize: 8,
      },
      confidence: {
        passThreshold: 96,
        warnThreshold: 84,
      },
      domSnapshot: {
        enabled: true,
        maxElements: 3000,
      },
      engines: {
        pixelmatch: { enabled: true, threshold: 0.12, alpha: 0.8 },
        odiff: { enabled: true, threshold: 0.15, failOnLayoutDiff: false, outputDiffMask: true },
        ssim: { enabled: true, threshold: 0.95 },
        phash: { enabled: true, threshold: 0.9 },
      },
      crossCompare: {
        normalization: 'resize',
        mismatch: 'ignore',
        pairs: ['chromium-vs-webkit'],
      },
      ai: {
        enabled: true,
        provider: 'openrouter',
        apiKey: 'test-key',
        model: 'openrouter/auto',
        baseUrl: 'https://openrouter.ai/api/v1',
        manualOnly: false,
        analyzeThreshold: {
          maxPHashSimilarity: 0.9,
          maxSSIM: 0.95,
          minPixelDiff: 0.2,
        },
        autoApprove: {
          enabled: false,
          rules: [],
        },
        visionCompare: {
          enabled: true,
          chunks: 5,
          minImageHeight: 2000,
          maxVerticalAlignShift: 160,
          includeDiffImage: true,
        },
      },
    };
    const saveResponse = await fastify.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/config`,
      payload: { config: updatedConfig },
    });

    expect(saveResponse.statusCode).toBe(200);
    const savePayload = JSON.parse(saveResponse.payload) as {
      config: {
        threshold: number;
        keepDiffOnMatch: boolean;
        autoThresholds?: { enabled: boolean; percentile?: number; minSampleSize?: number };
        confidence?: { passThreshold?: number; warnThreshold?: number };
        domSnapshot?: { enabled?: boolean; maxElements?: number };
        engines?: {
          pixelmatch?: { threshold?: number };
          odiff?: { outputDiffMask?: boolean };
        };
        crossCompare?: { normalization?: string; mismatch?: string };
        ai?: {
          provider?: string;
          baseUrl?: string;
          visionCompare?: { chunks?: number; includeDiffImage?: boolean };
        };
      };
    };
    expect(savePayload.config.threshold).toBe(0.2);
    expect(savePayload.config.keepDiffOnMatch).toBe(true);
    expect(savePayload.config.autoThresholds?.enabled).toBe(true);
    expect(savePayload.config.autoThresholds?.percentile).toBe(0.97);
    expect(savePayload.config.confidence?.passThreshold).toBe(96);
    expect(savePayload.config.domSnapshot?.enabled).toBe(true);
    expect(savePayload.config.domSnapshot?.maxElements).toBe(3000);
    expect(savePayload.config.engines?.pixelmatch?.threshold).toBe(0.12);
    expect(savePayload.config.engines?.odiff?.outputDiffMask).toBe(true);
    expect(savePayload.config.crossCompare?.normalization).toBe('resize');
    expect(savePayload.config.crossCompare?.mismatch).toBe('ignore');
    expect(savePayload.config.ai?.provider).toBe('openrouter');
    expect(savePayload.config.ai?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(savePayload.config.ai?.visionCompare?.chunks).toBe(5);
    expect(savePayload.config.ai?.visionCompare?.includeDiffImage).toBe(true);

    const refreshedConfig = await fastify.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/config`,
    });

    expect(refreshedConfig.statusCode).toBe(200);
    const refreshedPayload = JSON.parse(refreshedConfig.payload) as {
      config: {
        threshold: number;
        keepDiffOnMatch: boolean;
        domSnapshot?: { enabled?: boolean; maxElements?: number };
        crossCompare?: { normalization?: string; mismatch?: string };
        ai?: { provider?: string; visionCompare?: { chunks?: number } };
      };
    };
    expect(refreshedPayload.config.threshold).toBe(0.2);
    expect(refreshedPayload.config.keepDiffOnMatch).toBe(true);
    expect(refreshedPayload.config.domSnapshot?.enabled).toBe(true);
    expect(refreshedPayload.config.domSnapshot?.maxElements).toBe(3000);
    expect(refreshedPayload.config.crossCompare?.normalization).toBe('resize');
    expect(refreshedPayload.config.crossCompare?.mismatch).toBe('ignore');
    expect(refreshedPayload.config.ai?.provider).toBe('openrouter');
    expect(refreshedPayload.config.ai?.visionCompare?.chunks).toBe(5);

    const imagesResponse = await fastify.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/images`,
    });

    expect(imagesResponse.statusCode).toBe(200);
    const imagesPayload = JSON.parse(imagesResponse.payload) as {
      baselines: string[];
      tests: string[];
      diffs: string[];
      paths: { baselineDir: string; outputDir: string; diffDir: string };
      metadata: {
        baselines: { filename: string; scenario: string }[];
        tests: { filename: string; scenario: string }[];
        diffs: { filename: string; scenario: string }[];
      };
      acceptances: Record<string, { filename: string }>;
      autoThresholdCaps: {
        percentile: number;
        minSampleSize: number;
        caps: Record<string, unknown>;
      };
    };

    const { baselineDir, outputDir, diffDir } = getProjectDirs(tempDir, updatedConfig);

    expect(imagesPayload.baselines).toEqual([filename]);
    expect(imagesPayload.tests).toEqual([filename]);
    expect(imagesPayload.diffs).toEqual([filename]);
    expect(imagesPayload.paths).toEqual({ baselineDir, outputDir, diffDir });

    const baselineMeta = imagesPayload.metadata.baselines.find(
      (item) => item.filename === filename
    );
    const testMeta = imagesPayload.metadata.tests.find((item) => item.filename === filename);
    const diffMeta = imagesPayload.metadata.diffs.find((item) => item.filename === filename);

    expect(baselineMeta?.scenario).toBe(scenarioName);
    expect(testMeta?.scenario).toBe(scenarioName);
    expect(diffMeta?.scenario).toBe(scenarioName);

    expect(imagesPayload.acceptances[filename]?.filename).toBe(filename);
    expect(imagesPayload.autoThresholdCaps.percentile).toBe(0.95);
    expect(imagesPayload.autoThresholdCaps.minSampleSize).toBe(5);
    expect(Object.keys(imagesPayload.autoThresholdCaps.caps)).toHaveLength(0);
  });
});
