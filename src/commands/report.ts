import type { Command } from 'commander';
import { loadConfig } from '../core/config.js';
import { compareImages } from '../compare.js';
import type { ComparisonResult } from '../types/index.js';
import { generateReport } from '../report.js';
import { getProjectDirs, getReportPath } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';
import { openInBrowser } from './utils.js';
import { buildCompareOptions, buildComparisonMatrix } from '../core/compare-runner.js';
import { loadAcceptances } from '../core/acceptance-store.js';
import { computeAutoThresholdCaps } from '../domain/auto-threshold.js';

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Regenerate HTML report from existing screenshots')
    .option('-c, --config <path>', 'Path to config file')
    .option('-o, --open', 'Open report in browser')
    .action(async (options) => {
      try {
        const config = await loadConfig(options.config);
        const cwd = process.cwd();
        const { outputDir, baselineDir, diffDir } = getProjectDirs(cwd, config);

        const quickMode = config.quickMode ?? false;
        const autoThresholdCaps = config.autoThresholds?.enabled
          ? computeAutoThresholdCaps(await loadAcceptances(cwd), {
              percentile: config.autoThresholds.percentile,
              minSampleSize: config.autoThresholds.minSampleSize,
            })
          : null;

        const tasks = buildComparisonMatrix(
          outputDir,
          baselineDir,
          diffDir,
          config.scenarios,
          config
        );

        const comparisons: ComparisonResult[] = [];
        for (const task of tasks) {
          const result = await compareImages(
            task.baselinePath,
            task.testPath,
            task.diffPath,
            buildCompareOptions(config, task.scenario, task.viewport, task, {
              quickMode,
              autoThresholdCaps,
            })
          );
          comparisons.push(result);
        }

        const reportPath = getReportPath(cwd, config);
        await generateReport(
          {
            title: 'vrtini Report',
            timestamp: new Date().toISOString(),
            results: comparisons,
            baselineDir,
            outputDir,
          },
          { outputPath: reportPath, embedImages: config.report?.embedImages }
        );

        log.info(`Report saved: ${reportPath}`);

        if (options.open) {
          openInBrowser(reportPath);
        }
      } catch (err) {
        log.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
