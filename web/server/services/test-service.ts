import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, resolve } from 'path';
import type { VRTConfig } from '../../../src/core/config.js';
import { runScreenshotTasks } from '../../../src/docker.js';
import { normalizeBrowserConfig } from '../../../src/core/browser-versions.js';
import { compareImages } from '../../../src/core/compare.js';
import type { ComparisonResult } from '../../../src/core/types.js';
import {
  getProjectDirs,
  getScreenshotFilename,
  getImageMetadataPath,
} from '../../../src/core/paths.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { buildEnginesConfig, buildComparisonMatrix } from '../../../src/core/compare-runner.js';
import {
  buildImageMetadataIndex,
  IMAGE_METADATA_SCHEMA_VERSION,
  type ImageMetadata,
} from '../../../src/core/image-metadata.js';
import { updateProject } from './store.js';
import {
  loadAcceptances,
  computeAutoThresholdCaps,
  listImages,
  type AutoThresholdCaps,
} from './project-service.js';

export interface TestTiming {
  screenshotDuration?: number; // ms
  compareDuration?: number; // ms
  totalDuration?: number; // ms
}

export interface ImageResultData {
  status: 'passed' | 'failed' | 'new';
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
}

export interface TestJob {
  id: string;
  projectId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  progress: number;
  total: number;
  phase: 'capturing' | 'comparing' | 'done';
  results: ComparisonResult[];
  error?: string;
  startedAt: string;
  completedAt?: string;
  timing?: TestTiming;
  abortController?: AbortController;
  containerIds: string[];
}

export type TestJobStatus = Omit<TestJob, 'abortController'>;
type ProjectDirs = ReturnType<typeof getProjectDirs>;

const jobs = new Map<string, TestJob>();

function buildAutoThresholdKey(scenarioName: string, viewportName: string): string {
  return `${scenarioName.trim()}::${viewportName.trim()}`;
}

function capAtCeiling(value: number | undefined, ceiling: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (ceiling === undefined) return value;
  return Math.min(value, ceiling);
}

function resolveDiffThresholds(
  scenario: VRTConfig['scenarios'][number],
  viewport: VRTConfig['viewports'][number],
  config: VRTConfig,
  autoThresholdCaps: AutoThresholdCaps | null
): { maxDiffPercentage?: number; maxDiffPixels?: number } {
  const baseMaxDiffPercentage =
    scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage;
  const baseMaxDiffPixels =
    scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels;

  let maxDiffPercentage = baseMaxDiffPercentage;
  let maxDiffPixels = baseMaxDiffPixels;

  if (autoThresholdCaps) {
    const key = buildAutoThresholdKey(scenario.name, viewport.name);
    const cap = autoThresholdCaps.caps[key];
    if (cap?.p95DiffPercentage !== undefined) {
      maxDiffPercentage = capAtCeiling(cap.p95DiffPercentage, baseMaxDiffPercentage);
    }
    if (cap?.p95PixelDiff !== undefined) {
      maxDiffPixels = capAtCeiling(cap.p95PixelDiff, baseMaxDiffPixels);
    }
  }

  return { maxDiffPercentage, maxDiffPixels };
}

async function loadAutoThresholdCaps(
  projectPath: string,
  config: VRTConfig
): Promise<AutoThresholdCaps | null> {
  if (!config.autoThresholds?.enabled) return null;
  const acceptances = await loadAcceptances(projectPath);
  return computeAutoThresholdCaps(acceptances, {
    percentile: config.autoThresholds.percentile,
    minSampleSize: config.autoThresholds.minSampleSize,
  });
}

async function ensureCaptureDirs(dirs: ProjectDirs): Promise<void> {
  await mkdir(dirs.outputDir, { recursive: true });
  await mkdir(dirs.baselineDir, { recursive: true });
  await mkdir(dirs.diffDir, { recursive: true });
}

