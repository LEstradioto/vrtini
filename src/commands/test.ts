import type { Command } from 'commander';
import { mkdir } from 'fs/promises';
import { loadConfig } from '../core/config.js';
import { runScreenshotTasks } from '../docker.js';
import { compareImages } from '../compare.js';
import type { ComparisonResult } from '../types/index.js';
import { isDiff } from '../types/index.js';
import { generateReport } from '../report.js';
import { analyzeWithAI, type AIProvider } from '../ai-analysis.js';
import { calculateConfidence } from '../confidence.js';
import { getProjectDirs, getReportPath } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';
import { openInBrowser } from './utils.js';
import {
  buildCompareOptions,
  buildComparisonMatrix,
  type ComparisonTask,
} from '../core/compare-runner.js';
import { runWithConcurrency } from '../core/async.js';
import { persistImageMetadata } from '../core/image-metadata.js';
import { loadAcceptances } from '../core/acceptance-store.js';
import type { VRTConfig } from '../core/config.js';
import { classifyFindings, classificationToCategory } from '../domain/classification.js';
import type { DomDiffContext } from '../domain/ai-prompt.js';
import { computeAutoThresholdCaps, type AutoThresholdCaps } from '../domain/auto-threshold.js';

function buildStatusInfo(result: ComparisonResult): { status: string; info: string } {
  switch (result.reason) {
    case 'match':
      return { status: '✓', info: 'passed' };
    case 'no-baseline':
      return { status: '○', info: 'new' };
    case 'no-test':
      return { status: '!', info: 'no test image' };
    case 'error':
      return { status: '!', info: result.error };
    case 'diff': {
      const parts: string[] = [`${result.diffPercentage.toFixed(2)}% diff`];
      if (result.ssimScore !== undefined) {
        parts.push(`SSIM: ${(result.ssimScore * 100).toFixed(1)}%`);
      }
      if (result.phash) {
        parts.push(`pHash: ${(result.phash.similarity * 100).toFixed(0)}%`);
      }
      if (result.engineResults) {
        const errored = result.engineResults.filter((e) => e.error);
        if (errored.length > 0) {
          parts.push(`⚠ ${errored.map((e) => e.engine).join(', ')} failed`);
        }
      }
      if (result.confidence) {
        parts.push(
          `conf: ${(result.confidence.score * 100).toFixed(0)}% [${result.confidence.verdict}]`
        );
      }
      if (result.aiAnalysis) {
        parts.push(`AI: ${result.aiAnalysis.category}`);
      }
      return { status: '✗', info: parts.join(' | ') };
    }
  }
}

interface AISettings {
  enabled: boolean;
  analyzeAll: boolean;
  manualOnly: boolean;
  threshold: { maxPHashSimilarity: number; maxSSIM: number; minPixelDiff: number };
  config: VRTConfig['ai'];
}

function resolveAISettings(
  options: { ai?: boolean; aiAll?: boolean },
  config: VRTConfig
): AISettings {
  const enabled =
    options.ai === true || options.aiAll === true
      ? true
      : options.ai === false
        ? false
        : (config.ai?.enabled ?? false);

  return {
    enabled,
    analyzeAll: options.aiAll === true,
    manualOnly: config.ai?.manualOnly ?? false,
    threshold: config.ai?.analyzeThreshold ?? {
      maxPHashSimilarity: 0.95,
      maxSSIM: 0.98,
      minPixelDiff: 0.1,
    },
    config: config.ai,
  };
}

async function captureScreenshots(config: VRTConfig, scenarioFilter?: string[]): Promise<void> {
  log.info('\n📸 Capturing screenshots...\n');
  const results = await runScreenshotTasks({ config, scenarios: scenarioFilter });

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    log.error('\nSome screenshots failed:');
    failed.forEach((f) => {
      log.error(`  - ${f.task.scenario.name}: ${f.error}`);
    });
  }
}

async function loadAutoThresholdCaps(
  projectPath: string,
  config: VRTConfig
): Promise<AutoThresholdCaps | null> {
  if (!config.autoThresholds?.enabled) return null;
  const acceptances = await loadAcceptances(projectPath);
  return computeAutoThresholdCaps(acceptances, {
    percentile: config.autoThresholds.percentile,
    minSampleSize: config.autoThresholds.minSampleSize,
  });
}

