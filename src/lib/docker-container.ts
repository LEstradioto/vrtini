/**
 * Docker container execution: single container and batch container runners.
 */

import Docker from 'dockerode';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Scenario, Viewport } from '../config.js';
import { getBatchResultsPath, sanitizeForFilename } from './paths.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';
import type { ScreenshotTask } from '../domain/task-planner.js';

/**
 * Docker multiplexed stream header size in bytes.
 * Docker prepends an 8-byte header to each frame: [stream_type(1), 0, 0, 0, size(4)]
 */
const DOCKER_STREAM_HEADER_SIZE = 8;

/**
 * Regex to strip Docker stream headers from log output.
 * Removes the first 8 characters from each line (the binary header as interpreted as text).
 */
const DOCKER_STREAM_HEADER_REGEX = new RegExp(`^.{${DOCKER_STREAM_HEADER_SIZE}}`, 'gm');

async function safeRemove(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export interface ScreenshotResult {
  task: ScreenshotTask;
  success: boolean;
  screenshotPath?: string;
  error?: string;
  logs?: string;
}

interface BatchTask {
  scenario: Scenario;
  viewport: Viewport;
  disableAnimations: boolean;
}

interface BatchConfig {
  browser: 'chromium' | 'webkit';
  browserDisplayName: string;
  concurrency: number;
  tasks: BatchTask[];
}

/** Discriminated union for batch result entries */
type BatchResultEntry =
  | { taskId: string; success: true; screenshot: string; warning?: string }
  | { taskId: string; success: false; error: string };

interface BatchResults {
  browser: string;
  totalTasks: number;
  succeeded: number;
  failed: number;
  elapsedSeconds: number;
  results: BatchResultEntry[];
}

/** Type guard for validating batch results from JSON */
function isBatchResults(data: unknown): data is BatchResults {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.browser === 'string' &&
    typeof obj.totalTasks === 'number' &&
    Array.isArray(obj.results) &&
    obj.results.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Record<string, unknown>).taskId === 'string' &&
        typeof (r as Record<string, unknown>).success === 'boolean'
    )
  );
}

/**
 * Run a single container for one screenshot task.
 * Kept for reference but replaced by batch runner in production.
 */
export async function runSingleContainer(
  task: ScreenshotTask,
  inputDir: string,
  outputDir: string,
  dockerImage: string,
  disableAnimations = true
): Promise<ScreenshotResult> {
  const docker = new Docker();
  const { scenario, browser, viewport } = task;

  const configData = {
    scenario,
    browser,
    viewport,
    disableAnimations,
  };

  const taskId = `${sanitizeForFilename(scenario.name)}_${browser}_${viewport.name}`;
  const taskInputDir = join(inputDir, taskId);

  await mkdir(taskInputDir, { recursive: true });
  await writeFile(join(taskInputDir, 'scenario.json'), JSON.stringify(configData, null, 2));

  let container: Docker.Container | null = null;
  let logs = '';

  try {
    container = await docker.createContainer({
      Image: dockerImage,
      HostConfig: {
        Binds: [`${taskInputDir}:/input:ro`, `${outputDir}:/output:rw`],
        AutoRemove: true,
      },
    });

    await container.start();

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    logs = await new Promise<string>((resolve) => {
      let output = '';
      logStream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').replace(DOCKER_STREAM_HEADER_REGEX, '');
        output += text;
      });
      logStream.on('end', () => resolve(output));
      logStream.on('error', (err: Error) => {
        // Log stream errors but still resolve with partial output.
        // The container result will indicate overall success/failure.
        log.warn(`Log stream error: ${err.message}`);
        resolve(output);
      });
    });

    const result = await container.wait();

    await safeRemove(taskInputDir);

    if (result.StatusCode !== 0) {
      return {
        task,
        success: false,
        error: `Container exited with code ${result.StatusCode}`,
        logs,
      };
    }

    const screenshotPath = join(outputDir, `${taskId}.png`);

    return {
      task,
      success: true,
      screenshotPath,
      logs,
    };
  } catch (error) {
    await safeRemove(taskInputDir);

    return {
      task,
      success: false,
      error: getErrorMessage(error),
      logs,
    };
  }
}

/**
 * Run batch container - single browser launch for multiple screenshots.
 * ~10x faster than running individual containers.
 */
