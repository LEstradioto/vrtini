/**
 * Pure auto-rule evaluation: given a comparison's signals (category,
 * severity, pixel diff, SSIM, pHash, DOM text changes, confidence score),
 * find the first matching rule and return its action (approve / flag /
 * reject). Split out of scoring.ts so the scoring module stays focused on
 * weighted score + verdict, and the rule predicate can be unit-tested in
 * isolation.
 */

import type { ChangeCategory } from './ai-prompt.js';

export type Severity = 'info' | 'warning' | 'critical';

/**
 * Severity rank for rule evaluation.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export interface RuleCondition {
  categories?: ChangeCategory[];
  maxSeverity?: Severity;
  minConfidence?: number;
  maxPixelDiff?: number;
  minSSIM?: number;
  minPHash?: number;
  maxDomTextChanges?: number;
}

export interface AutoRule {
  condition: RuleCondition;
  action: 'approve' | 'flag' | 'reject';
}

export interface RuleInputs {
  ssimScore?: number;
  phashSimilarity?: number;
  pixelDiffPercent: number;
  confidenceScore: number;
  aiCategory?: ChangeCategory;
  aiSeverity?: Severity;
  domTextChanges?: number;
}

/**
 * Check if inputs match a rule condition.
 */
export function matchesRuleCondition(inputs: RuleInputs, condition: RuleCondition): boolean {
  if (condition.categories) {
    if (!inputs.aiCategory) return false;
    if (!condition.categories.includes(inputs.aiCategory)) return false;
  }

  if (condition.maxSeverity) {
    if (!inputs.aiSeverity) return false;
    const aiRank = SEVERITY_RANK[inputs.aiSeverity];
    const maxRank = SEVERITY_RANK[condition.maxSeverity];
    if (aiRank > maxRank) return false;
  }

  if (condition.minConfidence !== undefined) {
    if (inputs.confidenceScore < condition.minConfidence) return false;
  }

  if (condition.maxPixelDiff !== undefined) {
    if (inputs.pixelDiffPercent > condition.maxPixelDiff) return false;
  }

  if (condition.minSSIM !== undefined && inputs.ssimScore !== undefined) {
    if (inputs.ssimScore < condition.minSSIM) return false;
  }

  if (condition.minPHash !== undefined && inputs.phashSimilarity !== undefined) {
    if (inputs.phashSimilarity < condition.minPHash) return false;
  }

  if (condition.maxDomTextChanges !== undefined && inputs.domTextChanges !== undefined) {
    if (inputs.domTextChanges > condition.maxDomTextChanges) return false;
  }

  return true;
}

/**
 * Evaluate rules and return first matching action.
 */
export function evaluateRules(
  inputs: RuleInputs,
  rules: AutoRule[]
): { action: 'approve' | 'flag' | 'reject' | null; matchedRule: AutoRule | null } {
  for (const rule of rules) {
    if (matchesRuleCondition(inputs, rule.condition)) {
      return { action: rule.action, matchedRule: rule };
    }
  }
  return { action: null, matchedRule: null };
}

export const DEFAULT_AUTO_RULES: AutoRule[] = [
  {
    condition: {
      categories: ['cosmetic', 'noise'],
      maxSeverity: 'info',
      minConfidence: 0.85,
      maxDomTextChanges: 0,
    },
    action: 'approve',
  },
  {
    condition: {
      categories: ['regression'],
      minConfidence: 0.7,
    },
    action: 'reject',
  },
  {
    condition: {
      minPHash: 0.98,
      minSSIM: 0.98,
      maxDomTextChanges: 0,
    },
    action: 'approve',
  },
];
