/**
 * Pure report building functions (no I/O).
 */

import type { ComparisonResult } from '../types/index.js';
import { isDiff, getSsimScore, getResultError } from '../types/index.js';
import { classifyFindings } from './classification.js';

export interface ReportStats {
  passed: number;
  smartPass: number;
  failed: number;
  noBaseline: number;
  errors: number;
  approved: number;
  autoApproved: number;
  aiAnalyzed: number;
}

interface StatusMeta {
  className: string;
  text: string;
}

const STATUS_META: Record<ComparisonResult['reason'], StatusMeta> = {
  match: { className: 'passed', text: 'Passed' },
  diff: { className: 'failed', text: 'Failed' },
  'no-baseline': { className: 'new', text: 'New (no baseline)' },
  'no-test': { className: 'failed', text: 'Failed' },
  error: { className: 'error', text: 'Error' },
};

function getStatusMeta(result: ComparisonResult): StatusMeta {
  return STATUS_META[result.reason];
}

function isSmartPass(result: ComparisonResult): boolean {
  return result.reason === 'match' && result.diffPercentage > 0;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttribute(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

export function calculateStats(results: ComparisonResult[]): ReportStats {
  const stats: ReportStats = {
    passed: 0,
    smartPass: 0,
    failed: 0,
    noBaseline: 0,
    errors: 0,
    approved: 0,
    autoApproved: 0,
    aiAnalyzed: 0,
  };

  for (const result of results) {
    const smartPass = isSmartPass(result);
    if (result.approved) {
      stats.approved += 1;
    } else if (result.match) {
      stats.passed += 1;
      if (smartPass) stats.smartPass += 1;
    } else {
      if (result.reason === 'diff') stats.failed += 1;
      if (result.reason === 'no-baseline') stats.noBaseline += 1;
      if (result.reason === 'error') stats.errors += 1;
    }

    if (isDiff(result)) {
      if (result.autoAction === 'approve') stats.autoApproved += 1;
      if (result.aiAnalysis !== undefined) stats.aiAnalyzed += 1;
    }
  }

  return stats;
}

/**
 * Sort results: failed first (by SSIM ascending, then diff percentage descending), then passed.
 */
export function sortResults(results: ComparisonResult[]): ComparisonResult[] {
  return [...results].sort((a, b) => {
    if (a.match && !b.match) return 1;
    if (!a.match && b.match) return -1;
    if (!a.match && !b.match) {
      const ssimA = getSsimScore(a) ?? 1;
      const ssimB = getSsimScore(b) ?? 1;
      if (ssimA !== ssimB) return ssimA - ssimB;
      return (b.diffPercentage || 0) - (a.diffPercentage || 0);
    }
    return 0;
  });
}

export function getStatusClass(result: ComparisonResult): string {
  return getStatusMeta(result).className;
}

export function getStatusText(result: ComparisonResult): string {
  if (!result.approved && isSmartPass(result)) return 'Smart Pass';
  return getStatusMeta(result).text;
}

export function getCategoryClass(category: string): string {
  if (category === 'regression') return 'category-regression';
  if (category === 'cosmetic' || category === 'noise') return 'category-cosmetic';
  return 'category-change';
}

export function getSeverityClass(severity: string): string {
  if (severity === 'critical') return 'severity-critical';
  if (severity === 'warning') return 'severity-warning';
  return 'severity-info';
}

export function getRecommendClass(recommendation: string): string {
  if (recommendation === 'approve') return 'recommend-approve';
  if (recommendation === 'reject') return 'recommend-reject';
  return 'recommend-review';
}

export function getVerdictClass(verdict: string): string {
  if (verdict === 'pass' || verdict === 'likely-pass') return 'verdict-pass';
  if (verdict === 'fail' || verdict === 'likely-fail') return 'verdict-fail';
  return 'verdict-review';
}

export function getDiffStatsClass(diffPercentage: number): string {
  if (diffPercentage > 5) return 'diff-high';
  if (diffPercentage > 1) return 'diff-medium';
  return 'diff-low';
}

export function getSsimClass(ssimScore: number): string {
  if (ssimScore >= 0.95) return 'ssim-good';
  if (ssimScore >= 0.8) return 'ssim-warn';
  return 'ssim-bad';
}

export function getPhashClass(similarity: number): string {
  if (similarity >= 0.95) return 'phash-good';
  if (similarity >= 0.85) return 'phash-warn';
  return 'phash-bad';
}

export function getAutoActionClass(action: string): string {
  if (action === 'approve') return 'auto-approve';
  if (action === 'reject') return 'auto-reject';
  return 'auto-flag';
}

export interface ResultImages {
  baseline: string | null;
  test: string | null;
  diff: string | null;
}

function buildDiffStatsSection(result: ComparisonResult, resultError?: string): string {
  if (!isDiff(result) || resultError) return '';
  return `<span class="diff-stats ${getDiffStatsClass(result.diffPercentage)}">
        <strong>${result.diffPercentage.toFixed(2)}%</strong> diff (${result.pixelDiff.toLocaleString()} px)
       </span>`;
}

function buildSsimSection(ssim?: number): string {
  if (ssim === undefined) return '';
  return `<span class="ssim-score ${getSsimClass(ssim)}">
        SSIM: <strong>${(ssim * 100).toFixed(1)}%</strong>
       </span>`;
}

function buildErrorSection(resultError?: string): string {
  if (!resultError) return '';
  return `<span class="observation">${escapeHtml(resultError)}</span>`;
}

function buildApproveButton(result: ComparisonResult): string {
  if (result.match || result.approved) return '';
  return `<button class="approve-btn" data-action="approve">Approve</button>`;
}

function buildImageContainer(options: {
  label: 'Baseline' | 'Diff' | 'Test';
  type: 'baseline' | 'diff' | 'test';
  image: string | null;
  index: number;
  emptyText: string;
}): string {
  const { label, type, image, index, emptyText } = options;
  const imageHtml = image
    ? `<img src="${image}" alt="${label}" data-type="${type}" />`
    : `<div class="no-image">${emptyText}</div>`;

  return `
        <div class="image-container" data-action="open-compare" data-idx="${index}">
          <h4>${label}</h4>
          ${imageHtml}
        </div>
      `;
}

export function buildAiSection(result: ComparisonResult): string {
  if (!isDiff(result) || !result.aiAnalysis) return '';

  const ai = result.aiAnalysis;
  const categoryClass = getCategoryClass(ai.category);
  const severityClass = getSeverityClass(ai.severity);
  const recommendClass = getRecommendClass(ai.recommendation);

  return `
    <div class="ai-analysis">
      <div class="ai-header">
        <span class="ai-badge">AI Analysis</span>
        <span class="ai-category ${categoryClass}">${escapeHtml(ai.category)}</span>
        <span class="ai-severity ${severityClass}">${escapeHtml(ai.severity)}</span>
        <span class="ai-confidence">${(ai.confidence * 100).toFixed(0)}% confident</span>
        <span class="ai-recommendation ${recommendClass}">${escapeHtml(ai.recommendation)}</span>
      </div>
      <p class="ai-summary">${escapeHtml(ai.summary)}</p>
      <details class="ai-details">
        <summary>Details</summary>
        <ul>
          ${ai.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}
        </ul>
        <p class="ai-reasoning"><strong>Reasoning:</strong> ${escapeHtml(ai.reasoning)}</p>
      </details>
    </div>
  `;
}

export function buildConfidenceSection(result: ComparisonResult): string {
  if (!isDiff(result) || !result.confidence) return '';

  const conf = result.confidence;
  const verdictClass = getVerdictClass(conf.verdict);

  return `
    <div class="confidence-score">
      <span class="confidence-label">Confidence:</span>
      <span class="confidence-value ${verdictClass}">${(conf.score * 100).toFixed(0)}%</span>
      <span class="confidence-verdict ${verdictClass}">${escapeHtml(conf.verdict)}</span>
    </div>
  `;
}

export function buildPhashSection(result: ComparisonResult): string {
  if (!('phash' in result) || !result.phash) return '';

  const phash = result.phash;
  const phashClass = getPhashClass(phash.similarity);

  return `
    <span class="phash-score ${phashClass}">
      pHash: <strong>${(phash.similarity * 100).toFixed(0)}%</strong>
    </span>
  `;
}

export function buildAutoActionBadge(result: ComparisonResult): string {
  if (!isDiff(result) || !result.autoAction) return '';

  const actionClass = getAutoActionClass(result.autoAction);
  return `<span class="auto-action ${actionClass}">Auto: ${result.autoAction}</span>`;
}

export function buildDomInsightsSection(result: ComparisonResult): string {
  if (!isDiff(result) || !result.domDiff || result.domDiff.findings.length === 0) return '';

  const diff = result.domDiff;
  const classification = classifyFindings(diff);

  const badges = classification.classifications
    .map((c) => {
      const severityClass = getSeverityClass(c.maxSeverity);
      return `<span class="dom-badge ${severityClass}">${escapeHtml(c.changeClass)} (${c.findings.length})</span>`;
    })
    .join(' ');

  const topFindings = diff.findings
    .slice(0, 8)
    .map((f) => {
      const severityClass = getSeverityClass(f.severity);
      return `<li><span class="${severityClass}">[${f.severity}]</span> ${escapeHtml(f.description)}</li>`;
    })
    .join('');

  return `
    <details class="dom-insights">
      <summary>DOM Insights (${diff.findings.length} findings) ${badges}</summary>
      <ul class="dom-findings-list">
        ${topFindings}
      </ul>
      ${diff.findings.length > 8 ? `<p class="dom-more">...and ${diff.findings.length - 8} more findings</p>` : ''}
    </details>
  `;
}

export function buildResultCardHtml(
  result: ComparisonResult,
  images: ResultImages,
  name: string
): string {
  const smartPass = !result.approved && isSmartPass(result);
  const safeName = escapeHtml(name);
  const statusClass = getStatusClass(result);
  const statusText = getStatusText(result);
  const aiSection = buildAiSection(result);
  const domInsightsSection = buildDomInsightsSection(result);
  const confidenceSection = buildConfidenceSection(result);
  const phashSection = buildPhashSection(result);
  const autoActionBadge = buildAutoActionBadge(result);
  const approvedClass = result.approved ? ' approved' : '';

  const resultError = getResultError(result);
  const ssim = getSsimScore(result);
  const autoAction = isDiff(result) ? result.autoAction : undefined;

  const diffStats = buildDiffStatsSection(result, resultError);
  const ssimSection = buildSsimSection(ssim);
  const errorSection = buildErrorSection(resultError);
  const approveBtn = buildApproveButton(result);
  const nameAttr = escapeAttribute(name);

  return `
    <div class="result ${statusClass}${smartPass ? ' smart-pass' : ''}${autoAction === 'approve' ? ' auto-approved' : ''}${approvedClass}" data-name="${nameAttr}" data-test="${escapeAttribute(result.test)}" data-baseline="${escapeAttribute(result.baseline)}" data-auto-action="${escapeAttribute(autoAction || '')}">
      <div class="result-header">
        <h3>${safeName}</h3>
        <span class="status ${statusClass}${smartPass ? ' smart-pass' : ''}">${statusText}</span>
        ${autoActionBadge}
        ${errorSection}
        ${diffStats}
        ${ssimSection}
        ${phashSection}
        ${confidenceSection}
        ${approveBtn}
        <button class="compare-btn" data-action="compare">Compare</button>
      </div>
      ${aiSection}
      ${domInsightsSection}
      <div class="images">
        ${buildImageContainer({
          label: 'Baseline',
          type: 'baseline',
          image: images.baseline,
          index: 0,
          emptyText: 'No baseline',
        })}
        ${buildImageContainer({
          label: 'Diff',
          type: 'diff',
          image: images.diff,
          index: 1,
          emptyText: 'No diff',
        })}
        ${buildImageContainer({
          label: 'Test',
          type: 'test',
          image: images.test,
          index: 2,
          emptyText: 'No test image',
        })}
      </div>
    </div>
  `;
}

function buildSummaryItem(options: {
  label: string;
  count: number;
  className?: string;
  containerStyle?: string;
  countStyle?: string;
}): string {
  const { label, count, className, containerStyle, countStyle } = options;
  const classAttr = className ? ` summary-item ${className}` : 'summary-item';
  const containerStyleAttr = containerStyle ? ` style="${containerStyle}"` : '';
  const countStyleAttr = countStyle ? ` style="${countStyle}"` : '';

  return `
      <div class="${classAttr.trim()}"${containerStyleAttr}>
        <div class="count"${countStyleAttr}>${count}</div>
        <div class="label">${label}</div>
      </div>
    `;
}

export function buildSummaryHtml(stats: ReportStats): string {
  const smartPassSection =
    stats.smartPass > 0
      ? buildSummaryItem({
          label: 'Smart Pass',
          count: stats.smartPass,
          className: 'smart-pass',
        })
      : '';
  const approvedSection =
    stats.approved > 0
      ? buildSummaryItem({
          label: 'Approved',
          count: stats.approved,
          className: 'approved',
        })
      : '';
  const autoApprovedSection =
    stats.autoApproved > 0
      ? buildSummaryItem({
          label: 'Auto-Approved',
          count: stats.autoApproved,
          containerStyle: 'border-left: 2px solid #ddd; padding-left: 20px;',
          countStyle: 'color: #22c55e;',
        })
      : '';

  const aiAnalyzedSection =
    stats.aiAnalyzed > 0
      ? buildSummaryItem({
          label: 'AI Analyzed',
          count: stats.aiAnalyzed,
          countStyle: 'color: #0ea5e9;',
        })
      : '';

  return `
    <div class="summary">
      ${buildSummaryItem({ label: 'Passed', count: stats.passed, className: 'passed' })}
      ${smartPassSection}
      ${buildSummaryItem({ label: 'Failed', count: stats.failed, className: 'failed' })}
      ${buildSummaryItem({ label: 'New', count: stats.noBaseline, className: 'new' })}
      ${buildSummaryItem({ label: 'Errors', count: stats.errors, className: 'error' })}
      ${approvedSection}
      ${autoApprovedSection}
      ${aiAnalyzedSection}
    </div>
  `;
}

function buildFilterButton(filter: string, label: string, isActive = false): string {
  return `<button class="filter-btn${isActive ? ' active' : ''}" data-action="filter" data-filter="${filter}">${label}</button>`;
}

export function buildFilterBarHtml(stats: ReportStats): string {
  const approvedBtn = stats.approved > 0 ? buildFilterButton('approved', 'Approved') : '';
  const autoApprovedBtn =
    stats.autoApproved > 0 ? buildFilterButton('auto-approved', 'Auto-Approved') : '';
  const smartPassBtn = stats.smartPass > 0 ? buildFilterButton('smart-pass', 'Smart Pass') : '';

  const needsReviewBtn =
    stats.failed - stats.autoApproved > 0 ? buildFilterButton('needs-review', 'Needs Review') : '';

  return `
    <div class="filter-bar">
      ${buildFilterButton('all', 'All', true)}
      ${buildFilterButton('failed', 'Failed')}
      ${buildFilterButton('new', 'New')}
      ${buildFilterButton('passed', 'Passed')}
      ${smartPassBtn}
      ${approvedBtn}
      ${autoApprovedBtn}
      ${needsReviewBtn}
    </div>
  `;
}
