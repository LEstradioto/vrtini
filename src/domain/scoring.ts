/**
 * Pure confidence scoring functions (no I/O).
 * Makes weights and thresholds configurable instead of hardcoded.
 */

import type { ChangeCategory } from './ai-prompt.js';

export type Verdict = 'pass' | 'likely-pass' | 'needs-review' | 'likely-fail' | 'fail';

export interface ScoringWeights {
  ssim: number;
  phash: number;
  pixel: number;
  ai: number;
}

export interface VerdictThresholds {
  pass: number;
  likelyPass: number;
  needsReview: number;
  likelyFail: number;
}

export interface ScoringConfig {
  weights: ScoringWeights;
  weightsNoAI: Omit<ScoringWeights, 'ai'>;
  categoryAdjustments: Record<ChangeCategory, number>;
  verdictThresholds: VerdictThresholds;
  pixelDecayFactor: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: {
    ssim: 0.25,
    phash: 0.2,
    pixel: 0.15,
    ai: 0.4,
  },
  weightsNoAI: {
    ssim: 0.45,
    phash: 0.3,
    pixel: 0.25,
  },
  categoryAdjustments: {
    cosmetic: 0.15,
    noise: 0.2,
    content_change: -0.05,
    layout_shift: -0.1,
    regression: -0.25,
  },
  verdictThresholds: {
    pass: 0.9,
    likelyPass: 0.75,
    needsReview: 0.5,
    likelyFail: 0.3,
  },
  pixelDecayFactor: 10,
};

export interface ScoringInputs {
  ssimScore?: number;
  phashSimilarity?: number;
  pixelDiffPercent: number;
  aiConfidence?: number;
  aiRecommendation?: 'approve' | 'review' | 'reject';
  aiCategory?: ChangeCategory;
}

export interface ScoreFactor {
  value: number;
  contribution: number;
  category?: ChangeCategory;
}

export interface ScoringFactors {
  ssim?: ScoreFactor;
  phash?: ScoreFactor;
  pixel?: ScoreFactor;
  ai?: ScoreFactor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Convert pixel diff percentage to a 0-1 score using exponential decay.
 */
export function pixelDiffToScore(diffPercent: number, decayFactor: number): number {
  return Math.exp(-diffPercent / decayFactor);
}

const AI_APPROVE_BOOST = 0.1;
const AI_REJECT_PENALTY = 0.2;

/**
 * Calculate AI score adjusted by recommendation.
 */
export function calculateAIScore(
  confidence: number,
  recommendation?: 'approve' | 'review' | 'reject'
): number {
  let score = confidence;
  if (recommendation === 'approve') {
    score = score + AI_APPROVE_BOOST;
  } else if (recommendation === 'reject') {
    score = score - AI_REJECT_PENALTY;
  }
  return clamp01(score);
}

/**
 * Calculate weighted score from inputs.
 */
export function calculateWeightedScore(
  inputs: ScoringInputs,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { score: number; factors: ScoringFactors } {
  const factors: ScoringFactors = {};
  let totalWeight = 0;
  let weightedSum = 0;

  const hasAI = inputs.aiConfidence !== undefined;
  const weights = hasAI ? config.weights : config.weightsNoAI;

  // SSIM contribution
  if (inputs.ssimScore !== undefined) {
    const weight = weights.ssim;
    factors.ssim = {
      value: inputs.ssimScore,
      contribution: inputs.ssimScore * weight,
    };
    weightedSum += factors.ssim.contribution;
    totalWeight += weight;
  }

  // pHash contribution
  if (inputs.phashSimilarity !== undefined) {
    const weight = weights.phash;
    factors.phash = {
      value: inputs.phashSimilarity,
      contribution: inputs.phashSimilarity * weight,
    };
    weightedSum += factors.phash.contribution;
    totalWeight += weight;
  }

  // Pixel diff contribution
  const pixelScore = pixelDiffToScore(inputs.pixelDiffPercent, config.pixelDecayFactor);
  const pixelWeight = weights.pixel;
  factors.pixel = {
    value: pixelScore,
    contribution: pixelScore * pixelWeight,
  };
  weightedSum += factors.pixel.contribution;
  totalWeight += pixelWeight;

  // AI contribution
  if (hasAI && inputs.aiConfidence !== undefined) {
    const aiWeight = config.weights.ai;
    const aiScore = calculateAIScore(inputs.aiConfidence, inputs.aiRecommendation);

    factors.ai = {
      value: aiScore,
      contribution: aiScore * aiWeight,
      category: inputs.aiCategory,
    };
    weightedSum += factors.ai.contribution;
    totalWeight += aiWeight;
  }

  // Normalize
  let baseScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Apply category adjustment
  if (inputs.aiCategory) {
    const adjustment = config.categoryAdjustments[inputs.aiCategory] || 0;
    baseScore = clamp01(baseScore + adjustment);
  }

  return { score: baseScore, factors };
}

/**
 * Determine verdict from score.
 */
export function determineVerdict(
  score: number,
  thresholds: VerdictThresholds = DEFAULT_SCORING_CONFIG.verdictThresholds
): Verdict {
  if (score >= thresholds.pass) return 'pass';
  if (score >= thresholds.likelyPass) return 'likely-pass';
  if (score >= thresholds.needsReview) return 'needs-review';
  if (score >= thresholds.likelyFail) return 'likely-fail';
  return 'fail';
}

/**
 * Build explanation string from factors.
 */
export function buildExplanation(inputs: ScoringInputs, factors: ScoringFactors): string {
  const parts: string[] = [];

  if (factors.ssim) {
    const pct = (factors.ssim.value * 100).toFixed(0);
    const quality =
      factors.ssim.value >= 0.95 ? 'excellent' : factors.ssim.value >= 0.85 ? 'good' : 'low';
    parts.push(`SSIM ${pct}% (${quality})`);
  }

  if (factors.phash) {
    const pct = (factors.phash.value * 100).toFixed(0);
    const quality =
      factors.phash.value >= 0.95
        ? 'near-identical'
        : factors.phash.value >= 0.85
          ? 'similar'
          : 'different';
    parts.push(`pHash ${pct}% (${quality})`);
  }

  if (inputs.pixelDiffPercent > 0) {
    parts.push(`${inputs.pixelDiffPercent.toFixed(2)}% pixel diff`);
  }

  if (factors.ai?.category) {
    parts.push(`AI: ${factors.ai.category}`);
  }

  return parts.join(', ');
}

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
}

/**
 * Check if inputs match a rule condition.
 */
export function matchesRuleCondition(inputs: RuleInputs, condition: RuleCondition): boolean {
  if (condition.categories && inputs.aiCategory) {
    if (!condition.categories.includes(inputs.aiCategory)) return false;
  }

  if (condition.maxSeverity && inputs.aiSeverity) {
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
    },
    action: 'approve',
  },
];
