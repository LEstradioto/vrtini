import { mkdir, readFile, writeFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import type { VRTConfig } from '../../../src/core/config.js';
import { normalizeBrowserConfig } from '../../../src/core/browser-versions.js';
import { getProjectDirs, getScreenshotFilename } from '../../../src/core/paths.js';
import { compareImages } from '../../../src/core/compare.js';
import type { ComparisonResult } from '../../../src/core/types.js';
import { getDiffPath } from '../../../src/core/types.js';
import { buildEnginesConfig } from '../../../src/core/compare-runner.js';
import { generateReport } from '../../../src/report.js';
import type { PerceptualHashResult } from '../../../src/phash.js';

interface BrowserRef {
  name: 'chromium' | 'webkit';
  version?: string;
}

function formatBrowser(ref: BrowserRef): string {
  return ref.version ? `${ref.name}-v${ref.version}` : ref.name;
}

function findLatestAndOld(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[],
  name: 'chromium' | 'webkit'
): { latest: BrowserRef; old: BrowserRef } {
  let latest: BrowserRef | null = null;
  let old: BrowserRef | null = null;

  for (const browser of browsers) {
    const normalized = normalizeBrowserConfig(browser);
    if (normalized.name !== name) continue;
    if (normalized.version) {
      if (!old) old = normalized;
    } else {
      latest = normalized;
    }
  }

  if (!latest || !old) {
    throw new Error(`Missing latest and/or old ${name} in config browsers`);
  }

  return { latest, old };
}

function tryFindLatestAndOld(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[],
  name: 'chromium' | 'webkit'
): { latest: BrowserRef; old: BrowserRef } | null {
  try {
    return findLatestAndOld(browsers, name);
  } catch {
    return null;
  }
}

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
  match: boolean;
  reason: ComparisonResult['reason'];
  diffPercentage: number;
  pixelDiff: number;
  ssimScore?: number;
  phash?: PerceptualHashResult;
  error?: string;
  accepted?: boolean;
  acceptedAt?: string;
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
}

export interface CrossCompareRunOptions {
  key?: string;
  itemKeys?: string[];
  scenarios?: string[];
  viewports?: string[];
  resetAcceptances?: boolean;
}

interface CrossAcceptanceRecord {
  acceptedAt: string;
  reason?: string;
}

type CrossAcceptanceStore = Record<string, Record<string, CrossAcceptanceRecord>>;
type CrossDeletionStore = Record<string, Record<string, { deletedAt: string }>>;

function getCrossAcceptancesPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'cross.json');
}

function getCrossDeletionsPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'cross-deleted.json');
}

async function loadCrossAcceptances(projectPath: string): Promise<CrossAcceptanceStore> {
  const path = getCrossAcceptancesPath(projectPath);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as CrossAcceptanceStore;
  } catch {
    return {};
  }
}

