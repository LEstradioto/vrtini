import type { Command } from 'commander';
import { resolve, join, relative } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { loadConfig } from '../core/config.js';
import { getProjectDirs, getScreenshotFilename, getSnapshotFilename } from '../core/paths.js';
import { compareImages } from '../compare.js';
import { generateReport } from '../report.js';
import { formatBrowser, getDiffPath, type ComparisonResult } from '../types/index.js';
import { buildEnginesConfig } from '../core/compare-runner.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';
import { runWithConcurrency } from '../core/async.js';
import type { VRTConfig, Scenario, Viewport } from '../core/config.js';
import {
  buildCrossComparePairs as buildPairsFromBrowsers,
  type CrossComparePair,
} from '../domain/cross-pairs.js';
import { buildCrossItemKey } from '../domain/cross-summary.js';

interface CrossResultItem {
  itemKey?: string;
  name: string;
  scenario: string;
  viewport: string;
  baseline: string;
  test: string;
  diff?: string;
  match: boolean;
  reason: ComparisonResult['reason'];
  diffPercentage: number;
  pixelDiff: number;
  ssimScore?: number;
  engineResults?: {
    engine: string;
    similarity: number;
    diffPercent?: number;
    diffPixels?: number;
    error?: string;
  }[];
  phash?: { similarity: number; baselineHash: string; testHash: string };
  domSnapshot?: {
    enabled: boolean;
    baselineFound: boolean;
    testFound: boolean;
  };
  domDiff?: ComparisonResult extends { domDiff?: infer T } ? T : unknown;
  error?: string;
}

interface CrossResults {
  key: string;
  title: string;
  generatedAt: string;
  baselineLabel: string;
  testLabel: string;
  items: CrossResultItem[];
}

function buildCrossComparePairs(config: VRTConfig): {
  pairs: CrossComparePair[];
  availableKeys: string[];
} {
  const pairs = buildPairsFromBrowsers(config.browsers);
  if (pairs.length === 0) {
    throw new Error(
      'No valid cross-compare pairs could be built from config browsers. Need at least two distinct browsers.'
    );
  }
  return { pairs, availableKeys: pairs.map((p) => p.key) };
}

function filterPairs(
  pairs: CrossComparePair[],
  availableKeys: string[],
  crossCompare: VRTConfig['crossCompare'],
  cliPair?: string
): CrossComparePair[] {
  const allowedPairs = new Set((crossCompare?.pairs ?? []).map((pair) => pair.trim()));
  let selected = allowedPairs.size > 0 ? pairs.filter((p) => allowedPairs.has(p.key)) : pairs;

  if (cliPair) {
    selected = selected.filter((p) => p.key === cliPair);
    if (selected.length === 0) {
      throw new Error(
        `Unknown cross-compare pair: ${cliPair}. Available: ${availableKeys.join(', ')}`
      );
    }
  }

  if (allowedPairs.size > 0 && selected.length === 0) {
    throw new Error(`No cross-compare pairs matched. Available: ${availableKeys.join(', ')}`);
  }

  if (allowedPairs.size > 0) {
    const missing = [...allowedPairs].filter((pair) => !availableKeys.includes(pair));
    if (missing.length > 0) {
      throw new Error(
        `Requested cross-compare pairs not available with current browsers: ${missing.join(', ')}`
      );
    }
  }

  return selected;
}

function parseCliArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v: unknown) => String(v));
  if (typeof value === 'string') return [value];
  return [];
}

