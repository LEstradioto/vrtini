import type { Command } from 'commander';
import { mkdir, readdir, writeFile } from 'fs/promises';
import { loadConfig } from '../config.js';
import { runScreenshotTasks } from '../docker.js';
import { compareImages } from '../compare.js';
import type { ComparisonResult } from '../types/index.js';
import { isDiff } from '../types/index.js';
import { generateReport } from '../report.js';
import { analyzeWithAI, type AIProvider } from '../ai-analysis.js';
import { calculateConfidence } from '../confidence.js';
import { getProjectDirs, getReportPath, getImageMetadataPath } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';
import { openInBrowser } from './utils.js';
import { buildEnginesConfig, buildComparisonMatrix } from '../core/compare-runner.js';
import { runWithConcurrency } from '../core/async.js';
import {
  buildImageMetadataIndex,
  IMAGE_METADATA_SCHEMA_VERSION,
  type ImageMetadata,
} from '../core/image-metadata.js';

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
      if (result.phash) {
        parts.push(`pHash: ${(result.phash.similarity * 100).toFixed(0)}%`);
      }
      if (result.aiAnalysis) {
        parts.push(`AI: ${result.aiAnalysis.category}`);
      }
      return { status: '✗', info: parts.join(' | ') };
    }
  }
}

async function listImages(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith('.png'));
  } catch {
    return [];
  }
}

async function writeImageMetadataFile(
  dir: string,
  metadataIndex: Record<string, ImageMetadata>
): Promise<void> {
  const files = await listImages(dir);
  const images: Record<string, ImageMetadata> = {};

  for (const filename of files) {
    const metadata = metadataIndex[filename];
    if (metadata) {
      images[filename] = metadata;
    }
  }

  const payload = {
    schemaVersion: IMAGE_METADATA_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    images,
  };

  await writeFile(getImageMetadataPath(dir), JSON.stringify(payload, null, 2));
}

async function persistImageMetadata(
  config: Awaited<ReturnType<typeof loadConfig>>,
  scenarios: Awaited<ReturnType<typeof loadConfig>>['scenarios'],
  dirs: { outputDir: string; baselineDir: string; diffDir: string }
): Promise<void> {
  const metadataIndex = buildImageMetadataIndex(config, scenarios);
  await Promise.all([
    writeImageMetadataFile(dirs.outputDir, metadataIndex),
    writeImageMetadataFile(dirs.diffDir, metadataIndex),
    writeImageMetadataFile(dirs.baselineDir, metadataIndex),
  ]);
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
          console.log('\n📸 Capturing screenshots...\n');
          const results = await runScreenshotTasks({
            config,
            scenarios: options.scenario,
          });

          const failed = results.filter((r) => !r.success);
          if (failed.length > 0) {
            console.error('\nSome screenshots failed:');
            failed.forEach((f) => {
              console.error(`  - ${f.task.scenario.name}: ${f.error}`);
            });
          }
        }

        console.log('\n🔍 Comparing screenshots...\n');

        const scenarios = options.scenario
          ? config.scenarios.filter((s) => options.scenario.includes(s.name))
          : config.scenarios;

        const compareConcurrency = config.concurrency ?? 5;
        const quickMode = options.quick || config.quickMode;

        const aiEnabled =
          options.ai === true || options.aiAll === true
            ? true
            : options.ai === false
              ? false
              : (config.ai?.enabled ?? false);

        const aiAnalyzeAll = options.aiAll === true;

        const aiConfig = config.ai;
        const aiThreshold = aiConfig?.analyzeThreshold ?? {
          maxPHashSimilarity: 0.95,
          maxSSIM: 0.98,
          minPixelDiff: 0.1,
        };

        const comparisonTasks = buildComparisonMatrix(
          outputDir,
          baselineDir,
          diffDir,
          scenarios,
          config
        );

        const comparisons = await runWithConcurrency(
          comparisonTasks,
          compareConcurrency,
          async (task): Promise<ComparisonResult> => {
            const { scenario, browser, viewport, testPath, baselinePath, diffPath } = task;
            const enginesConfig = buildEnginesConfig(quickMode, config.engines);

            let result: ComparisonResult = await compareImages(baselinePath, testPath, diffPath, {
              threshold: config.threshold,
              diffColor: config.diffColor,
              computePHash: !quickMode,
              engines: enginesConfig,
              antialiasing: config.engines?.pixelmatch?.antialiasing,
              keepDiffOnMatch: config.keepDiffOnMatch,
              maxDiffPercentage:
                scenario.diffThreshold?.maxDiffPercentage ??
                config.diffThreshold?.maxDiffPercentage,
              maxDiffPixels:
                scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
            });

            // Only process diff results for AI analysis and confidence scoring
            if (isDiff(result)) {
              const needsAIAnalysis =
                aiEnabled &&
                (aiAnalyzeAll ||
                  ((result.phash?.similarity ?? 0) < aiThreshold.maxPHashSimilarity &&
                    (result.ssimScore ?? 0) < aiThreshold.maxSSIM &&
                    result.diffPercentage >= aiThreshold.minPixelDiff));

              if (needsAIAnalysis) {
                try {
                  console.log(`  🤖 Analyzing ${scenario.name} / ${browser} / ${viewport.name}...`);
                  const aiResult = await analyzeWithAI(baselinePath, testPath, result.diffPath, {
                    provider: (aiConfig?.provider ?? 'anthropic') as AIProvider,
                    apiKey: aiConfig?.apiKey,
                    model: aiConfig?.model,
                    scenarioName: scenario.name,
                    url: scenario.url,
                    pixelDiff: result.pixelDiff,
                    diffPercentage: result.diffPercentage,
                    ssimScore: result.ssimScore,
                  });
                  result = { ...result, aiAnalysis: aiResult };
                } catch (err) {
                  console.log(`  ⚠ AI analysis failed: ${getErrorMessage(err)}`);
                }
              }

              const confidence = calculateConfidence({
                ssimScore: result.ssimScore,
                phashSimilarity: result.phash?.similarity,
                pixelDiffPercent: result.diffPercentage,
                aiAnalysis: result.aiAnalysis,
              });
              result = { ...result, confidence };
            }

            const { status, info } = buildStatusInfo(result);

            console.log(`  ${status} ${scenario.name} / ${browser} / ${viewport.name}: ${info}`);
            return result;
          }
        );

        console.log('\n📊 Generating report...\n');

        await persistImageMetadata(config, scenarios, { outputDir, baselineDir, diffDir });

        const reportPath = getReportPath(cwd, config);
        await generateReport(
          {
            title: 'vrtini Report',
            timestamp: new Date().toISOString(),
            results: comparisons,
            baselineDir,
            outputDir,
            aiEnabled,
          },
          { outputPath: reportPath, embedImages: config.report?.embedImages }
        );

        console.log(`Report saved: ${reportPath}`);

        if (options.open) {
          openInBrowser(reportPath);
        }

        const passed = comparisons.filter((r) => r.match).length;
        const failed = comparisons.filter((r) => r.reason === 'diff').length;
        const newCount = comparisons.filter((r) => r.reason === 'no-baseline').length;
        const aiAnalyzed = comparisons.filter((r) => isDiff(r) && r.aiAnalysis).length;

        console.log('\n📋 Summary:');
        console.log(`  ✓ ${passed} passed`);
        console.log(`  ✗ ${failed} failed`);
        console.log(`  ○ ${newCount} new`);

        if (aiAnalyzed > 0) {
          console.log(`  🤖 ${aiAnalyzed} AI analyzed`);
        }

        if (failed > 0) {
          process.exit(1);
        }
      } catch (err) {
        console.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