async function writeImageMetadataFile(
  dir: string,
  metadataIndex: Record<string, ImageMetadata>
): Promise<void> {
  const files = await listImages(dir);
  const images: Record<string, ImageMetadata> = {};

  for (const filename of files) {
    const metadata = metadataIndex[filename];
    if (metadata) {
      images[filename] = metadata;
    }
  }

  const payload = {
    schemaVersion: IMAGE_METADATA_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    images,
  };

  await writeFile(getImageMetadataPath(dir), JSON.stringify(payload, null, 2));
}

async function persistImageMetadata(
  config: VRTConfig,
  scenarios: VRTConfig['scenarios'],
  dirs: ProjectDirs
): Promise<void> {
  const metadataIndex = buildImageMetadataIndex(config, scenarios);
  await Promise.all([
    writeImageMetadataFile(dirs.outputDir, metadataIndex),
    writeImageMetadataFile(dirs.diffDir, metadataIndex),
    writeImageMetadataFile(dirs.baselineDir, metadataIndex),
  ]);
}

async function clearStaleArtifacts(
  dirs: ProjectDirs,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): Promise<void> {
  for (const scenario of scenarios) {
    for (const browserConfig of config.browsers) {
      const { name: browser, version } = normalizeBrowserConfig(browserConfig);
      for (const viewport of config.viewports) {
        const filename = getScreenshotFilename(scenario.name, browser, viewport.name, version);
        const testFile = resolve(dirs.outputDir, filename);
        const diffFile = resolve(dirs.diffDir, filename);
        if (existsSync(testFile)) await unlink(testFile);
        if (existsSync(diffFile)) await unlink(diffFile);
      }
    }
  }
}

async function captureScreenshots(
  job: TestJob,
  projectPath: string,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios'],
  dirs: ProjectDirs
): Promise<number> {
  const signal = job.abortController?.signal;
  await ensureCaptureDirs(dirs);
  await clearStaleArtifacts(dirs, config, scenarios);

  const originalCwd = process.cwd();
  process.chdir(projectPath);

  const screenshotStartTime = Date.now();

  try {
    await runScreenshotTasks({
      config,
      scenarios: scenarios.map((s) => s.name),
      signal,
      onContainerStart: (containerId: string) => {
        job.containerIds.push(containerId);
      },
      onProgress: (completed: number, total: number, phase: 'capturing' | 'comparing') => {
        job.progress = completed;
        job.total = total;
        job.phase = phase;
      },
    });
  } finally {
    process.chdir(originalCwd);
  }

  return Date.now() - screenshotStartTime;
}

async function compareScreenshots(
  job: TestJob,
  projectPath: string,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios'],
  dirs: ProjectDirs
): Promise<{ results: ComparisonResult[]; compareDuration: number }> {
  job.phase = 'comparing';
  job.progress = 0;

  const compareStartTime = Date.now();
  const comparisons = buildComparisonMatrix(
    dirs.outputDir,
    dirs.baselineDir,
    dirs.diffDir,
    scenarios,
    config
  );

  job.total = comparisons.length;

  const CONCURRENCY = config.concurrency ?? 5;
  const quickMode = config.quickMode ?? false;
  const enginesConfig = buildEnginesConfig(quickMode, config.engines);
  const autoThresholdCaps = await loadAutoThresholdCaps(projectPath, config);
  const results: ComparisonResult[] = [];

  async function runBatch(batch: typeof comparisons): Promise<ComparisonResult[]> {
    return Promise.all(
      batch.map(({ baselinePath, testPath, diffPath, scenario, viewport }) => {
        const thresholds = resolveDiffThresholds(scenario, viewport, config, autoThresholdCaps);
        return compareImages(baselinePath, testPath, diffPath, {
          threshold: config.threshold,
          diffColor: config.diffColor,
          computePHash: !quickMode && (config.engines?.phash?.enabled ?? true),
          engines: enginesConfig,
          antialiasing: config.engines?.pixelmatch?.antialiasing,
          keepDiffOnMatch: config.keepDiffOnMatch,
          maxDiffPercentage: thresholds.maxDiffPercentage,
          maxDiffPixels: thresholds.maxDiffPixels,
        });
      })
    );
  }

  for (let i = 0; i < comparisons.length; i += CONCURRENCY) {
    const batch = comparisons.slice(i, i + CONCURRENCY);
    const batchResults = await runBatch(batch);
    results.push(...batchResults);
    job.progress = Math.min(i + CONCURRENCY, comparisons.length);
  }

  return { results, compareDuration: Date.now() - compareStartTime };
}