export async function runBatchContainer(
  browser: 'chromium' | 'webkit',
  tasks: ScreenshotTask[],
  inputDir: string,
  outputDir: string,
  disableAnimations: boolean,
  dockerImage: string,
  concurrency = 5,
  signal?: AbortSignal,
  onContainerStart?: (containerId: string) => void,
  onTaskProgress?: (completed: number) => void
): Promise<ScreenshotResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  const docker = new Docker();

  // Use browser display name for unique batch dir (includes version)
  const firstTask = tasks[0];
  const browserDisplayName = firstTask.version ? `${browser}-v${firstTask.version}` : browser;

  // Create batch config
  const batchConfig: BatchConfig = {
    browser,
    browserDisplayName,
    concurrency,
    tasks: tasks.map((t) => ({
      scenario: t.scenario,
      viewport: t.viewport,
      disableAnimations,
    })),
  };
  const batchInputDir = join(inputDir, `batch-${browserDisplayName}`);
  await mkdir(batchInputDir, { recursive: true });
  await writeFile(join(batchInputDir, 'batch.json'), JSON.stringify(batchConfig, null, 2));

  let container: Docker.Container | null = null;
  let logs = '';

  try {
    // Check if already aborted
    if (signal?.aborted) {
      return tasks.map((task) => ({
        task,
        success: false,
        error: 'Aborted before start',
      }));
    }

    container = await docker.createContainer({
      Image: dockerImage,
      Cmd: ['node', 'batch-runner.js'],
      HostConfig: {
        Binds: [`${batchInputDir}:/input:ro`, `${outputDir}:/output:rw`],
        AutoRemove: true,
      },
    });

    // Report container ID for abort handling
    const containerId = container.id;
    onContainerStart?.(containerId);

    await container.start();

    // Set up abort handler
    const abortHandler = async () => {
      try {
        await container?.stop({ t: 0 });
      } catch (err) {
        // Expected: container may already be stopped or removed (AutoRemove: true).
        // Only log unexpected errors for debugging.
        const msg = getErrorMessage(err);
        if (!msg.includes('is not running') && !msg.includes('No such container')) {
          log.warn(`Failed to stop container on abort: ${msg}`);
        }
      }
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    logs = await new Promise<string>((resolve) => {
      let output = '';
      let buffer = '';
      let completed = 0;
      const seenTasks = new Set<string>();
      logStream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').replace(DOCKER_STREAM_HEADER_REGEX, '');
        output += text;
        process.stdout.write(text);
        buffer += text;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const match = line.match(/^\[(OK|FAIL)\]\s+(.+?)(?:\s->|:)/);
          if (!match) continue;
          const taskId = match[2].trim();
          if (seenTasks.has(taskId)) continue;
          seenTasks.add(taskId);
          completed += 1;
          onTaskProgress?.(completed);
        }
      });
      logStream.on('end', () => resolve(output));
      logStream.on('error', (err: Error) => {
        // Log stream errors but still resolve with partial output.
        // The container result will indicate overall success/failure.
        log.warn(`Log stream error: ${err.message}`);
        resolve(output);
      });
    });

    await container.wait();
    await safeRemove(batchInputDir);

    // Read batch results
    const resultsPath = getBatchResultsPath(outputDir);
    if (!existsSync(resultsPath)) {
      return tasks.map((task) => ({
        task,
        success: false,
        error: 'Batch results file not found',
        logs,
      }));
    }

    const rawResults: unknown = JSON.parse(await readFile(resultsPath, 'utf-8'));
    if (!isBatchResults(rawResults)) {
      return tasks.map((task) => ({
        task,
        success: false,
        error: 'Invalid batch results format',
        logs,
      }));
    }
    const batchResults = rawResults;

    // Map batch results back to ScreenshotResult
    const resultMap = new Map<string, BatchResultEntry>();
    for (const r of batchResults.results) {
      resultMap.set(r.taskId, r);
    }

    const results: ScreenshotResult[] = tasks.map((task) => {
      const taskDisplayName = task.version ? `${browser}-v${task.version}` : browser;
      const taskId = `${task.scenario.name}|${taskDisplayName}|${task.viewport.name}`;
      const batchResult = resultMap.get(taskId);

      if (!batchResult) {
        return {
          task,
          success: false,
          error: 'Task not found in batch results',
          logs,
        };
      }

      // Discriminated union: TypeScript narrows based on success field
      if (batchResult.success) {
        return {
          task,
          success: true,
          screenshotPath: join(outputDir, batchResult.screenshot),
          logs,
        };
      }
      return {
        task,
        success: false,
        error: batchResult.error,
        logs,
      };
    });

    // Clean up batch results file
    await rm(resultsPath, { force: true });

    return results;
  } catch (error) {
    await safeRemove(batchInputDir);

    return tasks.map((task) => ({
      task,
      success: false,
      error: getErrorMessage(error),
      logs,
    }));
  }
}
