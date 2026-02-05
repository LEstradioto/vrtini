import type { Command } from 'commander';
import { resolve, join, relative } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { loadConfig } from '../config.js';
import { normalizeBrowserConfig } from '../browser-versions.js';
import { getProjectDirs, getScreenshotFilename } from '../core/paths.js';
import { compareImages, getDiffPath } from '../compare.js';
import { generateReport } from '../report.js';
import type { ComparisonResult } from '../types/index.js';
import { buildEnginesConfig } from '../core/compare-runner.js';
import { getErrorMessage } from '../core/errors.js';
import { runWithConcurrency } from '../core/async.js';

interface BrowserRef {
  name: 'chromium' | 'webkit';
  version?: string;
}

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

function buildItemKey(scenario: string, viewport: string): string {
  return `${scenario}__${viewport}`;
}

function formatBrowser(ref: BrowserRef): string {
  return ref.version ? `${ref.name}-v${ref.version}` : ref.name;
}

function findLatestAndOld(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[],
  name: 'chromium' | 'webkit'
): { latest?: BrowserRef; old?: BrowserRef } {
  let latest: BrowserRef | undefined;
  let old: BrowserRef | undefined;

  for (const browser of browsers) {
    const normalized = normalizeBrowserConfig(browser);
    if (normalized.name !== name) continue;
    if (normalized.version) {
      if (!old) old = normalized;
    } else {
      latest = normalized;
    }
  }

  return { latest, old };
}

export function registerCrossCompareCommand(program: Command): void {
  program
    .command('cross-compare')
    .description('Generate cross-browser comparison reports')
    .option('-c, --config <path>', 'Path to config file')
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

        const { latest: chromiumLatest, old: chromiumOld } = findLatestAndOld(
          config.browsers,
          'chromium'
        );
        const { latest: webkitLatest, old: webkitOld } = findLatestAndOld(
          config.browsers,
          'webkit'
        );

        const crossCompare = config.crossCompare;
        const pairs = [];
        const availableKeys: string[] = [];

        if (chromiumLatest && chromiumOld) {
          const key = `${formatBrowser(chromiumLatest)}_vs_${formatBrowser(chromiumOld)}`;
          availableKeys.push(key);
          pairs.push({
            key,
            title: `Cross Compare: ${formatBrowser(chromiumLatest)} vs ${formatBrowser(chromiumOld)}`,
            baseline: chromiumLatest,
            test: chromiumOld,
          });
        }

        if (chromiumLatest && webkitLatest) {
          const key = `${formatBrowser(chromiumLatest)}_vs_${formatBrowser(webkitLatest)}`;
          availableKeys.push(key);
          pairs.push({
            key,
            title: `Cross Compare: ${formatBrowser(chromiumLatest)} vs ${formatBrowser(webkitLatest)}`,
            baseline: chromiumLatest,
            test: webkitLatest,
          });
        }

        if (chromiumLatest && webkitOld) {
          const key = `${formatBrowser(chromiumLatest)}_vs_${formatBrowser(webkitOld)}`;
          availableKeys.push(key);
          pairs.push({
            key,
            title: `Cross Compare: ${formatBrowser(chromiumLatest)} vs ${formatBrowser(webkitOld)}`,
            baseline: chromiumLatest,
            test: webkitOld,
          });
        }

        if (webkitLatest && webkitOld) {
          const key = `${formatBrowser(webkitLatest)}_vs_${formatBrowser(webkitOld)}`;
          availableKeys.push(key);
          pairs.push({
            key,
            title: `Cross Compare: ${formatBrowser(webkitLatest)} vs ${formatBrowser(webkitOld)}`,
            baseline: webkitLatest,
            test: webkitOld,
          });
        }

        if (pairs.length === 0) {
          throw new Error('No valid cross-compare pairs could be built from config browsers.');
        }
        const allowedPairs = new Set((crossCompare?.pairs ?? []).map((pair) => pair.trim()));
        const selectedPairs =
          allowedPairs.size > 0 ? pairs.filter((pair) => allowedPairs.has(pair.key)) : pairs;

        const quickMode = config.quickMode ?? false;
        const enginesConfig = buildEnginesConfig(quickMode, config.engines);
        const compareConcurrency = config.concurrency ?? 5;

        if (allowedPairs.size > 0 && selectedPairs.length === 0) {
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

        for (const pair of selectedPairs) {
          const results: ComparisonResult[] = [];
          const items: CrossResultItem[] = [];
          const diffDir = resolve(outputDir, 'cross-diffs', pair.key);
          const reportPath = resolve(outputDir, 'cross-reports', pair.key, 'report.html');
          const resultsPath = resolve(outputDir, 'cross-reports', pair.key, 'results.json');

          await mkdir(diffDir, { recursive: true });
          await mkdir(resolve(outputDir, 'cross-reports', pair.key), { recursive: true });

          const comparisonTasks: {
            scenario: (typeof config.scenarios)[number];
            viewport: (typeof config.viewports)[number];
            baselinePath: string;
            testPath: string;
            diffPath: string;
          }[] = [];

          for (const scenario of config.scenarios) {
            for (const viewport of config.viewports) {
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
                getScreenshotFilename(
                  scenario.name,
                  pair.test.name,
                  viewport.name,
                  pair.test.version
                )
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

          const comparisonResults = await runWithConcurrency(
            comparisonTasks,
            compareConcurrency,
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
                  scenario.diffThreshold?.maxDiffPercentage ??
                  config.diffThreshold?.maxDiffPercentage,
                maxDiffPixels:
                  scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
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

          console.log(`✓ ${pair.title}`);
          console.log(`  Report: ${reportPath}`);
        }
      } catch (err) {
        console.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