function parseAndValidateFilters(
  config: VRTConfig,
  scenarioOption: unknown,
  viewportOption: unknown
): { scenarios: Scenario[]; viewports: Viewport[] } {
  const scenarioNames = new Set(
    parseCliArray(scenarioOption)
      .map((n) => n.trim())
      .filter(Boolean)
  );
  const viewportNames = new Set(
    parseCliArray(viewportOption)
      .map((n) => n.trim())
      .filter(Boolean)
  );

  if (scenarioNames.size > 0) {
    const available = new Set(config.scenarios.map((s) => s.name));
    const missing = [...scenarioNames].filter((n) => !available.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Unknown scenario(s): ${missing.join(', ')}. Available: ${[...available].join(', ')}`
      );
    }
  }

  if (viewportNames.size > 0) {
    const available = new Set(config.viewports.map((v) => v.name));
    const missing = [...viewportNames].filter((n) => !available.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Unknown viewport(s): ${missing.join(', ')}. Available: ${[...available].join(', ')}`
      );
    }
  }

  const scenarios =
    scenarioNames.size > 0
      ? config.scenarios.filter((s) => scenarioNames.has(s.name))
      : config.scenarios;
  const viewports =
    viewportNames.size > 0
      ? config.viewports.filter((v) => viewportNames.has(v.name))
      : config.viewports;

  return { scenarios, viewports };
}

async function runPairComparison(
  pair: CrossComparePair,
  scenarios: Scenario[],
  viewports: Viewport[],
  config: VRTConfig,
  cwd: string,
  outputDir: string,
  enginesConfig: VRTConfig['engines'],
  quickMode: boolean,
  concurrency: number
): Promise<void> {
  const crossCompare = config.crossCompare;
  const diffDir = resolve(outputDir, 'cross-diffs', pair.key);
  const reportPath = resolve(outputDir, 'cross-reports', pair.key, 'report.html');
  const resultsPath = resolve(outputDir, 'cross-reports', pair.key, 'results.json');

  await mkdir(diffDir, { recursive: true });
  await mkdir(resolve(outputDir, 'cross-reports', pair.key), { recursive: true });

  const comparisonTasks: {
    scenario: Scenario;
    viewport: Viewport;
    baselinePath: string;
    testPath: string;
    diffPath: string;
  }[] = [];

  for (const scenario of scenarios) {
    for (const viewport of viewports) {
      const baselinePath = resolve(
        outputDir,
        getScreenshotFilename(
          scenario.name,
          pair.baseline.name,
          viewport.name,
          pair.baseline.version
        )
      );
      const testPath = resolve(
        outputDir,
        getScreenshotFilename(scenario.name, pair.test.name, viewport.name, pair.test.version)
      );
      const diffName = getScreenshotFilename(
        scenario.name,
        `${formatBrowser(pair.baseline)}-vs-${formatBrowser(pair.test)}`,
        viewport.name
      );
      const diffPath = join(diffDir, diffName);

      comparisonTasks.push({ scenario, viewport, baselinePath, testPath, diffPath });
    }
  }

  if (comparisonTasks.length === 0) {
    throw new Error('No cross-compare items matched the provided filters.');
  }

  const comparisonResults = await runWithConcurrency(
    comparisonTasks,
    concurrency,
    async ({ scenario, viewport, baselinePath, testPath, diffPath }) => {
      const domSnapshotEnabled = !!config.domSnapshot?.enabled;
      const baselineSnapshotPath = resolve(outputDir, getSnapshotFilename(baselinePath));
      const testSnapshotPath = resolve(outputDir, getSnapshotFilename(testPath));
      const baselineSnapshotFound = domSnapshotEnabled && existsSync(baselineSnapshotPath);
      const testSnapshotFound = domSnapshotEnabled && existsSync(testSnapshotPath);
      const result = await compareImages(baselinePath, testPath, diffPath, {
        threshold: config.threshold,
        diffColor: config.diffColor,
        computePHash: !quickMode,
        engines: enginesConfig,
        keepDiffOnMatch: true,
        sizeNormalization: crossCompare?.normalization,
        sizeMismatchHandling: crossCompare?.mismatch,
        verticalAlign: crossCompare?.verticalAlign,
        antialiasing: config.engines?.pixelmatch?.antialiasing,
        maxDiffPercentage:
          scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage,
        maxDiffPixels: scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
        baselineSnapshot: baselineSnapshotFound ? baselineSnapshotPath : undefined,
        testSnapshot: testSnapshotFound ? testSnapshotPath : undefined,
      });

      const diffPathValue = getDiffPath(result);
      const item: CrossResultItem = {
        itemKey: buildCrossItemKey(scenario.name, viewport.name),
        name: scenario.name,
        scenario: scenario.name,
        viewport: viewport.name,
        baseline: relative(cwd, baselinePath),
        test: relative(cwd, testPath),
        diff: diffPathValue ? relative(cwd, diffPathValue) : undefined,
        match: result.match,
        reason: result.reason,
        diffPercentage: result.diffPercentage,
        pixelDiff: result.pixelDiff,
        ssimScore: 'ssimScore' in result ? result.ssimScore : undefined,
        engineResults:
          result.reason === 'diff' && Array.isArray(result.engineResults)
            ? result.engineResults.map((engineResult) => ({
                engine: engineResult.engine,
                similarity: engineResult.similarity,
                diffPercent: engineResult.diffPercent,
                diffPixels: engineResult.diffPixels,
                error: engineResult.error,
              }))
            : undefined,
        phash: 'phash' in result ? result.phash : undefined,
        domSnapshot: domSnapshotEnabled
          ? {
              enabled: true,
              baselineFound: baselineSnapshotFound,
              testFound: testSnapshotFound,
            }
          : undefined,
        domDiff: result.reason === 'diff' ? result.domDiff : undefined,
        error: result.reason === 'error' ? result.error : undefined,
      };

      return { result, item };
    }
  );

  const results: ComparisonResult[] = [];
  const items: CrossResultItem[] = [];
  for (const entry of comparisonResults) {
    results.push(entry.result);
    items.push(entry.item);
  }

  await generateReport(
    {
      title: pair.title,
      timestamp: new Date().toISOString(),
      results,
      baselineDir: outputDir,
      outputDir,
    },
    { outputPath: reportPath, embedImages: config.report?.embedImages }
  );

  const crossResults: CrossResults = {
    key: pair.key,
    title: pair.title,
    generatedAt: new Date().toISOString(),
    baselineLabel: formatBrowser(pair.baseline),
    testLabel: formatBrowser(pair.test),
    items,
  };
  await writeFile(resultsPath, JSON.stringify(crossResults, null, 2));

  log.info(`✓ ${pair.title}`);
  log.info(`  Report: ${reportPath}`);
}