async function compareTask(
  task: ComparisonTask,
  config: VRTConfig,
  quickMode: boolean,
  ai: AISettings,
  autoThresholdCaps: AutoThresholdCaps | null
): Promise<ComparisonResult> {
  const { scenario, browser, viewport, testPath, baselinePath, diffPath } = task;
  const compareOptions = buildCompareOptions(config, scenario, viewport, task, {
    quickMode,
    autoThresholdCaps,
  });

  let result: ComparisonResult = await compareImages(
    baselinePath,
    testPath,
    diffPath,
    compareOptions
  );

  if (isDiff(result)) {
    result = await enrichDiffResult(result, task, ai);
  }

  const { status, info } = buildStatusInfo(result);
  log.info(`  ${status} ${scenario.name} / ${browser} / ${viewport.name}: ${info}`);
  return result;
}

async function enrichDiffResult(
  result: ComparisonResult & { reason: 'diff' },
  task: ComparisonTask,
  ai: AISettings
): Promise<ComparisonResult> {
  let enriched = result;
  const { scenario, browser, viewport } = task;

  // Compute DOM classification if DOM diff is present
  let domDiffContext: DomDiffContext | undefined;
  let domCategory: ReturnType<typeof classificationToCategory> | undefined;
  if (result.domDiff) {
    const classification = classifyFindings(result.domDiff);
    domCategory = classificationToCategory(classification);
    const topFindings = result.domDiff.findings.slice(0, 5).map((f) => f.description);
    domDiffContext = {
      findingCounts: result.domDiff.summary,
      topFindings,
    };
  }

  const needsAI =
    ai.enabled &&
    (ai.analyzeAll ||
      (!ai.manualOnly &&
        (result.phash?.similarity ?? 0) < ai.threshold.maxPHashSimilarity &&
        (result.ssimScore ?? 0) < ai.threshold.maxSSIM &&
        result.diffPercentage >= ai.threshold.minPixelDiff));

  if (needsAI) {
    try {
      log.info(`  🤖 Analyzing ${scenario.name} / ${browser} / ${viewport.name}...`);
      const aiResult = await analyzeWithAI(task.baselinePath, task.testPath, result.diffPath, {
        provider: (ai.config?.provider ?? 'anthropic') as AIProvider,
        apiKey: ai.config?.apiKey,
        authToken: ai.config?.authToken,
        model: ai.config?.model,
        baseUrl: ai.config?.baseUrl,
        visionCompare: ai.config?.visionCompare,
        scenarioName: scenario.name,
        url: scenario.url,
        pixelDiff: result.pixelDiff,
        diffPercentage: result.diffPercentage,
        ssimScore: result.ssimScore,
        domDiff: domDiffContext,
      });
      enriched = { ...enriched, aiAnalysis: aiResult };
    } catch (err) {
      log.warn(`  ⚠ AI analysis failed: ${getErrorMessage(err)}`);
    }
  }

  const confidence = calculateConfidence({
    ssimScore: enriched.ssimScore,
    phashSimilarity: enriched.phash?.similarity,
    pixelDiffPercent: enriched.diffPercentage,
    aiAnalysis: isDiff(enriched) ? enriched.aiAnalysis : undefined,
    domCategory,
    domSummary: enriched.domDiff?.summary,
  });
  return { ...enriched, confidence };
}

function collectEngineStatus(comparisons: ComparisonResult[]): {
  ran: Set<string>;
  errored: Map<string, number>;
} {
  const ran = new Set<string>();
  const errored = new Map<string, number>();

  for (const r of comparisons) {
    if (!isDiff(r) || !r.engineResults) continue;
    for (const er of r.engineResults) {
      ran.add(er.engine);
      if (er.error) {
        errored.set(er.engine, (errored.get(er.engine) ?? 0) + 1);
      }
    }
  }
  return { ran, errored };
}

