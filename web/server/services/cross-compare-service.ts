import { mkdir, readFile, readdir, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import type { VRTConfig } from '../../../src/core/config.js';
import { saveJsonFile } from '../../../src/core/json-file-store.js';
import { buildCrossComparePairs } from '../../../src/domain/cross-pairs.js';
import { evaluateCrossSmartPass } from '../../../src/domain/smart-pass.js';
import {
  buildCrossItemKey,
  crossItemToComparisonResult,
  summarizeCrossItems,
} from '../../../src/domain/cross-summary.js';
import {
  clearCrossDeletions,
  clearCrossDeletionsForItems,
  loadCrossAcceptances,
  loadCrossDeletions,
  loadCrossFlags,
  saveCrossAcceptances,
  saveCrossDeletions,
  saveCrossFlags,
  type CrossAcceptanceRecord,
  type CrossAcceptanceStore,
  type CrossFlagRecord,
  type CrossFlagStore,
} from './cross-compare-stores.js';
import { log } from '../../../src/core/logger.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import {
  getProjectDirs,
  getScreenshotFilename,
  getSnapshotFilename,
} from '../../../src/core/paths.js';
import { compareImages } from '../../../src/compare.js';
import { formatBrowser, type ComparisonResult } from '../../../src/types/index.js';
import { getDiffPath } from '../../../src/types/index.js';
import { buildEnginesConfig } from '../../../src/core/compare-runner.js';
import { generateReport } from '../../../src/report.js';
import type { PerceptualHashResult } from '../../../src/phash.js';
import type { AIAnalysisResult } from '../../../src/domain/ai-prompt.js';
import type { DomDiffResult } from '../../../src/engines/dom-diff.js';

export interface CrossReport {
  key: string;
  title: string;
  reportPath: string;
  url: string;
}

export interface CrossResultItem {
  itemKey?: string;
  name: string;
  scenario: string;
  viewport: string;
  baseline: string;
  test: string;
  diff?: string;
  baselineUpdatedAt?: string;
  testUpdatedAt?: string;
  diffUpdatedAt?: string;
  match: boolean;
  reason: ComparisonResult['reason'];
  diffPercentage: number;
  pixelDiff: number;
  ssimScore?: number;
  engineResults?: {
    engine: string;
    similarity: number;
    diffPercent: number;
    diffPixels?: number;
    error?: string;
  }[];
  phash?: PerceptualHashResult;
  domSnapshot?: {
    enabled: boolean;
    baselineFound: boolean;
    testFound: boolean;
  };
  domDiff?: DomDiffResult;
  error?: string;
  accepted?: boolean;
  acceptedAt?: string;
  flagged?: boolean;
  flaggedAt?: string;
  aiAnalysis?: AIAnalysisResult;
  smartPass?: boolean;
  smartPassReason?: string;
  outdated?: boolean;
}

export interface CrossResults {
  key: string;
  title: string;
  generatedAt: string;
  baselineLabel: string;
  testLabel: string;
  items: CrossResultItem[];
}

export interface CrossResultsSummary {
  key: string;
  title: string;
  generatedAt: string;
  baselineLabel: string;
  testLabel: string;
  itemCount: number;
  approvedCount: number;
  smartPassCount: number;
  matchCount: number;
  diffCount: number;
  issueCount: number;
  flaggedCount: number;
  outdatedCount?: number;
}

export interface CrossCompareRunOptions {
  key?: string;
  itemKeys?: string[];
  scenarios?: string[];
  viewports?: string[];
  resetAcceptances?: boolean;
}

export interface CrossCompareProgressUpdate {
  phase: 'preparing' | 'running' | 'done';
  pairKey?: string;
  pairTitle?: string;
  pairIndex: number;
  pairTotal: number;
  itemIndex: number;
  itemTotal: number;
  progress: number;
  total: number;
}

