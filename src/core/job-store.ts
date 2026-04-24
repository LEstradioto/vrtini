/**
 * In-memory keyed store for long-running jobs (test runs, cross-compare runs).
 *
 * Not persistent — jobs are lost on process restart. Caller is responsible for
 * evicting completed jobs once observers no longer need them; `evictOlderThan`
 * offers a coarse TTL sweep.
 */

import { randomUUID } from 'crypto';

export interface JobStore<T extends { id: string }> {
  create(makeJob: (id: string) => T): T;
  get(id: string): T | undefined;
  list(): T[];
  delete(id: string): boolean;
  evictOlderThan(predicate: (job: T) => boolean): number;
}

export function createJobStore<T extends { id: string }>(): JobStore<T> {
  const jobs = new Map<string, T>();

  return {
    create(makeJob) {
      const id = randomUUID();
      const job = makeJob(id);
      jobs.set(id, job);
      return job;
    },
    get(id) {
      return jobs.get(id);
    },
    list() {
      return [...jobs.values()];
    },
    delete(id) {
      return jobs.delete(id);
    },
    evictOlderThan(predicate) {
      let removed = 0;
      for (const [id, job] of jobs) {
        if (predicate(job)) {
          jobs.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
