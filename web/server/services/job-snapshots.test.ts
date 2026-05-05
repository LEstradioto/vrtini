import { describe, expect, it } from 'vitest';
import { createJob, toTestJobSnapshot, type TestJob } from './test-service.js';
import {
  createCrossCompareJob,
  toCrossCompareJobSnapshot,
  type CrossCompareJob,
} from './cross-compare-job-service.js';

function freshTestJob(overrides: Partial<TestJob> = {}): TestJob {
  const job = createJob('proj-1', 3);
  Object.assign(job, overrides);
  return job;
}

function freshCrossCompareJob(overrides: Partial<CrossCompareJob> = {}): CrossCompareJob {
  const job = createCrossCompareJob('proj-1');
  Object.assign(job, overrides);
  return job;
}

describe('toTestJobSnapshot', () => {
  it('produces a running variant for fresh jobs', () => {
    const snap = toTestJobSnapshot(freshTestJob());
    expect(snap.status).toBe('running');
    if (snap.status !== 'running') throw new Error('narrow guard');
    // Type narrowing: completedAt is not in the running variant's type.
  });

  it('produces a completed variant with timing + completedAt', () => {
    const job = freshTestJob({
      status: 'completed',
      phase: 'done',
      completedAt: '2026-05-04T12:00:00Z',
      timing: { totalDuration: 1234 },
    });
    const snap = toTestJobSnapshot(job);
    expect(snap.status).toBe('completed');
    if (snap.status !== 'completed') throw new Error('narrow guard');
    expect(snap.completedAt).toBe('2026-05-04T12:00:00Z');
    expect(snap.timing.totalDuration).toBe(1234);
    expect(snap.phase).toBe('done');
  });

  it('produces a failed variant with error', () => {
    const job = freshTestJob({
      status: 'failed',
      completedAt: '2026-05-04T12:00:00Z',
      error: 'boom',
    });
    const snap = toTestJobSnapshot(job);
    expect(snap.status).toBe('failed');
    if (snap.status !== 'failed') throw new Error('narrow guard');
    expect(snap.error).toBe('boom');
  });

  it('produces an aborted variant', () => {
    const job = freshTestJob({
      status: 'aborted',
      completedAt: '2026-05-04T12:00:00Z',
    });
    const snap = toTestJobSnapshot(job);
    expect(snap.status).toBe('aborted');
    if (snap.status !== 'aborted') throw new Error('narrow guard');
    expect(snap.completedAt).toBe('2026-05-04T12:00:00Z');
  });

  it('throws when completed status lacks completedAt', () => {
    const job = freshTestJob({ status: 'completed', phase: 'done' });
    expect(() => toTestJobSnapshot(job)).toThrowError(/completedAt/);
  });

  it('throws when failed status lacks error', () => {
    const job = freshTestJob({ status: 'failed', completedAt: 'x' });
    expect(() => toTestJobSnapshot(job)).toThrowError(/error/);
  });

  it('throws when aborted status lacks completedAt', () => {
    const job = freshTestJob({ status: 'aborted' });
    expect(() => toTestJobSnapshot(job)).toThrowError(/completedAt/);
  });

  it('preserves warnings + captureDiagnostics on every variant', () => {
    const captureDiagnostics = {
      expectedScreenshots: 4,
      capturedScreenshots: 3,
      expectedSnapshots: 0,
      capturedSnapshots: 0,
      missingScreenshotSamples: ['x.png'],
      missingSnapshotSamples: [],
    };
    const job = freshTestJob({ warnings: ['heads up'], captureDiagnostics });
    const snap = toTestJobSnapshot(job);
    expect(snap.warnings).toEqual(['heads up']);
    expect(snap.captureDiagnostics).toEqual(captureDiagnostics);
  });
});

describe('toCrossCompareJobSnapshot', () => {
  it('produces a running variant for fresh jobs', () => {
    const snap = toCrossCompareJobSnapshot(freshCrossCompareJob());
    expect(snap.status).toBe('running');
  });

  it('produces a completed variant with completedAt and phase=done', () => {
    const job = freshCrossCompareJob({
      status: 'completed',
      phase: 'done',
      completedAt: '2026-05-04T12:00:00Z',
    });
    const snap = toCrossCompareJobSnapshot(job);
    expect(snap.status).toBe('completed');
    if (snap.status !== 'completed') throw new Error('narrow guard');
    expect(snap.completedAt).toBe('2026-05-04T12:00:00Z');
    expect(snap.phase).toBe('done');
  });

  it('produces a failed variant with error', () => {
    const job = freshCrossCompareJob({
      status: 'failed',
      completedAt: '2026-05-04T12:00:00Z',
      error: 'kaboom',
    });
    const snap = toCrossCompareJobSnapshot(job);
    expect(snap.status).toBe('failed');
    if (snap.status !== 'failed') throw new Error('narrow guard');
    expect(snap.error).toBe('kaboom');
  });

  it('throws when completed lacks completedAt', () => {
    const job = freshCrossCompareJob({ status: 'completed', phase: 'done' });
    expect(() => toCrossCompareJobSnapshot(job)).toThrowError(/completedAt/);
  });

  it('throws when failed lacks error', () => {
    const job = freshCrossCompareJob({ status: 'failed', completedAt: 'x' });
    expect(() => toCrossCompareJobSnapshot(job)).toThrowError(/error/);
  });

  it('clones reports array (snapshot mutation does not leak)', () => {
    const job = freshCrossCompareJob();
    const snap = toCrossCompareJobSnapshot(job);
    expect(snap.reports).not.toBe(job.reports);
  });
});