async function clearCrossAcceptancesForItems(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKeys: string[]
): Promise<void> {
  if (itemKeys.length === 0) return;
  const store = await loadCrossAcceptances(projectPath);
  const pair = store[key];
  if (!pair) return;

  const itemKeySet = new Set(itemKeys);
  const remainingEntries = Object.entries(pair).filter(([itemKey]) => !itemKeySet.has(itemKey));

  if (remainingEntries.length === Object.keys(pair).length) {
    return;
  }

  if (remainingEntries.length === 0) {
    const { [key]: _removed, ...rest } = store;
    await saveCrossAcceptances(projectPath, rest);
  } else {
    await saveCrossAcceptances(projectPath, {
      ...store,
      [key]: Object.fromEntries(remainingEntries),
    });
  }

  for (const itemKey of itemKeys) {
    await updateCrossResultsAcceptance(projectPath, config, key, itemKey);
  }
}

async function getMtimeIso(absolutePath: string): Promise<string | undefined> {
  try {
    const s = await stat(absolutePath);
    return s.mtime.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Decorate items with mtime stamps for baseline/test/diff and an `outdated`
 * flag set when either source screenshot was modified after the cross-compare
 * report was generated. Stat failures are tolerated (item just shows no
 * stamp). Reapplies smart-pass metadata since `outdated` participates in it.
 */
async function enrichItemsWithMtimes(
  items: CrossResultItem[],
  projectPath: string,
  generatedAtMs: number
): Promise<CrossResultItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const baselineUpdatedAt = item.baseline
        ? await getMtimeIso(resolve(projectPath, item.baseline))
        : undefined;
      const testUpdatedAt = item.test
        ? await getMtimeIso(resolve(projectPath, item.test))
        : undefined;
      const diffUpdatedAt = item.diff
        ? await getMtimeIso(resolve(projectPath, item.diff))
        : undefined;

      const latestSourceMs = Math.max(
        baselineUpdatedAt ? Date.parse(baselineUpdatedAt) || 0 : 0,
        testUpdatedAt ? Date.parse(testUpdatedAt) || 0 : 0
      );
      const outdated = generatedAtMs > 0 && latestSourceMs > generatedAtMs;

      return withSmartPassMetadata({
        ...item,
        baselineUpdatedAt,
        testUpdatedAt,
        diffUpdatedAt,
        outdated,
      });
    })
  );
}

function withSmartPassMetadata(item: CrossResultItem): CrossResultItem {
  const evaluation = evaluateCrossSmartPass(item);
  return { ...item, smartPass: evaluation.smartPass, smartPassReason: evaluation.reason };
}

const toComparisonResult = (item: CrossResultItem, projectPath: string): ComparisonResult =>
  crossItemToComparisonResult(item, (p) => resolve(projectPath, p));

interface CrossRunPlan {
  selectedPairs: ReturnType<typeof buildCrossComparePairs>;
  scenariosToRun: VRTConfig['scenarios'];
  viewportsToRun: VRTConfig['viewports'];
  itemKeyFilter: Set<string> | null;
  isFilteredRun: boolean;
  quickMode: boolean;
  enginesConfig: ReturnType<typeof buildEnginesConfig>;
  pairTotal: number;
  itemTotalPerPair: number;
  totalPlannedItems: number;
}

/**
 * Validate cross-compare run options + assemble the execution plan.
 * Pure: throws on unknown pair/scenario/viewport filters, otherwise
 * returns everything runCrossCompare needs to drive its loop.
 */
