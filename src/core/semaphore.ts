/**
 * Simple promise-based semaphore for bounding CPU-heavy or event-loop-
 * blocking work (e.g. synchronous PNG decode).
 *
 * Usage:
 *   const gate = createSemaphore(4);
 *   const result = await gate(async () => doExpensiveWork());
 *
 * Preserves FIFO order of waiters.
 */

export type Gate = <T>(fn: () => Promise<T> | T) => Promise<T>;

export function createSemaphore(concurrency: number): Gate {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Semaphore concurrency must be a positive integer, got ${concurrency}`);
  }

  let active = 0;
  const queue: (() => void)[] = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < concurrency) {
        active += 1;
        resolve();
        return;
      }
      queue.push(() => {
        active += 1;
        resolve();
      });
    });

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return async <T>(fn: () => Promise<T> | T): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
