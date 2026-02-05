import type { Command } from 'commander';
import { resolve, join, relative } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { loadConfig } from '../config.js';
import { normalizeBrowserConfig } from '../browser-versions.js';
import { getProjectDirs, getScreenshotFilename } from '../core/paths.js';
import { compareImages, getDiffPath } from '../compare.js';
import { generateReport } from '../report.js';
import { formatBrowser, type BrowserRef, type ComparisonResult } from '../types/index.js';
import { buildEnginesConfig } from '../core/compare-runner.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';
import { runWithConcurrency } from '../core/async.js';
import type { VRTConfig, Scenario, Viewport } from '../core/config.js';

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
  phash?: { similarity: number; baselineHash: string; testHash: string };
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

interface CrossPair {
  key: string;
  title: string;
  baseline: BrowserRef;
  test: BrowserRef;
}

function buildItemKey(scenario: string, viewport: string): string {
  return `${scenario}__${viewport}`;
}

function buildCrossComparePairs(config: VRTConfig): {
  pairs: CrossPair[];
  availableKeys: string[];
} {
  const all = config.browsers.map(normalizeBrowserConfig);
  const pairs: CrossPair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];

      // Skip identical entries (same name and version)
      if (a.name === b.name && a.version === b.version) continue;

      // Baseline preference: unversioned (latest) over versioned (old)
      let baseline: BrowserRef = a;
      let test: BrowserRef = b;
      if (a.version && !b.version) {
        baseline = b;
        test = a;
      }

      const key = `${formatBrowser(baseline)}_vs_${formatBrowser(test)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({
        key,
        title: `Cross Compare: ${formatBrowser(baseline)} vs ${formatBrowser(test)}`,
        baseline,
        test,
      });
    }
  }

  if (pairs.length === 0) {
    throw new Error(
      'No valid cross-compare pairs could be built from config browsers. Need at least two distinct browsers.'
    );
  }

  return { pairs, availableKeys: pairs.map((p) => p.key) };
}

function filterPairs(
  pairs: CrossPair[],
  availableKeys: string[],
  crossCompare: VRTConfig['crossCompare'],
  cliPair?: string
): CrossPair[] {
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
  pair: CrossPair,
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
      const result = await compareImages(baselinePath, testPath, diffPath, {
        threshold: config.threshold,
        diffColor: config.diffColor,
        computePHash: !quickMode,
        engines: enginesConfig,
        keepDiffOnMatch: true,
        sizeNormalization: crossCompare?.normalization,
        sizeMismatchHandling: crossCompare?.mismatch,
        antialiasing: config.engines?.pixelmatch?.antialiasing,
        maxDiffPercentage:
          scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage,
        maxDiffPixels: scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
      });

      const diffPathValue = getDiffPath(result);
      const item: CrossResultItem = {
        itemKey: buildItemKey(scenario.name, viewport.name),
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
        phash: 'phash' in result ? result.phash : undefined,
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
