import { mkdir, readFile, writeFile, readdir, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import type { VRTConfig } from '../../../src/core/config.js';
import { normalizeBrowserConfig } from '../../../src/core/browser-versions.js';
import {
  getProjectDirs,
  getScreenshotFilename,
  getSnapshotFilename,
} from '../../../src/core/paths.js';
import { compareImages } from '../../../src/core/compare.js';
import { formatBrowser, type BrowserRef, type ComparisonResult } from '../../../src/core/types.js';
import { getDiffPath } from '../../../src/core/types.js';
import { buildEnginesConfig } from '../../../src/core/compare-runner.js';
import { generateReport } from '../../../src/report.js';
import type { PerceptualHashResult } from '../../../src/phash.js';
import type { AIAnalysisResult } from '../../../src/domain/ai-prompt.js';
import type { DomDiffResult } from '../../../src/engines/dom-diff.js';
import { calculateConfidence } from '../../../src/confidence.js';
import { classifyFindings, classificationToCategory } from '../../../src/domain/classification.js';

function buildCrossComparePairs(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[]
): { key: string; title: string; baseline: BrowserRef; test: BrowserRef }[] {
  const all = browsers.map(normalizeBrowserConfig);
  const pairs: { key: string; title: string; baseline: BrowserRef; test: BrowserRef }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];

      // Skip identical entries (same name and version)
      if (a.name === b.name && a.version === b.version) continue;

      // Baseline preference: unversioned (latest) over versioned (old)
      let baseline = a;
      let test = b;
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

  return pairs;
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

interface CrossAcceptanceRecord {
  acceptedAt: string;
  reason?: string;
}

interface CrossFlagRecord {
  flaggedAt: string;
  reason?: string;
}

type CrossAcceptanceStore = Record<string, Record<string, CrossAcceptanceRecord>>;
type CrossDeletionStore = Record<string, Record<string, { deletedAt: string }>>;
type CrossFlagStore = Record<string, Record<string, CrossFlagRecord>>;

function getCrossAcceptancesPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'cross.json');
}

function getCrossDeletionsPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'cross-deleted.json');
}

function getCrossFlagsPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'cross-flags.json');
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

async function loadCrossFlags(projectPath: string): Promise<CrossFlagStore> {
  const path = getCrossFlagsPath(projectPath);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as CrossFlagStore;
  } catch {
    return {};
  }
}

