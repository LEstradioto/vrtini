import type { AIAnalysisResult } from './ai-analysis.js';
import {
  calculateWeightedScore,
  determineVerdict,
  buildExplanation,
  evaluateRules,
  DEFAULT_SCORING_CONFIG,
  type Verdict,
  type ScoringConfig,
  type AutoRule,
} from './domain/scoring.js';
import type { ConfidenceResult } from './types/index.js';

export type { Verdict, ScoringConfig, AutoRule, ConfidenceResult };

export interface ConfidenceInputs {
  ssimScore?: number;
  phashSimilarity?: number;
  pixelDiffPercent: number;
  aiAnalysis?: AIAnalysisResult;
}

function buildScoringInputs(inputs: ConfidenceInputs) {
  return {
    ssimScore: inputs.ssimScore,
    phashSimilarity: inputs.phashSimilarity,
    pixelDiffPercent: inputs.pixelDiffPercent,
    aiConfidence: inputs.aiAnalysis?.confidence,
    aiRecommendation: inputs.aiAnalysis?.recommendation,
    aiCategory: inputs.aiAnalysis?.category,
  };
}

function buildRuleInputs(inputs: ConfidenceInputs, confidence: ConfidenceResult) {
  return {
    ssimScore: inputs.ssimScore,
    phashSimilarity: inputs.phashSimilarity,
    pixelDiffPercent: inputs.pixelDiffPercent,
    confidenceScore: confidence.score,
    aiCategory: inputs.aiAnalysis?.category,
    aiSeverity: inputs.aiAnalysis?.severity,
  };
}

/**
 * Calculate a unified confidence score from multiple signals
 */
export function calculateConfidence(
  inputs: ConfidenceInputs,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ConfidenceResult {
  const scoringInputs = buildScoringInputs(inputs);

  const { score, factors } = calculateWeightedScore(scoringInputs, config);
  const verdict = determineVerdict(score, config.verdictThresholds);
  const explanation = buildExplanation(scoringInputs, factors);

  return { score, verdict, explanation, factors };
}

// Re-export AutoApproveRule as alias for backward compatibility
export type AutoApproveRule = AutoRule;

/**
 * Check if a result should be auto-approved/rejected based on rules
 */
export function evaluateAutoRules(
  inputs: ConfidenceInputs,
  confidence: ConfidenceResult,
  rules: AutoRule[]
): { action: 'approve' | 'flag' | 'reject' | null; matchedRule: AutoRule | null } {
  return evaluateRules(buildRuleInputs(inputs, confidence), rules);
}

// Re-export DEFAULT_AUTO_RULES from scoring.ts
export { DEFAULT_AUTO_RULES } from './domain/scoring.js';