function resolveCrossRunPlan(config: VRTConfig, options: CrossCompareRunOptions): CrossRunPlan {
  const pairs = buildCrossComparePairs(config.browsers);

  if (pairs.length === 0) {
    throw new Error(
      'Cross compare requires at least two distinct browsers in config (e.g. "chromium" and { "name": "webkit", "version": "14.1" })'
    );
  }

  const availableKeys = pairs.map((pair) => pair.key);
  const selectedPairs = options.key ? pairs.filter((pair) => pair.key === options.key) : pairs;
  if (options.key && selectedPairs.length === 0) {
    throw new Error(
      `Unknown cross-compare pair: ${options.key}. Available: ${availableKeys.join(', ')}`
    );
  }

  const scenarioFilter = new Set(
    (options.scenarios ?? []).map((name) => name.trim()).filter(Boolean)
  );
  const viewportFilter = new Set(
    (options.viewports ?? []).map((name) => name.trim()).filter(Boolean)
  );
  const itemKeyFilter =
    options.itemKeys && options.itemKeys.length > 0 ? new Set(options.itemKeys) : null;

  if (scenarioFilter.size > 0) {
    const available = new Set(config.scenarios.map((scenario) => scenario.name));
    const missing = [...scenarioFilter].filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Unknown scenario(s): ${missing.join(', ')}. Available: ${[...available].join(', ')}`
      );
    }
  }
  if (viewportFilter.size > 0) {
    const available = new Set(config.viewports.map((viewport) => viewport.name));
    const missing = [...viewportFilter].filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Unknown viewport(s): ${missing.join(', ')}. Available: ${[...available].join(', ')}`
      );
    }
  }

  const scenariosToRun =
    scenarioFilter.size > 0
      ? config.scenarios.filter((scenario) => scenarioFilter.has(scenario.name))
      : config.scenarios;
  const viewportsToRun =
    viewportFilter.size > 0
      ? config.viewports.filter((viewport) => viewportFilter.has(viewport.name))
      : config.viewports;
  const isFilteredRun =
    itemKeyFilter !== null || scenarioFilter.size > 0 || viewportFilter.size > 0;

  const quickMode = config.quickMode ?? false;
  const enginesConfig = buildEnginesConfig(quickMode, config.engines);
  const pairTotal = selectedPairs.length;
  const itemTotalPerPair = scenariosToRun.reduce((acc, scenario) => {
    for (const viewport of viewportsToRun) {
      const itemKey = buildCrossItemKey(scenario.name, viewport.name);
      if (itemKeyFilter && !itemKeyFilter.has(itemKey)) continue;
      acc += 1;
    }
    return acc;
  }, 0);
  const totalPlannedItems = pairTotal * itemTotalPerPair;

  return {
    selectedPairs,
    scenariosToRun,
    viewportsToRun,
    itemKeyFilter,
    isFilteredRun,
    quickMode,
    enginesConfig,
    pairTotal,
    itemTotalPerPair,
    totalPlannedItems,
  };
}

interface CompareCrossItemCtx {
  projectPath: string;
  outputDir: string;
  diffDir: string;
  config: VRTConfig;
  quickMode: boolean;
  enginesConfig: ReturnType<typeof buildEnginesConfig>;
}

/**
 * Compare a single (scenario × viewport) pair and produce a fully-shaped
 * CrossResultItem. This is the inner body of runCrossCompare's double loop;
 * extracting it makes the orchestration loop shallow and the per-item logic
 * unit-testable in isolation.
 */
