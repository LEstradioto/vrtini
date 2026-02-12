import type { VRTConfig } from '../../../src/core/config.js';
import { getErrorMessage } from '../../../src/core/errors.js';
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

const jobs = new Map<string, CrossCompareJob>();

export function createCrossCompareJob(projectId: string): CrossCompareJob {
  const jobId = Date.now().toString(36);
  const job: CrossCompareJob = {
    id: jobId,
    projectId,
    status: 'running',
    phase: 'preparing',
    progress: 0,
    total: 0,
    pairIndex: 0,
    pairTotal: 0,
    reports: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  return job;
}

export function getCrossCompareJob(jobId: string): CrossCompareJob | undefined {
  return jobs.get(jobId);
}

export function getCrossCompareJobStatus(job: CrossCompareJob): CrossCompareJob {
  return { ...job, reports: [...job.reports] };
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
    job.reports = reports;
    job.status = 'completed';
    job.phase = 'done';
    job.progress = Math.max(job.progress, job.total);
    job.completedAt = new Date().toISOString();
  } catch (err) {
    job.status = 'failed';
    job.error = getErrorMessage(err);
    job.completedAt = new Date().toISOString();
  }
}