export function registerCrossCompareCommand(program: Command): void {
  program
    .command('cross-compare')
    .description('Generate cross-browser comparison reports')
    .option('-c, --config <path>', 'Path to config file')
    .option('-p, --pair <key>', 'Run a single cross-compare pair')
    .option('-s, --scenario <name...>', 'Run specific scenarios')
    .option('-v, --viewport <name...>', 'Run specific viewports')
    .action(async (options) => {
      try {
        const config = await loadConfig(options.config);
        const cwd = process.cwd();
        if (options.config) {
          const resolvedConfigPath = resolve(cwd, options.config);
          const rel = relative(cwd, resolvedConfigPath);
          if (rel.startsWith('..') || rel.startsWith('/')) {
            throw new Error(
              'Config path is outside the current working directory. Run the command from the project root so paths resolve correctly.'
            );
          }
        }
        const { outputDir } = getProjectDirs(cwd, config);

        const { pairs, availableKeys } = buildCrossComparePairs(config);
        const selectedPairs = filterPairs(pairs, availableKeys, config.crossCompare, options.pair);
        const { scenarios, viewports } = parseAndValidateFilters(
          config,
          options.scenario,
          options.viewport
        );

        const quickMode = config.quickMode ?? false;
        const enginesConfig = buildEnginesConfig(quickMode, config.engines);
        const concurrency = config.concurrency ?? 5;

        for (const pair of selectedPairs) {
          await runPairComparison(
            pair,
            scenarios,
            viewports,
            config,
            cwd,
            outputDir,
            enginesConfig,
            quickMode,
            concurrency
          );
        }
      } catch (err) {
        log.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
