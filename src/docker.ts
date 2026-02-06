/**
 * Docker orchestrator: coordinates screenshot tasks across Docker containers.
 * Delegates image management to lib/docker-image.ts and container execution to lib/docker-container.ts.
 */

import { mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import type { VRTConfig } from './config.js';
import { LATEST_PLAYWRIGHT_VERSION } from './browser-versions.js';
import {
  groupTasksByBrowser,
  getTotalTaskCount,
  filterScenarios,
  findMissingImages,
  filterGroupsWithImages,
} from './domain/task-planner.js';
import { checkDockerConnection, checkDockerImage } from './lib/docker-image.js';
import { runBatchContainer, type ScreenshotResult } from './lib/docker-container.js';
import { log } from './core/logger.js';

// Re-export for backward compatibility
export { getScreenshotFilename } from './core/paths.js';
export type { ScreenshotTask } from './domain/task-planner.js';
export type { ScreenshotResult } from './lib/docker-container.js';
export { buildDockerImage, checkDockerConnection, checkDockerImage } from './lib/docker-image.js';

export interface RunOptions {
  config: VRTConfig;
  scenarios?: string[];
  signal?: AbortSignal;
  onContainerStart?: (containerId: string) => void;
  onProgress?: (completed: number, total: number, phase: 'capturing' | 'comparing') => void;
}

function countResults(results: ScreenshotResult[]): { successful: number; failed: number } {
  let successful = 0;
  let failed = 0;
  for (const result of results) {
    if (result.success) successful += 1;
    else failed += 1;
  }
  return { successful, failed };
}

export async function runScreenshotTasks(options: RunOptions): Promise<ScreenshotResult[]> {
  const { config, scenarios: scenarioFilter, signal, onContainerStart, onProgress } = options;

  // Check Docker connection first
  const dockerStatus = await checkDockerConnection();
  if (!dockerStatus.connected) {
    throw new Error(dockerStatus.error);
  }

  const outputDir = resolve(process.cwd(), config.outputDir);
  const inputDir = resolve(outputDir, '.tmp-input');

  await mkdir(outputDir, { recursive: true });
  await mkdir(inputDir, { recursive: true });

  // Filter scenarios (pure)
  const scenarios = filterScenarios(config.scenarios, scenarioFilter);
  if (scenarios.length === 0) {
    throw new Error('No scenarios to run');
  }

  // Group tasks by browser+version (pure)
  const allGroups = groupTasksByBrowser(
    scenarios,
    config.browsers,
    config.viewports,
    config.scenarioDefaults
  );

  // Check which Docker images exist (I/O)
  const imageExists = new Map<string, boolean>();
  for (const [browserKey, group] of allGroups) {
    imageExists.set(browserKey, await checkDockerImage(group.dockerImage));
  }

  // Find missing images and filter groups (pure)
  const missingImages = findMissingImages(allGroups, imageExists);
  if (missingImages.length > 0) {
    const pwVersions = [
      ...new Set(
        missingImages.map((img) => {
          const match = img.match(/:v(.+)$/);
          return match ? match[1] : LATEST_PLAYWRIGHT_VERSION;
        })
      ),
    ];
    throw new Error(
      `Missing Docker images: ${missingImages.join(', ')}\n` +
        `Build them with:\n` +
        pwVersions.map((v) => `  vrt build --version ${v}`).join('\n')
    );
  }

  const tasksByBrowserVersion = filterGroupsWithImages(allGroups, imageExists);
  const totalTasks = getTotalTaskCount(tasksByBrowserVersion);
  log.info(`Running ${totalTasks} screenshot tasks (batch mode)...`);

  const disableAnimations = config.disableAnimations ?? true;
  const concurrency = config.concurrency ?? 5;
  const captureSnapshot = config.domSnapshot?.enabled
    ? { maxElements: config.domSnapshot.maxElements ?? 2000 }
    : undefined;
  const allResults: ScreenshotResult[] = [];
  let completedTasks = 0;

  // Report initial progress
  onProgress?.(0, totalTasks, 'capturing');

  // Run batches sequentially (one container per browser+version)
  for (const [browserKey, group] of tasksByBrowserVersion) {
    // Check if aborted
    if (signal?.aborted) {
      log.info(`\nAborted - skipping remaining tasks`);
      break;
    }

    log.info(
      `\n[${browserKey}] Processing ${group.tasks.length} tasks (${group.dockerImage}, concurrency: ${concurrency})...`
    );
    let groupCompleted = 0;
    const results = await runBatchContainer(
      group.browser,
      group.tasks,
      inputDir,
      outputDir,
      disableAnimations,
      group.dockerImage,
      concurrency,
      signal,
      onContainerStart,
      (completed) => {
        groupCompleted = completed;
        onProgress?.(completedTasks + groupCompleted, totalTasks, 'capturing');
      },
      captureSnapshot
    );
    allResults.push(...results);

    // Update progress after each batch
    completedTasks += results.length;
    onProgress?.(completedTasks, totalTasks, 'capturing');
  }

  await rm(inputDir, { recursive: true, force: true });

  const { successful, failed } = countResults(allResults);

  log.info(`\nCompleted: ${successful} successful, ${failed} failed`);

  return allResults;
}