async function compareCrossItem(
  pair: ReturnType<typeof buildCrossComparePairs>[number],
  scenario: VRTConfig['scenarios'][number],
  viewport: VRTConfig['viewports'][number],
  itemKey: string,
  ctx: CompareCrossItemCtx
): Promise<CrossResultItem> {
  const { projectPath, outputDir, diffDir, config, quickMode, enginesConfig } = ctx;
  const baselineFilename = getScreenshotFilename(
    scenario.name,
    pair.baseline.name,
    viewport.name,
    pair.baseline.version
  );
  const testFilename = getScreenshotFilename(
    scenario.name,
    pair.test.name,
    viewport.name,
    pair.test.version
  );
  const baselinePath = resolve(outputDir, baselineFilename);
  const testPath = resolve(outputDir, testFilename);
  const baselineSnapshotPath = resolve(outputDir, getSnapshotFilename(baselineFilename));
  const testSnapshotPath = resolve(outputDir, getSnapshotFilename(testFilename));
  const domSnapshotEnabled = !!config.domSnapshot?.enabled;
  const baselineSnapshotFound = domSnapshotEnabled && existsSync(baselineSnapshotPath);
  const testSnapshotFound = domSnapshotEnabled && existsSync(testSnapshotPath);

  const diffName = getScreenshotFilename(
    scenario.name,
    `${formatBrowser(pair.baseline)}-vs-${formatBrowser(pair.test)}`,
    viewport.name
  );
  const diffPath = resolve(diffDir, diffName);

  const result = await compareImages(baselinePath, testPath, diffPath, {
    threshold: config.threshold,
    diffColor: config.diffColor,
    computePHash: !quickMode,
    engines: enginesConfig,
    keepDiffOnMatch: true,
    sizeNormalization: config.crossCompare?.normalization,
    sizeMismatchHandling: config.crossCompare?.mismatch,
    verticalAlign: config.crossCompare?.verticalAlign,
    antialiasing: config.engines?.pixelmatch?.antialiasing,
    maxDiffPercentage:
      scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage,
    maxDiffPixels: scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
    baselineSnapshot:
      domSnapshotEnabled && baselineSnapshotFound ? baselineSnapshotPath : undefined,
    testSnapshot: domSnapshotEnabled && testSnapshotFound ? testSnapshotPath : undefined,
  });

  const diffPathValue = getDiffPath(result);
  const itemBase: CrossResultItem = {
    itemKey,
    name: scenario.name,
    scenario: scenario.name,
    viewport: viewport.name,
    baseline: relative(projectPath, baselinePath),
    test: relative(projectPath, testPath),
    diff: diffPathValue ? relative(projectPath, diffPathValue) : undefined,
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

  return withSmartPassMetadata(itemBase);
}

export async function runCrossCompare(
  projectId: string,
  projectPath: string,
  config: VRTConfig,
  options: CrossCompareRunOptions = {},
  onProgress?: (update: CrossCompareProgressUpdate) => void
): Promise<CrossReport[]> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const {
    selectedPairs,
    scenariosToRun,
    viewportsToRun,
    itemKeyFilter,
    isFilteredRun,
    quickMode,
    enginesConfig,
    pairTotal,
    itemTotalPerPair,
    totalPlannedItems,
  } = resolveCrossRunPlan(config, options);

  const emitProgress = (update: CrossCompareProgressUpdate): void => {
    if (!onProgress) return;
    try {
      onProgress(update);
    } catch {
      // Do not fail the run due to progress callback issues.
    }
  };

  const reports: CrossReport[] = [];
  let completedItems = 0;

  emitProgress({
    phase: 'preparing',
    pairIndex: 0,
    pairTotal,
    itemIndex: 0,
    itemTotal: itemTotalPerPair,
    progress: 0,
    total: totalPlannedItems,
  });

  for (let pairIndex = 0; pairIndex < selectedPairs.length; pairIndex++) {
    const pair = selectedPairs[pairIndex];
    const items: CrossResultItem[] = [];
    const updatedItemKeys: string[] = [];
    const diffDir = resolve(outputDir, 'cross-diffs', pair.key);
    const reportPath = resolve(outputDir, 'cross-reports', pair.key, 'report.html');
    const resultsPath = resolve(outputDir, 'cross-reports', pair.key, 'results.json');

    await mkdir(diffDir, { recursive: true });
    await mkdir(dirname(resultsPath), { recursive: true });

    if (!isFilteredRun) {
      await clearCrossDeletions(projectPath, pair.key);
    }

    const existingItemsByKey = new Map<string, CrossResultItem>();
    if (isFilteredRun && existsSync(resultsPath)) {
      const existing = await loadCrossResultsRaw(projectPath, config, pair.key);
      for (const item of existing.items) {
        const itemKey = item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport);
        existingItemsByKey.set(itemKey, { ...item, itemKey });
      }
    }

    let pairItemIndex = 0;
    emitProgress({
      phase: 'running',
      pairKey: pair.key,
      pairTitle: pair.title,
      pairIndex: pairIndex + 1,
      pairTotal,
      itemIndex: 0,
      itemTotal: itemTotalPerPair,
      progress: completedItems,
      total: totalPlannedItems,
    });

    const itemCtx: CompareCrossItemCtx = {
      projectPath,
      outputDir,
      diffDir,
      config,
      quickMode,
      enginesConfig,
    };

    for (const scenario of scenariosToRun) {
      for (const viewport of viewportsToRun) {
        const itemKey = buildCrossItemKey(scenario.name, viewport.name);
        if (itemKeyFilter && !itemKeyFilter.has(itemKey)) {
          continue;
        }

        const item = await compareCrossItem(pair, scenario, viewport, itemKey, itemCtx);
        items.push(item);
        updatedItemKeys.push(itemKey);
        if (isFilteredRun) {
          existingItemsByKey.set(itemKey, item);
        }
        pairItemIndex += 1;
        completedItems += 1;
        emitProgress({
          phase: 'running',
          pairKey: pair.key,
          pairTitle: pair.title,
          pairIndex: pairIndex + 1,
          pairTotal,
          itemIndex: pairItemIndex,
          itemTotal: itemTotalPerPair,
          progress: completedItems,
          total: totalPlannedItems,
        });
      }
    }

    if (isFilteredRun && items.length === 0) {
      throw new Error('No cross-compare items matched the provided filters.');
    }

    if (options.resetAcceptances && updatedItemKeys.length > 0) {
      await clearCrossAcceptancesForItems(projectPath, config, pair.key, updatedItemKeys);
      if (isFilteredRun) {
        for (const itemKey of updatedItemKeys) {
          const existing = existingItemsByKey.get(itemKey);
          if (!existing) continue;
          const { accepted: _accepted, acceptedAt: _acceptedAt, ...rest } = existing;
          existingItemsByKey.set(itemKey, rest);
        }
      }
    }

    if (isFilteredRun && updatedItemKeys.length > 0) {
      await clearCrossDeletionsForItems(projectPath, pair.key, updatedItemKeys);
    }

    let finalItems = items;
    if (isFilteredRun) {
      const orderedKeys = new Set<string>();
      const orderedItems: CrossResultItem[] = [];
      for (const scenario of config.scenarios) {
        for (const viewport of config.viewports) {
          const itemKey = buildCrossItemKey(scenario.name, viewport.name);
          const item = existingItemsByKey.get(itemKey);
          if (item) {
            orderedItems.push(item);
            orderedKeys.add(itemKey);
          }
        }
      }
      for (const [itemKey, item] of existingItemsByKey.entries()) {
        if (!orderedKeys.has(itemKey)) {
          orderedItems.push(item);
        }
      }
      finalItems = orderedItems;
    }

    finalItems = finalItems.map((item) => withSmartPassMetadata(item));

    const reportResults: ComparisonResult[] = finalItems.map((item) =>
      toComparisonResult(item, projectPath)
    );

    await generateReport(
      {
        title: pair.title,
        timestamp: new Date().toISOString(),
        results: reportResults,
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
      items: finalItems,
    };
    await saveJsonFile(resultsPath, crossResults);

    reports.push({
      key: pair.key,
      title: pair.title,
      reportPath,
      url: `/api/projects/${projectId}/cross-reports/${pair.key}`,
    });
  }

  emitProgress({
    phase: 'done',
    pairIndex: pairTotal,
    pairTotal,
    itemIndex: itemTotalPerPair,
    itemTotal: itemTotalPerPair,
    progress: completedItems,
    total: totalPlannedItems,
  });

  return reports;
}

