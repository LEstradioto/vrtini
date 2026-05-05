import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, resolve } from 'path';
import type { VRTConfig } from '../../../src/core/config.js';
import { runScreenshotTasks, type ScreenshotResult } from '../../../src/docker.js';
import { normalizeBrowserConfig } from '../../../src/core/browser-versions.js';
import { compareImages } from '../../../src/compare.js';
import type { ComparisonResult } from '../../../src/types/index.js';
import { getProjectDirs, getScreenshotFilename } from '../../../src/core/paths.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { buildCompareOptions, buildComparisonMatrix } from '../../../src/core/compare-runner.js';
import { persistImageMetadata } from '../../../src/core/image-metadata.js';
import { createJobStore } from '../../../src/core/job-store.js';
import { saveJsonFile } from '../../../src/core/json-file-store.js';
import {
  buildCaptureResultWarnings,
  buildDiagnosticWarnings,
  collectCaptureDiagnostics,
  type CaptureDiagnostics,
} from '../../../src/domain/capture-diagnostics.js';
import { updateProject } from './store.js';
import {
  loadAcceptances,
  computeAutoThresholdCaps,
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
  engineResults?: { engine: string; similarity: number; diffPercent: number; error?: string }[];
}

export interface CaptureDiagnosticsSummary {
  expectedScreenshots: number;
  capturedScreenshots: number;
  expectedSnapshots: number;
  capturedSnapshots: number;
  missingScreenshotSamples: string[];
  missingSnapshotSamples: string[];
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
  warnings?: string[];
  captureDiagnostics?: CaptureDiagnosticsSummary;
  abortController?: AbortController;
  containerIds: string[];
}

// ─── Public snapshot shape ───────────────────────────────────────────────────
// Discriminated by status so consumers (HTTP handlers, SSE encoders, persisted
// JSON readers) get type-safe access to terminal-only fields. The internal
// TestJob struct stays mutable and flat — `toTestJobSnapshot` does the case
// analysis and is the one place where the runtime invariants set by
// markCompleted/markFailed/markAborted in this file are translated into the
// type system.

interface TestJobSnapshotBase {
  id: string;
  projectId: string;
  progress: number;
  total: number;
  phase: 'capturing' | 'comparing' | 'done';
  results: ComparisonResult[];
  startedAt: string;
  containerIds: string[];
  warnings?: string[];
  captureDiagnostics?: CaptureDiagnosticsSummary;
}

export interface TestJobRunningSnapshot extends TestJobSnapshotBase {
  status: 'running';
}

export interface TestJobCompletedSnapshot extends TestJobSnapshotBase {
  status: 'completed';
  phase: 'done';
  completedAt: string;
  timing: TestTiming;
}

export interface TestJobFailedSnapshot extends TestJobSnapshotBase {
  status: 'failed';
  completedAt: string;
  error: string;
  timing?: TestTiming;
}

export interface TestJobAbortedSnapshot extends TestJobSnapshotBase {
  status: 'aborted';
  completedAt: string;
}

export type TestJobSnapshot =
  | TestJobRunningSnapshot
  | TestJobCompletedSnapshot
  | TestJobFailedSnapshot
  | TestJobAbortedSnapshot;

/** @deprecated Use TestJobSnapshot. Kept as alias during migration. */
export type TestJobStatus = TestJobSnapshot;
type ProjectDirs = ReturnType<typeof getProjectDirs>;

const jobs = createJobStore<TestJob>();

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

async function clearStaleDiffArtifacts(
  dirs: ProjectDirs,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): Promise<void> {
  for (const scenario of scenarios) {
    for (const browserConfig of config.browsers) {
      const { name: browser, version } = normalizeBrowserConfig(browserConfig);
      for (const viewport of config.viewports) {
        const filename = getScreenshotFilename(scenario.name, browser, viewport.name, version);
        const diffFile = resolve(dirs.diffDir, filename);
        if (existsSync(diffFile)) await unlink(diffFile);
      }
    }
  }
}

function applyCaptureDiagnostics(
  job: TestJob,
  diagnostics: CaptureDiagnostics,
  config: VRTConfig
): void {
  job.captureDiagnostics = diagnostics;
  const warnings = [
    ...(job.warnings ?? []),
    ...buildDiagnosticWarnings(diagnostics, !!config.domSnapshot?.enabled),
  ];
  job.warnings = warnings.length > 0 ? warnings : undefined;
}

function appendCaptureWarnings(job: TestJob, results: ScreenshotResult[]): void {
  const warnings = [...(job.warnings ?? []), ...buildCaptureResultWarnings(results)];
  job.warnings = warnings.length > 0 ? warnings : undefined;
}

// ─── Terminal state transitions ─────────────────────────────────────────────
// Single point where a TestJob enters one of its terminal states. Each helper
// is the only writer of `status` + `completedAt` together — a precondition
// that downstream code (SSE, persistence, list filters) relies on.

function markCompleted(job: TestJob, results: ComparisonResult[], timing: TestTiming): void {
  job.results = results;
  job.timing = timing;
  job.phase = 'done';
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
}

function markFailed(job: TestJob, err: unknown): void {
  if (job.status === 'aborted') return; // abort wins over post-abort errors
  job.status = 'failed';
  job.error = getErrorMessage(err);
  job.completedAt = new Date().toISOString();
}

