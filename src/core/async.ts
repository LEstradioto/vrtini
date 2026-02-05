export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      if (firstError) {
        return;
      }
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (err) {
        firstError = err;
        return;
      }
    }
  };

  const workerCount = Math.min(safeLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (firstError) {
    throw firstError;
  }

  return results;
}