function buildResultsData(results: ComparisonResult[]): Record<string, ImageResultData> {
  const resultsData: Record<string, ImageResultData> = {};
  for (const result of results) {
    const filename = basename(result.test);
    const hasMetrics = result.reason !== 'no-baseline' && result.reason !== 'no-test';
    resultsData[filename] = {
      status: result.match ? 'passed' : result.reason === 'no-baseline' ? 'new' : 'failed',
      confidence: result.reason === 'diff' ? result.unifiedConfidence : undefined,
      metrics: hasMetrics
        ? {
            pixelDiff: result.pixelDiff,
            diffPercentage: result.diffPercentage,
            ssimScore: result.ssimScore,
          }
        : undefined,
    };
  }
  return resultsData;
}

async function persistResults(job: TestJob, projectPath: string): Promise<void> {
  const hasFailed = job.results.some((r) => r.reason === 'diff');
  const hasNew = job.results.some((r) => r.reason === 'no-baseline');

  await updateProject(job.projectId, {
    lastRun: job.completedAt,
    lastStatus: hasFailed ? 'failed' : hasNew ? 'new' : 'passed',
    lastTiming: job.timing,
  });

  const resultsPath = resolve(projectPath, '.vrt', 'last-results.json');
  const resultsData = buildResultsData(job.results);
  await writeFile(resultsPath, JSON.stringify(resultsData, null, 2));
}

export function createJob(projectId: string, totalTests: number): TestJob {
  const jobId = Date.now().toString(36);
  const abortController = new AbortController();

  const job: TestJob = {
    id: jobId,
    projectId,
    status: 'running',
    progress: 0,
    total: totalTests,
    phase: 'capturing',
    results: [],
    startedAt: new Date().toISOString(),
    abortController,
    containerIds: [],
  };

  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): TestJob | undefined {
  return jobs.get(jobId);
}

export function getJobStatus(job: TestJob): TestJobStatus {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    total: job.total,
    phase: job.phase,
    results: job.results,
    error: job.error,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    timing: job.timing,
    containerIds: job.containerIds,
  };
}

export async function abortJob(job: TestJob): Promise<void> {
  job.abortController?.abort();
  job.status = 'aborted';
  job.completedAt = new Date().toISOString();

  if (job.containerIds.length > 0) {
    const Docker = (await import('dockerode')).default;
    const docker = new Docker();

    for (const containerId of job.containerIds) {
      try {
        const container = docker.getContainer(containerId);
        await container.stop({ t: 0 });
      } catch {
        // Container may already be stopped
      }
    }
  }
}

export async function runTests(
  job: TestJob,
  projectPath: string,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): Promise<void> {
  const signal = job.abortController?.signal;
  const dirs = getProjectDirs(projectPath, config);
  const testStartTime = Date.now();
  const screenshotDuration = await captureScreenshots(job, projectPath, config, scenarios, dirs);

  if (signal?.aborted) {
    return;
  }

  const { results, compareDuration } = await compareScreenshots(
    job,
    projectPath,
    config,
    scenarios,
    dirs
  );
  job.results = results;
  const totalDuration = Date.now() - testStartTime;

  job.timing = {
    screenshotDuration,
    compareDuration,
    totalDuration,
  };

  job.phase = 'done';
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  await persistResults(job, projectPath);
  await persistImageMetadata(config, scenarios, dirs);
}

export async function startTestRun(
  job: TestJob,
  projectPath: string,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): Promise<void> {
  try {
    await runTests(job, projectPath, config, scenarios);
  } catch (err) {
    if (job.status !== 'aborted') {
      job.status = 'failed';
      job.error = getErrorMessage(err);
      job.completedAt = new Date().toISOString();
    }
  }
}
