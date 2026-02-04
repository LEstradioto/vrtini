import type { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { normalizeBrowserConfig } from '../browser-versions.js';
import { compareImages } from '../compare.js';
import type { ComparisonResult } from '../types/index.js';
import { generateReport } from '../report.js';
import { getProjectDirs, getScreenshotFilename, getReportPath } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';
import { openInBrowser } from './utils.js';

function buildComparisonPaths(
  outputDir: string,
  baselineDir: string,
  diffDir: string,
  filename: string
) {
  return {
    testPath: resolve(outputDir, filename),
    baselinePath: resolve(baselineDir, filename),
    diffPath: resolve(diffDir, filename),
  };
}

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

        const comparisons: ComparisonResult[] = [];

        for (const scenario of config.scenarios) {
          for (const browserConfig of config.browsers) {
            const { name: browser, version } = normalizeBrowserConfig(browserConfig);
            for (const viewport of config.viewports) {
              const filename = getScreenshotFilename(
                scenario.name,
                browser,
                viewport.name,
                version
              );
              const { testPath, baselinePath, diffPath } = buildComparisonPaths(
                outputDir,
                baselineDir,
                diffDir,
                filename
              );

              const result = await compareImages(baselinePath, testPath, diffPath, {
                threshold: config.threshold,
                diffColor: config.diffColor,
                antialiasing: config.engines?.pixelmatch?.antialiasing,
                keepDiffOnMatch: config.keepDiffOnMatch,
                maxDiffPercentage:
                  scenario.diffThreshold?.maxDiffPercentage ??
                  config.diffThreshold?.maxDiffPercentage,
                maxDiffPixels:
                  scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels,
              });

              comparisons.push(result);
            }
          }
        }

        const reportPath = getReportPath(cwd, config);
        await generateReport(
          {
            title: 'VRT Report',
            timestamp: new Date().toISOString(),
            results: comparisons,
            baselineDir,
            outputDir,
          },
          { outputPath: reportPath, embedImages: config.report?.embedImages }
        );

        console.log(`Report saved: ${reportPath}`);

        if (options.open) {
          openInBrowser(reportPath);
        }
      } catch (err) {
        console.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