async function saveCrossAcceptances(
  projectPath: string,
  data: CrossAcceptanceStore
): Promise<void> {
  const path = getCrossAcceptancesPath(projectPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function loadCrossDeletions(projectPath: string): Promise<CrossDeletionStore> {
  const path = getCrossDeletionsPath(projectPath);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as CrossDeletionStore;
  } catch {
    return {};
  }
}

async function saveCrossDeletions(projectPath: string, data: CrossDeletionStore): Promise<void> {
  const path = getCrossDeletionsPath(projectPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function clearCrossDeletions(projectPath: string, key: string): Promise<void> {
  const deletions = await loadCrossDeletions(projectPath);
  if (!deletions[key]) return;
  const { [key]: _removed, ...rest } = deletions;
  await saveCrossDeletions(projectPath, rest);
}

async function clearCrossDeletionsForItems(
  projectPath: string,
  key: string,
  itemKeys: string[]
): Promise<void> {
  if (itemKeys.length === 0) return;
  const deletions = await loadCrossDeletions(projectPath);
  const pairDeletions = deletions[key];
  if (!pairDeletions) return;

  const itemKeySet = new Set(itemKeys);
  const nextEntries = Object.entries(pairDeletions).filter(([itemKey]) => !itemKeySet.has(itemKey));

  if (nextEntries.length === Object.keys(pairDeletions).length) {
    return;
  }

  if (nextEntries.length === 0) {
    const { [key]: _removed, ...rest } = deletions;
    await saveCrossDeletions(projectPath, rest);
    return;
  }

  await saveCrossDeletions(projectPath, {
    ...deletions,
    [key]: Object.fromEntries(nextEntries),
  });
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

function buildItemKey(scenario: string, viewport: string): string {
  return `${scenario}__${viewport}`;
}

function toComparisonResult(item: CrossResultItem, projectPath: string): ComparisonResult {
  const baseline = resolve(projectPath, item.baseline);
  const test = resolve(projectPath, item.test);
  const approved = item.accepted ?? false;
  const diffPath = item.diff ? resolve(projectPath, item.diff) : undefined;
  const base = { baseline, test, approved };

  switch (item.reason) {
    case 'match':
      return {
        ...base,
        reason: 'match',
        match: true,
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        phash: item.phash,
        diffPath,
      };
    case 'diff':
      if (!diffPath) {
        return {
          ...base,
          reason: 'error',
          match: false,
          pixelDiff: 0,
          diffPercentage: 0,
          error: 'Missing diff image',
        };
      }
      return {
        ...base,
        reason: 'diff',
        match: false,
        diffPath,
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        phash: item.phash,
      };
    case 'no-baseline':
      return {
        ...base,
        reason: 'no-baseline',
        match: false,
        pixelDiff: 0,
        diffPercentage: 0,
      };
    case 'no-test':
      return {
        ...base,
        reason: 'no-test',
        match: false,
        pixelDiff: 0,
        diffPercentage: 0,
      };
    case 'error':
      return {
        ...base,
        reason: 'error',
        match: false,
        pixelDiff: 0,
        diffPercentage: 0,
        error: item.error ?? 'Unknown error',
        ssimScore: item.ssimScore,
        phash: item.phash,
      };
  }
}

function summarizeCrossItems(
  items: CrossResultItem[],
  acceptances: Record<string, CrossAcceptanceRecord> | undefined,
  deletions: Record<string, { deletedAt: string }> | undefined
): Pick<
  CrossResultsSummary,
  'itemCount' | 'approvedCount' | 'smartPassCount' | 'matchCount' | 'diffCount' | 'issueCount'
> {
  const summary = {
    itemCount: 0,
    approvedCount: 0,
    smartPassCount: 0,
    matchCount: 0,
    diffCount: 0,
    issueCount: 0,
  };

  for (const item of items) {
    const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
    if (deletions?.[itemKey]) continue;

    summary.itemCount += 1;

    const accepted = !!acceptances?.[itemKey];
    if (accepted) {
      summary.approvedCount += 1;
      continue;
    }

    const smartPass = item.match && item.diffPercentage > 0;
    if (item.match) {
      if (smartPass) summary.smartPassCount += 1;
      else summary.matchCount += 1;
      continue;
    }

    if (item.reason === 'diff') summary.diffCount += 1;
    else summary.issueCount += 1;
  }

  return summary;
}

export async function runCrossCompare(
  projectId: string,
  projectPath: string,
  config: VRTConfig,
  options: CrossCompareRunOptions = {}
): Promise<CrossReport[]> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const chromiumPair = tryFindLatestAndOld(config.browsers, 'chromium');
  const webkitPair = tryFindLatestAndOld(config.browsers, 'webkit');

  const pairs = [];

  if (chromiumPair) {
    pairs.push({
      key: `${formatBrowser(chromiumPair.latest)}_vs_${formatBrowser(chromiumPair.old)}`,
      title: `Cross Compare: ${formatBrowser(chromiumPair.latest)} vs ${formatBrowser(
        chromiumPair.old
      )}`,
      baseline: chromiumPair.latest,
      test: chromiumPair.old,
    });
  }

  if (chromiumPair && webkitPair) {
    pairs.push({
      key: `${formatBrowser(chromiumPair.latest)}_vs_${formatBrowser(webkitPair.latest)}`,
      title: `Cross Compare: ${formatBrowser(chromiumPair.latest)} vs ${formatBrowser(
        webkitPair.latest
      )}`,
      baseline: chromiumPair.latest,
      test: webkitPair.latest,
    });
    pairs.push({
      key: `${formatBrowser(chromiumPair.latest)}_vs_${formatBrowser(webkitPair.old)}`,
      title: `Cross Compare: ${formatBrowser(chromiumPair.latest)} vs ${formatBrowser(
        webkitPair.old
      )}`,
      baseline: chromiumPair.latest,
      test: webkitPair.old,
    });
  }

  if (webkitPair) {
    pairs.push({
      key: `${formatBrowser(webkitPair.latest)}_vs_${formatBrowser(webkitPair.old)}`,
      title: `Cross Compare: ${formatBrowser(webkitPair.latest)} vs ${formatBrowser(
        webkitPair.old
      )}`,
      baseline: webkitPair.latest,
      test: webkitPair.old,
    });
  }

  if (pairs.length === 0) {
    throw new Error('Cross compare requires at least one latest+old browser pair');
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

  const reports: CrossReport[] = [];

  for (const pair of selectedPairs) {
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
        const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
        existingItemsByKey.set(itemKey, { ...item, itemKey });
      }
    }

    for (const scenario of scenariosToRun) {
      for (const viewport of viewportsToRun) {
        const itemKey = buildItemKey(scenario.name, viewport.name);
        if (itemKeyFilter && !itemKeyFilter.has(itemKey)) {
          continue;
        }
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
        const diffPath = resolve(diffDir, diffName);

        const result = await compareImages(baselinePath, testPath, diffPath, {
          threshold: config.threshold,
          diffColor: config.diffColor,
          computePHash: !quickMode,
          engines: enginesConfig,
          keepDiffOnMatch: true,
          sizeNormalization: config.crossCompare?.normalization,
          sizeMismatchHandling: config.crossCompare?.mismatch,
          antialiasing: config.engines?.pixelmatch?.antialiasing,
          maxDiffPercentage:
            scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage,
          maxDiffPixels:
            scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
        });

        const diffPathValue = getDiffPath(result);
        const item: CrossResultItem = {
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
          phash: 'phash' in result ? result.phash : undefined,
          error: result.reason === 'error' ? result.error : undefined,
        };

        items.push(item);
        updatedItemKeys.push(itemKey);
        if (isFilteredRun) {
          existingItemsByKey.set(itemKey, item);
        }
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
          const itemKey = buildItemKey(scenario.name, viewport.name);
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
    await writeFile(resultsPath, JSON.stringify(crossResults, null, 2));

    reports.push({
      key: pair.key,
      title: pair.title,
      reportPath,
      url: `/api/projects/${projectId}/cross-reports/${pair.key}`,
    });
  }

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
  const results = JSON.parse(data) as CrossResults;
  const acceptances = await loadCrossAcceptances(projectPath);
  const pairAcceptances = acceptances[key] || {};
  const deletions = await loadCrossDeletions(projectPath);
  const pairDeletions = deletions[key] || {};

  results.items = results.items.map((item) => {
    const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
    const record = pairAcceptances[itemKey];
    return {
      ...item,
      itemKey,
      accepted: !!record,
      acceptedAt: record?.acceptedAt,
    };
  });

  results.items = results.items.filter(
    (item) => !pairDeletions[item.itemKey ?? buildItemKey(item.scenario, item.viewport)]
  );

  return results;
}

export async function listCrossResults(
  projectPath: string,
  config: VRTConfig
): Promise<CrossResultsSummary[]> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const root = resolve(outputDir, 'cross-reports');
  if (!existsSync(root)) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const summaries: CrossResultsSummary[] = [];
  const acceptances = await loadCrossAcceptances(projectPath);
  const deletions = await loadCrossDeletions(projectPath);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const resultsPath = resolve(root, entry.name, 'results.json');
    if (!existsSync(resultsPath)) continue;
    try {
      const data = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
      const key = data.key ?? entry.name;
      const summary = summarizeCrossItems(data.items, acceptances[key], deletions[key]);
      summaries.push({
        key,
        title: data.title,
        generatedAt: data.generatedAt,
        baselineLabel: data.baselineLabel,
        testLabel: data.testLabel,
        ...summary,
      });
    } catch {
      // ignore unreadable results
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
  const pair = store[key];
  if (!pair || !pair[itemKey]) return false;

  const { [itemKey]: _removed, ...remaining } = pair;
  let nextStore: CrossAcceptanceStore = { ...store, [key]: remaining };

  if (Object.keys(remaining).length === 0) {
    const { [key]: _pair, ...rest } = nextStore;
    nextStore = rest;
  }

  await saveCrossAcceptances(projectPath, nextStore);
  if (config) {
    await updateCrossResultsAcceptance(projectPath, config, key, itemKey);
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
  return JSON.parse(data) as CrossResults;
}

async function updateCrossResultsAcceptance(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKey: string,
  record?: CrossAcceptanceRecord
): Promise<void> {
  const { outputDir } = getProjectDirs(projectPath, config);
  const resultsPath = resolve(outputDir, 'cross-reports', key, 'results.json');
  if (!existsSync(resultsPath)) return;

  try {
    const data = JSON.parse(await readFile(resultsPath, 'utf-8')) as CrossResults;
    let changed = false;

    data.items = data.items.map((item) => {
      const resolvedKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
      if (resolvedKey !== itemKey) return item;
      changed = true;

      if (record) {
        return {
          ...item,
          itemKey: resolvedKey,
          accepted: true,
          acceptedAt: record.acceptedAt,
        };
      }

      const { accepted: _accepted, acceptedAt: _acceptedAt, ...rest } = item;
      return { ...rest, itemKey: resolvedKey };
    });

    if (changed) {
      await writeFile(resultsPath, JSON.stringify(data, null, 2));
    }
  } catch {
    // ignore invalid results.json
  }
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
      item.itemKey ?? buildItemKey(item.scenario, item.viewport),
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
    const acceptances = await loadCrossAcceptances(projectPath);
    const pair = acceptances[key] || {};
    const deletedSet = new Set(deleted);
    const remaining = Object.fromEntries(
      Object.entries(pair).filter(([itemKey]) => !deletedSet.has(itemKey))
    );
    const changed = Object.keys(remaining).length !== Object.keys(pair).length;
    if (changed) {
      if (Object.keys(remaining).length === 0) {
        const { [key]: _removed, ...rest } = acceptances;
        await saveCrossAcceptances(projectPath, rest);
      } else {
        await saveCrossAcceptances(projectPath, { ...acceptances, [key]: remaining });
      }
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

  await clearCrossDeletions(projectPath, key);
}
