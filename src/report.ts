/**
 * VRT HTML report generator.
 * Assembles the report template and handles I/O (reading images, writing report file).
 */

import { readFile, writeFile, mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import type { ComparisonResult } from './types/index.js';
import { getDiffPath } from './types/index.js';
import {
  calculateStats,
  sortResults,
  escapeHtml,
  buildResultCardHtml,
  buildSummaryHtml,
  buildFilterBarHtml,
  type ResultImages,
} from './domain/report-builder.js';
import { reportStyles } from './domain/report-styles.js';
import { reportScripts } from './domain/report-scripts.js';

export interface ReportData {
  title: string;
  timestamp: string;
  results: ComparisonResult[];
  baselineDir: string;
  outputDir: string;
  aiEnabled?: boolean;
}

export interface ReportOptions {
  outputPath: string;
  embedImages?: boolean;
}

async function resolveImageSource(imagePath: string, embedImages: boolean): Promise<string | null> {
  if (!existsSync(imagePath)) {
    return null;
  }
  if (!embedImages) {
    return imagePath;
  }
  const buffer = await readFile(imagePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export async function generateReport(data: ReportData, options: ReportOptions): Promise<string> {
  const { embedImages = true } = options;

  const stats = calculateStats(data.results);
  const sortedResults = sortResults(data.results);

  let resultsHtml = '';

  for (const result of sortedResults) {
    const diffPath = getDiffPath(result);
    const images: ResultImages = {
      baseline: await resolveImageSource(result.baseline, embedImages),
      test: await resolveImageSource(result.test, embedImages),
      diff: diffPath ? await resolveImageSource(diffPath, embedImages) : null,
    };

    const name = basename(result.test, '.png');
    resultsHtml += buildResultCardHtml(result, images, name);
  }

  const html = buildReportHtml(data, stats, resultsHtml);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, html);

  return options.outputPath;
}

function buildReportHtml(
  data: ReportData,
  stats: ReturnType<typeof calculateStats>,
  resultsHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>${reportStyles}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(data.title)}</h1>
    <div class="meta">Generated: ${escapeHtml(data.timestamp)}</div>
  </div>
  ${buildSummaryHtml(stats)}
  ${buildFilterBarHtml(stats)}
  <div class="results">
    ${resultsHtml}
  </div>

  <div class="overlay" id="overlay">
    <div class="overlay-header">
      <div class="overlay-title" id="overlay-title"></div>
      <div class="overlay-controls">
        <div class="overlay-tabs">
          <button class="overlay-tab" data-action="overlay-tab" data-idx="0">Baseline <kbd>1</kbd></button>
          <button class="overlay-tab" data-action="overlay-tab" data-idx="1">Diff <kbd>2</kbd></button>
          <button class="overlay-tab" data-action="overlay-tab" data-idx="2">Test <kbd>3</kbd></button>
        </div>
        <div class="opacity-controls" id="opacity-controls">
          <label>Diff:</label>
          <input type="range" id="opacity-slider" min="0" max="100" value="70" />
          <span id="opacity-value">70%</span>
        </div>
        <div class="zoom-controls">
          <button class="zoom-btn" data-action="zoom-out">-</button>
          <span class="zoom-level" id="zoom-level">100%</span>
          <button class="zoom-btn" data-action="zoom-in">+</button>
          <button class="zoom-btn" data-action="zoom-reset">Fit</button>
        </div>
      </div>
      <button class="overlay-close" data-action="overlay-close">Close <kbd>Esc</kbd></button>
    </div>
    <div class="overlay-content" id="overlay-content">
      <div class="img-wrapper">
        <div class="img-stack">
          <img id="overlay-img" src="" alt="" />
          <img id="overlay-img-top" src="" alt="" class="img-top" />
        </div>
      </div>
    </div>
    <div class="overlay-hint">
      <kbd>Drag</kbd> Pan <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Views <kbd>&larr;</kbd><kbd>&rarr;</kbd> Prev/Next <kbd>Ctrl+Scroll</kbd>/<kbd>+</kbd><kbd>-</kbd> Zoom <kbd>0</kbd> Fit <kbd>Esc</kbd> Close
    </div>
  </div>

  <script>${reportScripts}</script>
</body>
</html>`;
}

export async function approveResult(testPath: string, baselineDir: string): Promise<void> {
  if (!existsSync(testPath)) {
    throw new Error(`Test file not found: ${testPath}`);
  }

  const filename = basename(testPath);
  const baselinePath = resolve(baselineDir, filename);

  await mkdir(dirname(baselinePath), { recursive: true });
  await cp(testPath, baselinePath);
}
