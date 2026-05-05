import type { VRTConfig } from '../../../src/core/config.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { createJobStore } from '../../../src/core/job-store.js';
import {
  runCrossCompare,
  type CrossCompareRunOptions,
  type CrossCompareProgressUpdate,
  type CrossReport,
} from './cross-compare-service.js';

export interface CrossCompareJob {
  id: string;
  projectId: string;
  status: 'running' | 'completed' | 'failed';
  phase: 'preparing' | 'running' | 'done';
  progress: number;
  total: number;
  pairIndex: number;
  pairTotal: number;
  currentPairKey?: string;
  currentPairTitle?: string;
  reports: CrossReport[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

const jobs = createJobStore<CrossCompareJob>();

export function createCrossCompareJob(projectId: string): CrossCompareJob {
  return jobs.create((id) => ({
    id,
    projectId,
    status: 'running',
    phase: 'preparing',
    progress: 0,
    total: 0,
    pairIndex: 0,
    pairTotal: 0,
    reports: [],
    startedAt: new Date().toISOString(),
  }));
}

export function getCrossCompareJob(jobId: string): CrossCompareJob | undefined {
  return jobs.get(jobId);
}

export function getCrossCompareJobStatus(job: CrossCompareJob): CrossCompareJobSnapshot {
  return toCrossCompareJobSnapshot(job);
}

// ─── Public snapshot shape ───────────────────────────────────────────────────
// Discriminated by status. Same rationale as TestJobSnapshot in test-service.ts:
// terminal-only fields (completedAt, error) get type-safe access at consumers.

interface CrossCompareJobSnapshotBase {
  id: string;
  projectId: string;
  phase: 'preparing' | 'running' | 'done';
  progress: number;
  total: number;
  pairIndex: number;
  pairTotal: number;
  currentPairKey?: string;
  currentPairTitle?: string;
  reports: CrossReport[];
  startedAt: string;
}

export interface CrossCompareJobRunningSnapshot extends CrossCompareJobSnapshotBase {
  status: 'running';
}
export interface CrossCompareJobCompletedSnapshot extends CrossCompareJobSnapshotBase {
  status: 'completed';
  phase: 'done';
  completedAt: string;
}
export interface CrossCompareJobFailedSnapshot extends CrossCompareJobSnapshotBase {
  status: 'failed';
  completedAt: string;
  error: string;
}
export type CrossCompareJobSnapshot =
  | CrossCompareJobRunningSnapshot
  | CrossCompareJobCompletedSnapshot
  | CrossCompareJobFailedSnapshot;

function ccBase(job: CrossCompareJob): CrossCompareJobSnapshotBase {
  return {
    id: job.id,
    projectId: job.projectId,
    phase: job.phase,
    progress: job.progress,
    total: job.total,
    pairIndex: job.pairIndex,
    pairTotal: job.pairTotal,
    currentPairKey: job.currentPairKey,
    currentPairTitle: job.currentPairTitle,
    reports: [...job.reports],
    startedAt: job.startedAt,
  };
}

function ccCompletedSnapshot(job: CrossCompareJob): CrossCompareJobCompletedSnapshot {
  if (!job.completedAt) {
    throw new Error(`CrossCompareJob ${job.id} is completed but missing completedAt`);
  }
  return { ...ccBase(job), status: 'completed', phase: 'done', completedAt: job.completedAt };
}

function ccFailedSnapshot(job: CrossCompareJob): CrossCompareJobFailedSnapshot {
  if (!job.completedAt || !job.error) {
    throw new Error(`CrossCompareJob ${job.id} is failed but missing completedAt/error`);
  }
  return { ...ccBase(job), status: 'failed', completedAt: job.completedAt, error: job.error };
}

export function toCrossCompareJobSnapshot(job: CrossCompareJob): CrossCompareJobSnapshot {
  switch (job.status) {
    case 'running':
      return { ...ccBase(job), status: 'running' };
    case 'completed':
      return ccCompletedSnapshot(job);
    case 'failed':
      return ccFailedSnapshot(job);
  }
}

function applyProgress(job: CrossCompareJob, update: CrossCompareProgressUpdate): void {
  job.phase = update.phase;
  job.progress = update.progress;
  job.total = update.total;
  job.pairIndex = update.pairIndex;
  job.pairTotal = update.pairTotal;
  job.currentPairKey = update.pairKey;
  job.currentPairTitle = update.pairTitle;
}

// ─── Terminal state transitions ─────────────────────────────────────────────
// Single point where a CrossCompareJob enters a terminal state. Mirrors the
// pattern in test-service.ts so SSE/persistence sees a consistent invariant:
// terminal status ⇒ completedAt set.

function markCompleted(job: CrossCompareJob, reports: CrossReport[]): void {
  job.reports = reports;
  job.status = 'completed';
  job.phase = 'done';
  job.progress = Math.max(job.progress, job.total);
  job.completedAt = new Date().toISOString();
}

function markFailed(job: CrossCompareJob, err: unknown): void {
  job.status = 'failed';
  job.error = getErrorMessage(err);
  job.completedAt = new Date().toISOString();
}

/**
 * On server shutdown: mark any in-flight cross-compare job as failed so
 * observers see terminal state on next poll. The underlying Docker work
 * cannot be aborted mid-flight (no signal plumbing) — containers finish
 * their current step and the server exits.
 */
export function markAllRunningJobsAsFailed(): void {
  for (const job of jobs.list()) {
    if (job.status === 'running') {
      markFailed(job, 'Server shutting down');
    }
  }
}

export async function startCrossCompareRun(
  job: CrossCompareJob,
  projectPath: string,
  config: VRTConfig,
  options: CrossCompareRunOptions
): Promise<void> {
  try {
    const reports = await runCrossCompare(job.projectId, projectPath, config, options, (update) => {
      applyProgress(job, update);
    });
    markCompleted(job, reports);
  } catch (err) {
    markFailed(job, err);
  }
}