export async function loadCrossReport(
  projectPath: string,
  config: VRTConfig,
  key: string
): Promise<string> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const reportPath = resolve(outputDir, 'cross-reports', key, 'report.html');
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) {
    if (!existsSync(reportPath)) {
      throw new Error(`Cross report not found: ${reportPath}`);
    }
    return readFile(reportPath, 'utf-8');
  }

  const crossResults = await loadCrossResults(projectPath, config, key);
  const results: ComparisonResult[] = crossResults.items.map((item) =>
    toComparisonResult(item, projectPath)
  );

  await generateReport(
    {
      title: crossResults.title,
      timestamp: crossResults.generatedAt,
      results,
      baselineDir: outputDir,
      outputDir,
    },
    { outputPath: reportPath, embedImages: config.report?.embedImages }
  );

  return readFile(reportPath, 'utf-8');
}

export async function loadCrossResults(
  projectPath: string,
  config: VRTConfig,
  key: string
): Promise<CrossResults> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`Cross results not found: ${resultsPath}`);
  }
  const data = await readFile(resultsPath, 'utf-8');
  let results: CrossResults;
  try {
    results = JSON.parse(data) as CrossResults;
  } catch {
    throw new Error(`Invalid JSON in cross results: ${resultsPath}`);
  }
  const acceptances = await loadCrossAcceptances(projectPath);
  const pairAcceptances = acceptances[key] || {};
  const flags = await loadCrossFlags(projectPath);
  const pairFlags = flags[key] || {};
  const deletions = await loadCrossDeletions(projectPath);
  const pairDeletions = deletions[key] || {};

  results.items = results.items.map((item) => {
    const itemKey = item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport);
    const acceptanceRecord = pairAcceptances[itemKey];
    const flagRecord = pairFlags[itemKey];
    const enriched: CrossResultItem = {
      ...item,
      itemKey,
      accepted: !!acceptanceRecord,
      acceptedAt: acceptanceRecord?.acceptedAt,
      flagged: !!flagRecord,
      flaggedAt: flagRecord?.flaggedAt,
    };
    return withSmartPassMetadata(enriched);
  });

  results.items = results.items.filter(
    (item) => !pairDeletions[item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport)]
  );

  const generatedAtMs = Date.parse(results.generatedAt) || 0;
  results.items = await enrichItemsWithMtimes(results.items, projectPath, generatedAtMs);

  return results;
}