async function saveCrossFlags(projectPath: string, data: CrossFlagStore): Promise<void> {
  const path = getCrossFlagsPath(projectPath);
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

interface CrossSmartPassEvaluation {
  smartPass: boolean;
  reason: string;
}

function evaluateCrossSmartPass(item: CrossResultItem): CrossSmartPassEvaluation {
  if (item.reason !== 'match' && item.reason !== 'diff') {
    return { smartPass: false, reason: 'Item is not a match/diff comparison result.' };
  }
  if (item.diffPercentage <= 0) {
    return {
      smartPass: false,
      reason: 'Diff percentage is zero; Smart Pass only applies to non-zero deltas.',
    };
  }

  let domCategory:
    | 'cosmetic'
    | 'noise'
    | 'content_change'
    | 'layout_shift'
    | 'regression'
    | undefined;
  if (item.domDiff) {
    const classification = classifyFindings(item.domDiff);
    domCategory = classificationToCategory(classification);
  }

  const confidence = calculateConfidence({
    ssimScore: item.ssimScore,
    phashSimilarity: item.phash?.similarity,
    pixelDiffPercent: item.diffPercentage,
    aiAnalysis: item.aiAnalysis,
    domCategory,
    domSummary: item.domDiff?.summary,
  });

  if (confidence.verdict === 'pass' || confidence.verdict === 'likely-pass') {
    return {
      smartPass: true,
      reason: `Confidence ${confidence.verdict} (${(confidence.score * 100).toFixed(1)}%). ${confidence.explanation || 'Signals are within Smart Pass confidence band.'}`,
    };
  }

  // Fallback for cross-browser rendering drift:
  // if no textual/structural DOM changes are detected and perceptual hash remains high,
  // classify as Smart Pass candidate even when pixel/SSIM are noisy.
  const summary = item.domDiff?.summary;
  const hasTextOrStructuralChange =
    (summary?.text_changed ?? 0) > 0 ||
    (summary?.element_added ?? 0) > 0 ||
    (summary?.element_removed ?? 0) > 0;
  const layoutShiftCount = summary?.layout_shift ?? 0;
  const phashSimilarity = item.phash?.similarity ?? 0;
  const rejectedByAI = item.aiAnalysis?.recommendation === 'reject';

  if (
    !rejectedByAI &&
    !hasTextOrStructuralChange &&
    phashSimilarity >= 0.93 &&
    item.diffPercentage <= 18 &&
    layoutShiftCount <= 450
  ) {
    return {
      smartPass: true,
      reason: `Cross-browser heuristic: no DOM text/structural additions-removals, pHash ${(phashSimilarity * 100).toFixed(1)}%, diff ${item.diffPercentage.toFixed(2)}%, layout shifts ${layoutShiftCount}.`,
    };
  }

  if (rejectedByAI) {
    return { smartPass: false, reason: 'AI recommendation is reject, so Smart Pass is blocked.' };
  }
  if (hasTextOrStructuralChange) {
    return { smartPass: false, reason: 'DOM text/structure changed, so Smart Pass is blocked.' };
  }
  return {
    smartPass: false,
    reason: `Confidence ${confidence.verdict} (${(confidence.score * 100).toFixed(1)}) below Smart Pass gate.`,
  };
}

function withSmartPassMetadata(item: CrossResultItem): CrossResultItem {
  const evaluation = evaluateCrossSmartPass(item);
  return { ...item, smartPass: evaluation.smartPass, smartPassReason: evaluation.reason };
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
  flags: Record<string, CrossFlagRecord> | undefined,
  deletions: Record<string, { deletedAt: string }> | undefined
): Pick<
  CrossResultsSummary,
  | 'itemCount'
  | 'approvedCount'
  | 'smartPassCount'
  | 'matchCount'
  | 'diffCount'
  | 'issueCount'
  | 'flaggedCount'
> {
  const summary = {
    itemCount: 0,
    approvedCount: 0,
    smartPassCount: 0,
    matchCount: 0,
    diffCount: 0,
    issueCount: 0,
    flaggedCount: 0,
  };

  for (const item of items) {
    const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
    if (deletions?.[itemKey]) continue;

    summary.itemCount += 1;
    if (flags?.[itemKey]) {
      summary.flaggedCount += 1;
    }

    const accepted = !!acceptances?.[itemKey];
    if (accepted) {
      summary.approvedCount += 1;
      continue;
    }

    const smartPass = item.smartPass ?? evaluateCrossSmartPass(item).smartPass;
    if (smartPass) {
      summary.smartPassCount += 1;
      continue;
    }
    if (item.match) {
      summary.matchCount += 1;
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
  options: CrossCompareRunOptions = {},
  onProgress?: (update: CrossCompareProgressUpdate) => void
): Promise<CrossReport[]> {
  const { outputDir } = getProjectDirs(projectPath, config);
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
      const itemKey = buildItemKey(scenario.name, viewport.name);
      if (itemKeyFilter && !itemKeyFilter.has(itemKey)) continue;
      acc += 1;
    }
    return acc;
  }, 0);
  const totalPlannedItems = pairTotal * itemTotalPerPair;

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
        const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
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

    for (const scenario of scenariosToRun) {
      for (const viewport of viewportsToRun) {
        const itemKey = buildItemKey(scenario.name, viewport.name);
        if (itemKeyFilter && !itemKeyFilter.has(itemKey)) {
          continue;
        }
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
          antialiasing: config.engines?.pixelmatch?.antialiasing,
          maxDiffPercentage:
            scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage,
          maxDiffPixels:
            scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
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
        const item: CrossResultItem = withSmartPassMetadata(itemBase);

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
    await writeFile(resultsPath, JSON.stringify(crossResults, null, 2));

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
    const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
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
    (item) => !pairDeletions[item.itemKey ?? buildItemKey(item.scenario, item.viewport)]
  );

  async function getMtimeIso(relativePath: string | undefined): Promise<string | undefined> {
    if (!relativePath) return undefined;
    try {
      const s = await stat(resolve(projectPath, relativePath));
      return s.mtime.toISOString();
    } catch {
      return undefined;
    }
  }

  const generatedAtMs = Date.parse(results.generatedAt) || 0;

  results.items = await Promise.all(
    results.items.map(async (item) => {
      const baselineUpdatedAt = await getMtimeIso(item.baseline);
      const testUpdatedAt = await getMtimeIso(item.test);
      const diffUpdatedAt = await getMtimeIso(item.diff);

      // Item is outdated if any source screenshot was modified after the comparison ran
      const latestMtime = Math.max(
        baselineUpdatedAt ? Date.parse(baselineUpdatedAt) || 0 : 0,
        testUpdatedAt ? Date.parse(testUpdatedAt) || 0 : 0
      );
      const outdated = generatedAtMs > 0 && latestMtime > generatedAtMs;

      return withSmartPassMetadata({
        ...item,
        baselineUpdatedAt,
        testUpdatedAt,
        diffUpdatedAt,
        outdated,
      });
    })
  );

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
      } catch {
        // ignore unreadable results
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
  const pair = store[key];
  if (!pair || !pair[itemKey]) return false;

  const { [itemKey]: _removed, ...remaining } = pair;
  let nextStore: CrossFlagStore = { ...store, [key]: remaining };

  if (Object.keys(remaining).length === 0) {
    const { [key]: _pair, ...rest } = nextStore;
    nextStore = rest;
  }

  await saveCrossFlags(projectPath, nextStore);
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

async function updateCrossResultsFlag(
  projectPath: string,
  config: VRTConfig,
  key: string,
  itemKey: string,
  record?: CrossFlagRecord
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
          flagged: true,
          flaggedAt: record.flaggedAt,
        };
      }

      const { flagged: _flagged, flaggedAt: _flaggedAt, ...rest } = item;
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

    const flags = await loadCrossFlags(projectPath);
    const pairFlags = flags[key] || {};
    const deletedFlagsSet = new Set(deleted);
    const remainingFlags = Object.fromEntries(
      Object.entries(pairFlags).filter(([itemKey]) => !deletedFlagsSet.has(itemKey))
    );
    const flagsChanged = Object.keys(remainingFlags).length !== Object.keys(pairFlags).length;
    if (flagsChanged) {
      if (Object.keys(remainingFlags).length === 0) {
        const { [key]: _removed, ...rest } = flags;
        await saveCrossFlags(projectPath, rest);
      } else {
        await saveCrossFlags(projectPath, { ...flags, [key]: remainingFlags });
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
      const itemKey = item.itemKey ?? buildItemKey(item.scenario, item.viewport);
      const analysis = updates.get(itemKey);
      if (!analysis) return item;
      changed = true;
      const updated: CrossResultItem = { ...item, itemKey, aiAnalysis: analysis };
      return withSmartPassMetadata(updated);
    });

    if (changed) {
      await writeFile(resultsPath, JSON.stringify(data, null, 2));
    }
  } catch {
    // ignore invalid results.json
  }
}
