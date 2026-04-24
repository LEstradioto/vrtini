/**
 * Summarize a cross-compare pair's items into counts (matched / diffed /
 * approved / smart-passed / flagged / issue). Pure — no I/O.
 */

import type { ComparisonResult } from '../core/types.js';
import type { PerceptualHashResult } from '../phash.js';
import type { DomDiffResult } from '../engines/dom-diff.js';
import type { AIAnalysisResult } from './ai-prompt.js';
import { evaluateCrossSmartPass } from './smart-pass.js';

/**
 * Input item — mirrors the persisted CrossResultItem shape, but decoupled so
 * the domain module doesn't reach up into web/server types.
 */
export interface CrossSummaryItem {
  itemKey?: string;
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
  domDiff?: DomDiffResult;
  aiAnalysis?: AIAnalysisResult;
  smartPass?: boolean;
  error?: string;
}

export interface CrossSummaryCounts {
  itemCount: number;
  approvedCount: number;
  smartPassCount: number;
  matchCount: number;
  diffCount: number;
  issueCount: number;
  flaggedCount: number;
}

interface CrossAcceptanceRecord {
  acceptedAt: string;
  reason?: string;
}

interface CrossFlagRecord {
  flaggedAt: string;
  reason?: string;
}

export function buildCrossItemKey(scenario: string, viewport: string): string {
  return `${scenario}__${viewport}`;
}

export function summarizeCrossItems(
  items: CrossSummaryItem[],
  acceptances: Record<string, CrossAcceptanceRecord> | undefined,
  flags: Record<string, CrossFlagRecord> | undefined,
  deletions: Record<string, { deletedAt: string }> | undefined
): CrossSummaryCounts {
  const summary: CrossSummaryCounts = {
    itemCount: 0,
    approvedCount: 0,
    smartPassCount: 0,
    matchCount: 0,
    diffCount: 0,
    issueCount: 0,
    flaggedCount: 0,
  };

  for (const item of items) {
    const itemKey = item.itemKey ?? buildCrossItemKey(item.scenario, item.viewport);
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

/**
 * Project a persisted cross-compare item back to the standard ComparisonResult
 * shape that the report builder + comparison services expect. Pure: caller
 * provides the project path for absolute-path resolution.
 */
export interface CrossToComparisonInput extends CrossSummaryItem {
  accepted?: boolean;
}

export function crossItemToComparisonResult(
  item: CrossToComparisonInput,
  resolveProjectPath: (p: string) => string
): ComparisonResult {
  const baseline = resolveProjectPath(item.baseline);
  const test = resolveProjectPath(item.test);
  const approved = item.accepted ?? false;
  const diffPath = item.diff ? resolveProjectPath(item.diff) : undefined;
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