function printSummary(comparisons: ComparisonResult[], quickMode: boolean): void {
  const passed = comparisons.filter((r) => r.match).length;
  const failed = comparisons.filter((r) => r.reason === 'diff').length;
  const newCount = comparisons.filter((r) => r.reason === 'no-baseline').length;
  const aiAnalyzed = comparisons.filter((r) => isDiff(r) && r.aiAnalysis).length;

  log.info('\n📋 Summary:');
  log.info(`  ✓ ${passed} passed`);
  log.info(`  ✗ ${failed} failed`);
  log.info(`  ○ ${newCount} new`);

  if (aiAnalyzed > 0) {
    log.info(`  🤖 ${aiAnalyzed} AI analyzed`);
  }

  // Engine status
  const allEngines = ['pixelmatch', 'odiff', 'ssim', 'phash'] as const;
  const { ran, errored } = collectEngineStatus(comparisons);

  if (failed > 0 || ran.size > 0) {
    const engineStatus = allEngines.map((e) => {
      if (quickMode && e !== 'pixelmatch') return `${e}: skipped`;
      if (errored.has(e)) return `${e}: ⚠ ${errored.get(e)} errors`;
      if (ran.has(e)) return `${e}: ✓`;
      return `${e}: disabled`;
    });
    log.info(`\n  🔧 Engines: ${engineStatus.join(' | ')}`);
  }
}

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Run visual regression tests')
    .option('-c, --config <path>', 'Path to config file')
    .option('-s, --scenario <name...>', 'Run specific scenarios')
    .option('--skip-screenshots', 'Skip screenshot capture, only compare')
    .option('-q, --quick', 'Quick mode: fast comparison (pixelmatch only, skips SSIM/pHash)')
    .option('--ai', 'Enable AI analysis (overrides config)')
    .option('--no-ai', 'Disable AI analysis (overrides config)')
    .option('--ai-all', 'Analyze ALL diffs with AI (ignore thresholds)')
    .option('-o, --open', 'Open report in browser after tests')
    .action(async (options) => {
      try {
        const config = await loadConfig(options.config);
        const cwd = process.cwd();
        const { outputDir, baselineDir, diffDir } = getProjectDirs(cwd, config);

        await mkdir(outputDir, { recursive: true });
        await mkdir(baselineDir, { recursive: true });
        await mkdir(diffDir, { recursive: true });

        if (!options.skipScreenshots) {
          await captureScreenshots(config, options.scenario);
        }

        log.info('\n🔍 Comparing screenshots...\n');

        const scenarios = options.scenario
          ? config.scenarios.filter((s: { name: string }) => options.scenario.includes(s.name))
          : config.scenarios;

        const quickMode = options.quick || config.quickMode;
        if (quickMode) {
          log.warn(
            '⚠ Quick mode: only pixelmatch enabled (ssim, phash, odiff skipped). Confidence scores are limited.'
          );
        }
        const ai = resolveAISettings(options, config);
        const autoThresholdCaps = await loadAutoThresholdCaps(cwd, config);

        const comparisonTasks = buildComparisonMatrix(
          outputDir,
          baselineDir,
          diffDir,
          scenarios,
          config
        );
        const comparisons = await runWithConcurrency(
          comparisonTasks,
          config.concurrency ?? 5,
          (task) => compareTask(task, config, quickMode, ai, autoThresholdCaps)
        );

        log.info('\n📊 Generating report...\n');

        await persistImageMetadata(config, scenarios, { outputDir, baselineDir, diffDir });

        const reportPath = getReportPath(cwd, config);
        await generateReport(
          {
            title: 'vrtini Report',
            timestamp: new Date().toISOString(),
            results: comparisons,
            baselineDir,
            outputDir,
            aiEnabled: ai.enabled,
          },
          { outputPath: reportPath, embedImages: config.report?.embedImages }
        );

        log.info(`Report saved: ${reportPath}`);

        if (options.open) {
          openInBrowser(reportPath);
        }

        printSummary(comparisons, quickMode);

        if (comparisons.some((r) => r.reason === 'diff')) {
          process.exit(1);
        }
      } catch (err) {
        log.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