export async function listCrossResults(
  projectPath: string,
  config: VRTConfig
): Promise<CrossResultsSummary[]> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const configuredPairs = buildCrossComparePairs(config.browsers);
  const root = resolve(outputDir, 'cross-reports');
  const summariesByKey = new Map<string, CrossResultsSummary>();
  const acceptances = await loadCrossAcceptances(projectPath);
  const flags = await loadCrossFlags(projectPath);
  const deletions = await loadCrossDeletions(projectPath);

  if (existsSync(root)) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const resultsPath = resolve(root, entry.name, 'results.json');
      if (!existsSync(resultsPath)) continue;
      try {
        const data = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
        const key = data.key ?? entry.name;
        const summary = summarizeCrossItems(
          data.items,
          acceptances[key],
          flags[key],
          deletions[key]
        );
        summariesByKey.set(key, {
          key,
          title: data.title,
          generatedAt: data.generatedAt,
          baselineLabel: data.baselineLabel,
          testLabel: data.testLabel,
          ...summary,
        });
      } catch (err) {
        log.warn(`Unreadable cross results at ${resultsPath}: ${getErrorMessage(err)}`);
      }
    }
  }

  const summaries: CrossResultsSummary[] = configuredPairs.map((pair) => {
    const existing = summariesByKey.get(pair.key);
    if (existing) return existing;
    return {
      key: pair.key,
      title: pair.title,
      generatedAt: '',
      baselineLabel: formatBrowser(pair.baseline),
      testLabel: formatBrowser(pair.test),
      itemCount: 0,
      approvedCount: 0,
      smartPassCount: 0,
      matchCount: 0,
      diffCount: 0,
      issueCount: 0,
      flaggedCount: 0,
      outdatedCount: 0,
    };
  });

  for (const [key, summary] of summariesByKey.entries()) {
    if (!configuredPairs.some((pair) => pair.key === key)) {
      summaries.push(summary);
    }
  }

  return summaries.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
}

export async function setCrossAcceptance(
  projectPath: string,
  key: string,
  itemKey: string,
  reason?: string,
  config?: VRTConfig
): Promise<CrossAcceptanceRecord> {
  const store = await loadCrossAcceptances(projectPath);
  if (!store[key]) store[key] = {};
  const record: CrossAcceptanceRecord = { acceptedAt: new Date().toISOString(), reason };
  store[key][itemKey] = record;
  await saveCrossAcceptances(projectPath, store);
  if (config) {
    await updateCrossResultsAcceptance(projectPath, config, key, itemKey, record);
  }
  return record;
}

export async function revokeCrossAcceptance(
  projectPath: string,
  key: string,
  itemKey: string,
  config?: VRTConfig
): Promise<boolean> {
  const store = await loadCrossAcceptances(projectPath);
  const next = removeEntryFromPair(store, key, itemKey);
  if (!next.removed) return false;

  await saveCrossAcceptances(projectPath, next.store as CrossAcceptanceStore);
  if (config) {
    await updateCrossResultsAcceptance(projectPath, config, key, itemKey);
  }
  return true;
}