function markAborted(job: TestJob): void {
  job.status = 'aborted';
  job.completedAt = new Date().toISOString();
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

  const screenshotStartTime = Date.now();

  const results = await runScreenshotTasks({
    config,
    cwd: projectPath,
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
  appendCaptureWarnings(job, results);

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
  const autoThresholdCaps = await loadAutoThresholdCaps(projectPath, config);
  const results: ComparisonResult[] = [];

  async function runBatch(batch: typeof comparisons): Promise<ComparisonResult[]> {
    return Promise.all(
      batch.map((task) =>
        compareImages(
          task.baselinePath,
          task.testPath,
          task.diffPath,
          buildCompareOptions(config, task.scenario, task.viewport, task, {
            quickMode,
            autoThresholdCaps,
          })
        )
      )
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
      engineResults:
        result.reason === 'diff' && result.engineResults
          ? result.engineResults.map((er) => ({
              engine: er.engine,
              similarity: er.similarity,
              diffPercent: er.diffPercent,
              error: er.error,
            }))
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

  const resultsPath = resolve(projectPath, '.vrtini', 'last-results.json');
  const resultsData = buildResultsData(job.results);
  await saveJsonFile(resultsPath, resultsData);
}

export function createJob(projectId: string, totalTests: number): TestJob {
  return jobs.create((id) => ({
    id,
    projectId,
    status: 'running',
    progress: 0,
    total: totalTests,
    phase: 'capturing',
    results: [],
    startedAt: new Date().toISOString(),
    abortController: new AbortController(),
    containerIds: [],
  }));
}

export function getJob(jobId: string): TestJob | undefined {
  return jobs.get(jobId);
}

export function getJobStatus(job: TestJob): TestJobSnapshot {
  return toTestJobSnapshot(job);
}

function snapshotBase(job: TestJob): TestJobSnapshotBase {
  return {
    id: job.id,
    projectId: job.projectId,
    progress: job.progress,
    total: job.total,
    phase: job.phase,
    results: job.results,
    startedAt: job.startedAt,
    containerIds: job.containerIds,
    warnings: job.warnings,
    captureDiagnostics: job.captureDiagnostics,
  };
}

function completedSnapshot(job: TestJob): TestJobCompletedSnapshot {
  if (!job.completedAt || !job.timing) {
    throw new Error(`TestJob ${job.id} is completed but missing completedAt/timing`);
  }
  return {
    ...snapshotBase(job),
    status: 'completed',
    phase: 'done',
    completedAt: job.completedAt,
    timing: job.timing,
  };
}

function failedSnapshot(job: TestJob): TestJobFailedSnapshot {
  if (!job.completedAt || !job.error) {
    throw new Error(`TestJob ${job.id} is failed but missing completedAt/error`);
  }
  return {
    ...snapshotBase(job),
    status: 'failed',
    completedAt: job.completedAt,
    error: job.error,
    timing: job.timing,
  };
}

function abortedSnapshot(job: TestJob): TestJobAbortedSnapshot {
  if (!job.completedAt) {
    throw new Error(`TestJob ${job.id} is aborted but missing completedAt`);
  }
  return { ...snapshotBase(job), status: 'aborted', completedAt: job.completedAt };
}

/**
 * Project a mutable TestJob into its discriminated public snapshot. Encodes
 * the invariant locked in by markCompleted/markFailed/markAborted: terminal
 * statuses always carry `completedAt`. Inconsistent runtime state (manual
 * mutation bypassing the helpers) throws loudly via the per-status builders.
 */
export function toTestJobSnapshot(job: TestJob): TestJobSnapshot {
  switch (job.status) {
    case 'running':
      return { ...snapshotBase(job), status: 'running' };
    case 'completed':
      return completedSnapshot(job);
    case 'failed':
      return failedSnapshot(job);
    case 'aborted':
      return abortedSnapshot(job);
  }
}

export async function abortJob(job: TestJob): Promise<void> {
  job.abortController?.abort();
  markAborted(job);

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

/**
 * Abort every running test job. Used by the graceful-shutdown hook so the
 * server doesn't leak Docker containers on SIGTERM/SIGINT.
 */
export async function abortAllRunningJobs(): Promise<void> {
  const running = jobs.list().filter((job) => job.status === 'running');
  await Promise.all(running.map((job) => abortJob(job).catch(() => undefined)));
}

async function runTests(
  job: TestJob,
  projectPath: string,
  config: VRTConfig,
  scenarios: VRTConfig['scenarios']
): Promise<void> {
  const signal = job.abortController?.signal;
  const dirs = getProjectDirs(projectPath, config);
  const testStartTime = Date.now();
  const screenshotDuration = await captureScreenshots(job, projectPath, config, scenarios, dirs);
  applyCaptureDiagnostics(job, collectCaptureDiagnostics(dirs, config, scenarios), config);

  if (signal?.aborted) {
    return;
  }

  // Keep previous diff artifacts if capture fails (e.g., Docker unavailable).
  // Once capture succeeds, clear stale diffs for this run scope before recomparing.
  await clearStaleDiffArtifacts(dirs, config, scenarios);

  const { results, compareDuration } = await compareScreenshots(
    job,
    projectPath,
    config,
    scenarios,
    dirs
  );
  const totalDuration = Date.now() - testStartTime;
  markCompleted(job, results, { screenshotDuration, compareDuration, totalDuration });
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
    markFailed(job, err);
  }
}
