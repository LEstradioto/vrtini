/**
 * Cross-compare "Smart Pass" heuristic: decides whether an item's visual diff
 * is acceptable for cross-browser rendering drift.
 * Pure — no I/O. Given an item plus classified DOM diff, returns a verdict.
 */

import { calculateConfidence } from '../confidence.js';
import { classifyFindings, classificationToCategory } from './classification.js';
import type { ChangeCategory } from './ai-prompt.js';
import type { DomDiffResult } from '../engines/dom-diff.js';
import type { AIAnalysisResult } from './ai-prompt.js';
import type { PerceptualHashResult } from '../phash.js';
import type { ComparisonResult } from '../core/types.js';

const SMART_PASS_PHASH_MIN = 0.93;
const SMART_PASS_DIFF_PCT_MAX = 18;
const SMART_PASS_LAYOUT_SHIFT_MAX = 450;

/**
 * Minimal shape required to evaluate Smart Pass — decoupled from the full
 * CrossResultItem so unit tests can construct it directly.
 */
export interface SmartPassInput {
  reason: ComparisonResult['reason'];
  diffPercentage: number;
  pixelDiff: number;
  ssimScore?: number;
  phash?: PerceptualHashResult;
  domDiff?: DomDiffResult;
  aiAnalysis?: AIAnalysisResult;
}

export interface SmartPassEvaluation {
  smartPass: boolean;
  reason: string;
}

export function evaluateCrossSmartPass(item: SmartPassInput): SmartPassEvaluation {
  if (item.reason !== 'match' && item.reason !== 'diff') {
    return { smartPass: false, reason: 'Item is not a match/diff comparison result.' };
  }
  if (item.diffPercentage <= 0) {
    return {
      smartPass: false,
      reason: 'Diff percentage is zero; Smart Pass only applies to non-zero deltas.',
    };
  }

  let domCategory: ChangeCategory | undefined;
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

  // Cross-browser rendering drift fallback: allow a pass when there are no
  // textual/structural DOM changes and perceptual hash is high, even if
  // pixel/SSIM look noisy.
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
    phashSimilarity >= SMART_PASS_PHASH_MIN &&
    item.diffPercentage <= SMART_PASS_DIFF_PCT_MAX &&
    layoutShiftCount <= SMART_PASS_LAYOUT_SHIFT_MAX
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