export async function setCrossFlag(
  projectPath: string,
  key: string,
  itemKey: string,
  reason?: string,
  config?: VRTConfig
): Promise<CrossFlagRecord> {
  const store = await loadCrossFlags(projectPath);
  if (!store[key]) store[key] = {};
  const record: CrossFlagRecord = { flaggedAt: new Date().toISOString(), reason };
  store[key][itemKey] = record;
  await saveCrossFlags(projectPath, store);
  if (config) {
    await updateCrossResultsFlag(projectPath, config, key, itemKey, record);
  }
  return record;
}

export async function revokeCrossFlag(
  projectPath: string,
  key: string,
  itemKey: string,
  config?: VRTConfig
): Promise<boolean> {
  const store = await loadCrossFlags(projectPath);
  const next = removeEntryFromPair(store, key, itemKey);
  if (!next.removed) return false;

  await saveCrossFlags(projectPath, next.store as CrossFlagStore);
  if (config) {
    await updateCrossResultsFlag(projectPath, config, key, itemKey);
  }
  return true;
}

async function loadCrossResultsRaw(
  projectPath: string,
  config: VRTConfig,
  key: string
): Promise<CrossResults> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`Cross results not found: ${resultsPath}`);
  }
  const data = await readFile(resultsPath, 'utf-8');
  try {
    return JSON.parse(data) as CrossResults;
  } catch {
    throw new Error(`Invalid JSON in cross results: ${resultsPath}`);
  }
}

/**
 * Patch a single item inside a pair's `results.json` and persist if changed.
 * Common shell behind acceptance/flag/AI-result update flows: load, locate
 * the item by `itemKey`, hand it to `mutate` for a targeted edit, atomically
 * save. Missing files are tolerated (no-op); invalid JSON is logged and
 * swallowed to match prior behavior.
 */
async function patchCrossResultsItem(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKey: string,
  mutate: (item: CrossResultItem, resolvedKey: string) => CrossResultItem
): Promise<void> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) return;

  try {
    const data = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
    let changed = false;

    data.items = data.items.map((item) => {
      const resolvedKey = item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport);
      if (resolvedKey !== itemKey) return item;
      changed = true;
      return mutate(item, resolvedKey);
    });

    if (changed) {
      await saveJsonFile(resultsPath, data);
    }
  } catch (err) {
    log.warn(`Invalid results.json at ${resultsPath}: ${getErrorMessage(err)}`);
  }
}

/**
 * Remove a single (pairKey, itemKey) entry from a two-level store. Returns
 * the new store and whether anything was actually removed. Drops the pair
 * key entirely when its inner record becomes empty so listings don't show
 * stale pair stubs.
 */
function removeEntryFromPair<T>(
  store: Record<string, Record<string, T>>,
  pairKey: string,
  itemKey: string
): { store: Record<string, Record<string, T>>; removed: boolean } {
  const pair = store[pairKey];
  if (!pair || !pair[itemKey]) return { store, removed: false };

  const { [itemKey]: _removed, ...remaining } = pair;
  if (Object.keys(remaining).length === 0) {
    const { [pairKey]: _pair, ...rest } = store;
    return { store: rest, removed: true };
  }
  return { store: { ...store, [pairKey]: remaining }, removed: true };
}

/**
 * Bulk variant of `removeEntryFromPair` used during cross-item deletion:
 * filter out every itemKey in `removeKeys` and drop the pair if empty.
 */
function removeEntriesFromPair<T>(
  store: Record<string, Record<string, T>>,
  pairKey: string,
  removeKeys: Set<string>
): { store: Record<string, Record<string, T>>; changed: boolean } {
  const pair = store[pairKey] ?? {};
  const remaining = Object.fromEntries(Object.entries(pair).filter(([k]) => !removeKeys.has(k)));
  if (Object.keys(remaining).length === Object.keys(pair).length) {
    return { store, changed: false };
  }
  if (Object.keys(remaining).length === 0) {
    const { [pairKey]: _removed, ...rest } = store;
    return { store: rest, changed: true };
  }
  return { store: { ...store, [pairKey]: remaining }, changed: true };
}

async function updateCrossResultsAcceptance(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKey: string,
  record?: CrossAcceptanceRecord
): Promise<void> {
  await patchCrossResultsItem(projectPath, config, key, itemKey, (item, resolvedKey) => {
    if (record) {
      return { ...item, itemKey: resolvedKey, accepted: true, acceptedAt: record.acceptedAt };
    }
    const { accepted: _accepted, acceptedAt: _acceptedAt, ...rest } = item;
    return { ...rest, itemKey: resolvedKey };
  });
}

async function updateCrossResultsFlag(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKey: string,
  record?: CrossFlagRecord
): Promise<void> {
  await patchCrossResultsItem(projectPath, config, key, itemKey, (item, resolvedKey) => {
    if (record) {
      return { ...item, itemKey: resolvedKey, flagged: true, flaggedAt: record.flaggedAt };
    }
    const { flagged: _flagged, flaggedAt: _flaggedAt, ...rest } = item;
    return { ...rest, itemKey: resolvedKey };
  });
}

export async function deleteCrossItems(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKeys: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  const deletions = await loadCrossDeletions(projectPath);
  if (!deletions[key]) deletions[key] = {};

  const crossResults = await loadCrossResultsRaw(projectPath, config, key);
  const itemMap = new Map(
    crossResults.items.map((item) => [
      item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport),
      item,
    ])
  );

  const deleted: string[] = [];
  const missing: string[] = [];

  for (const itemKey of itemKeys) {
    const item = itemMap.get(itemKey);
    if (!item) {
      missing.push(itemKey);
      continue;
    }

    deletions[key][itemKey] = { deletedAt: new Date().toISOString() };
    deleted.push(itemKey);

    if (item.diff) {
      const diffPath = resolve(projectPath, item.diff);
      if (existsSync(diffPath)) {
        await rm(diffPath, { force: true });
      }
    }
  }

  await saveCrossDeletions(projectPath, deletions);

  if (deleted.length > 0) {
    const deletedSet = new Set(deleted);

    const acceptances = await loadCrossAcceptances(projectPath);
    const nextAcceptances = removeEntriesFromPair(acceptances, key, deletedSet);
    if (nextAcceptances.changed) {
      await saveCrossAcceptances(projectPath, nextAcceptances.store as CrossAcceptanceStore);
    }

    const flags = await loadCrossFlags(projectPath);
    const nextFlags = removeEntriesFromPair(flags, key, deletedSet);
    if (nextFlags.changed) {
      await saveCrossFlags(projectPath, nextFlags.store as CrossFlagStore);
    }
  }

  return { deleted, missing };
}

export async function clearCrossResults(
  projectPath: string,
  config: VRTConfig,
  key: string
): Promise<void> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const reportDir = resolve(outputDir, 'cross-reports', key);
  const diffDir = resolve(outputDir, 'cross-diffs', key);

  if (existsSync(reportDir)) {
    await rm(reportDir, { recursive: true, force: true });
  }

  if (existsSync(diffDir)) {
    await rm(diffDir, { recursive: true, force: true });
  }

  const store = await loadCrossAcceptances(projectPath);
  if (store[key]) {
    const { [key]: _removed, ...rest } = store;
    await saveCrossAcceptances(projectPath, rest);
  }

  const flags = await loadCrossFlags(projectPath);
  if (flags[key]) {
    const { [key]: _removed, ...rest } = flags;
    await saveCrossFlags(projectPath, rest);
  }

  await clearCrossDeletions(projectPath, key);
}

export async function saveCrossItemAIResults(
  projectPath: string,
  config: VRTConfig,
  key: string,
  updates: Map<string, AIAnalysisResult>
): Promise<void> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) return;

  try {
    const data = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
    let changed = false;

    data.items = data.items.map((item) => {
      const itemKey = item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport);
      const analysis = updates.get(itemKey);
      if (!analysis) return item;
      changed = true;
      const updated: CrossResultItem = { ...item, itemKey, aiAnalysis: analysis };
      return withSmartPassMetadata(updated);
    });

    if (changed) {
      await saveJsonFile(resultsPath, data);
    }
  } catch (err) {
    log.warn(`Invalid results.json at ${resultsPath}: ${getErrorMessage(err)}`);
  }
}
