import { describe, it, expect } from 'vitest';
import {
  pixelDiffToScore,
  calculateAIScore,
  calculateWeightedScore,
  determineVerdict,
  buildExplanation,
  matchesRuleCondition,
  evaluateRules,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_AUTO_RULES,
  SEVERITY_RANK,
  type ScoringInputs,
  type ScoringFactors,
  type RuleInputs,
  type RuleCondition,
  type AutoRule,
  type VerdictThresholds,
} from './scoring.js';

describe('pixelDiffToScore', () => {
  it('returns 1 for 0% diff', () => {
    expect(pixelDiffToScore(0, 10)).toBe(1);
  });

  it('returns ~0.368 for diff equal to decay factor (e^-1)', () => {
    expect(pixelDiffToScore(10, 10)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('returns ~0.135 for diff equal to 2x decay factor (e^-2)', () => {
    expect(pixelDiffToScore(20, 10)).toBeCloseTo(Math.exp(-2), 5);
  });

  it('approaches 0 for large diff', () => {
    expect(pixelDiffToScore(100, 10)).toBeLessThan(0.001);
  });

  it('respects custom decay factor', () => {
    // With decay factor 5, diff of 5 should give e^-1
    expect(pixelDiffToScore(5, 5)).toBeCloseTo(Math.exp(-1), 5);
  });
});

describe('calculateAIScore', () => {
  it('returns confidence as-is with no recommendation', () => {
    expect(calculateAIScore(0.8)).toBe(0.8);
  });

  it('returns confidence as-is with review recommendation', () => {
    expect(calculateAIScore(0.8, 'review')).toBe(0.8);
  });

  it('adds 0.1 for approve recommendation', () => {
    expect(calculateAIScore(0.8, 'approve')).toBeCloseTo(0.9, 5);
  });

  it('caps approve bonus at 1.0', () => {
    expect(calculateAIScore(0.95, 'approve')).toBe(1.0);
  });

  it('subtracts 0.2 for reject recommendation', () => {
    expect(calculateAIScore(0.8, 'reject')).toBeCloseTo(0.6, 5);
  });

  it('floors reject penalty at 0', () => {
    expect(calculateAIScore(0.1, 'reject')).toBe(0);
  });
});

describe('calculateWeightedScore', () => {
  it('uses weightsNoAI when AI not present', () => {
    const inputs: ScoringInputs = {
      ssimScore: 1.0,
      phashSimilarity: 1.0,
      pixelDiffPercent: 0,
    };
    const { score, factors } = calculateWeightedScore(inputs);

    // All signals are perfect, score should be 1.0
    expect(score).toBeCloseTo(1.0, 5);
    expect(factors.ai).toBeUndefined();
  });

  it('uses weights with AI when AI present', () => {
    const inputs: ScoringInputs = {
      ssimScore: 1.0,
      phashSimilarity: 1.0,
      pixelDiffPercent: 0,
      aiConfidence: 1.0,
    };
    const { score, factors } = calculateWeightedScore(inputs);

    expect(score).toBeCloseTo(1.0, 5);
    expect(factors.ai).toBeDefined();
  });

  it('calculates SSIM contribution correctly', () => {
    const inputs: ScoringInputs = {
      ssimScore: 0.8,
      pixelDiffPercent: 0,
    };
    const { factors } = calculateWeightedScore(inputs);

    expect(factors.ssim?.value).toBe(0.8);
    expect(factors.ssim?.contribution).toBeCloseTo(
      0.8 * DEFAULT_SCORING_CONFIG.weightsNoAI.ssim,
      5
    );
  });

  it('calculates pHash contribution correctly', () => {
    const inputs: ScoringInputs = {
      phashSimilarity: 0.9,
      pixelDiffPercent: 0,
    };
    const { factors } = calculateWeightedScore(inputs);

    expect(factors.phash?.value).toBe(0.9);
    expect(factors.phash?.contribution).toBeCloseTo(
      0.9 * DEFAULT_SCORING_CONFIG.weightsNoAI.phash,
      5
    );
  });

  it('calculates pixel contribution using exponential decay', () => {
    const inputs: ScoringInputs = {
      pixelDiffPercent: 10,
    };
    const { factors } = calculateWeightedScore(inputs);

    const expectedPixelScore = Math.exp(-10 / DEFAULT_SCORING_CONFIG.pixelDecayFactor);
    expect(factors.pixel?.value).toBeCloseTo(expectedPixelScore, 5);
  });

  it('includes AI category in factors', () => {
    const inputs: ScoringInputs = {
      pixelDiffPercent: 5,
      aiConfidence: 0.9,
      aiCategory: 'cosmetic',
    };
    const { factors } = calculateWeightedScore(inputs);

    expect(factors.ai?.category).toBe('cosmetic');
  });

  it('applies category adjustment for cosmetic', () => {
    const inputs: ScoringInputs = {
      ssimScore: 0.8,
      phashSimilarity: 0.8,
      pixelDiffPercent: 5,
      aiConfidence: 0.7,
      aiCategory: 'cosmetic',
    };
    const { score } = calculateWeightedScore(inputs);

    // cosmetic adjustment is +0.15
    const inputsWithoutCategory: ScoringInputs = { ...inputs, aiCategory: undefined };
    const { score: scoreWithoutCategory } = calculateWeightedScore(inputsWithoutCategory);

    expect(score).toBeCloseTo(scoreWithoutCategory + 0.15, 5);
  });

  it('applies category adjustment for regression', () => {
    const inputs: ScoringInputs = {
      ssimScore: 0.8,
      phashSimilarity: 0.8,
      pixelDiffPercent: 5,
      aiConfidence: 0.7,
      aiCategory: 'regression',
    };
    const { score } = calculateWeightedScore(inputs);

    const inputsWithoutCategory: ScoringInputs = { ...inputs, aiCategory: undefined };
    const { score: scoreWithoutCategory } = calculateWeightedScore(inputsWithoutCategory);

    // regression adjustment is -0.25
    expect(score).toBeCloseTo(scoreWithoutCategory - 0.25, 5);
  });

  it('clamps score to 0-1 range after category adjustment', () => {
    const inputs: ScoringInputs = {
      ssimScore: 1.0,
      phashSimilarity: 1.0,
      pixelDiffPercent: 0,
      aiConfidence: 1.0,
      aiCategory: 'cosmetic', // +0.15 on top of perfect score
    };
    const { score } = calculateWeightedScore(inputs);

    expect(score).toBe(1.0);
  });

  it('returns 0 when totalWeight is 0', () => {
    // Edge case: no inputs contribute (shouldn't happen in practice)
    const inputs: ScoringInputs = {
      pixelDiffPercent: 0,
    };
    // This still contributes pixel weight, so let's create a config with 0 weights
    const zeroConfig = {
      ...DEFAULT_SCORING_CONFIG,
      weightsNoAI: { ssim: 0, phash: 0, pixel: 0 },
    };
    const { score } = calculateWeightedScore(inputs, zeroConfig);

    expect(score).toBe(0);
  });
});

describe('determineVerdict', () => {
  const thresholds: VerdictThresholds = {
    pass: 0.9,
    likelyPass: 0.75,
    needsReview: 0.5,
    likelyFail: 0.3,
  };

  it('returns pass for score >= 0.90', () => {
    expect(determineVerdict(0.9, thresholds)).toBe('pass');
    expect(determineVerdict(1.0, thresholds)).toBe('pass');
  });

  it('returns likely-pass for score >= 0.75 and < 0.90', () => {
    expect(determineVerdict(0.75, thresholds)).toBe('likely-pass');
    expect(determineVerdict(0.89, thresholds)).toBe('likely-pass');
  });

  it('returns needs-review for score >= 0.50 and < 0.75', () => {
    expect(determineVerdict(0.5, thresholds)).toBe('needs-review');
    expect(determineVerdict(0.74, thresholds)).toBe('needs-review');
  });

  it('returns likely-fail for score >= 0.30 and < 0.50', () => {
    expect(determineVerdict(0.3, thresholds)).toBe('likely-fail');
    expect(determineVerdict(0.49, thresholds)).toBe('likely-fail');
  });

  it('returns fail for score < 0.30', () => {
    expect(determineVerdict(0.29, thresholds)).toBe('fail');
    expect(determineVerdict(0, thresholds)).toBe('fail');
  });

  it('uses default thresholds when not provided', () => {
    expect(determineVerdict(0.95)).toBe('pass');
    expect(determineVerdict(0.8)).toBe('likely-pass');
    expect(determineVerdict(0.6)).toBe('needs-review');
    expect(determineVerdict(0.4)).toBe('likely-fail');
    expect(determineVerdict(0.2)).toBe('fail');
  });
});

describe('buildExplanation', () => {
  it('returns empty string with no factors', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {};
    expect(buildExplanation(inputs, factors)).toBe('');
  });

  it('includes SSIM with excellent quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      ssim: { value: 0.98, contribution: 0.25 },
    };
    expect(buildExplanation(inputs, factors)).toBe('SSIM 98% (excellent)');
  });

  it('includes SSIM with good quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      ssim: { value: 0.9, contribution: 0.22 },
    };
    expect(buildExplanation(inputs, factors)).toBe('SSIM 90% (good)');
  });

  it('includes SSIM with low quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      ssim: { value: 0.7, contribution: 0.17 },
    };
    expect(buildExplanation(inputs, factors)).toBe('SSIM 70% (low)');
  });

  it('includes pHash with near-identical quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      phash: { value: 0.98, contribution: 0.2 },
    };
    expect(buildExplanation(inputs, factors)).toBe('pHash 98% (near-identical)');
  });

  it('includes pHash with similar quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      phash: { value: 0.9, contribution: 0.18 },
    };
    expect(buildExplanation(inputs, factors)).toBe('pHash 90% (similar)');
  });

  it('includes pHash with different quality', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      phash: { value: 0.7, contribution: 0.14 },
    };
    expect(buildExplanation(inputs, factors)).toBe('pHash 70% (different)');
  });

  it('includes pixel diff when > 0', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 5.5 };
    const factors: ScoringFactors = {};
    expect(buildExplanation(inputs, factors)).toBe('5.50% pixel diff');
  });

  it('excludes pixel diff when 0', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {};
    expect(buildExplanation(inputs, factors)).toBe('');
  });

  it('includes AI category when present', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 0 };
    const factors: ScoringFactors = {
      ai: { value: 0.9, contribution: 0.36, category: 'cosmetic' },
    };
    expect(buildExplanation(inputs, factors)).toBe('AI: cosmetic');
  });

  it('combines multiple factors with commas', () => {
    const inputs: ScoringInputs = { pixelDiffPercent: 2.5 };
    const factors: ScoringFactors = {
      ssim: { value: 0.96, contribution: 0.24 },
      phash: { value: 0.92, contribution: 0.18 },
      ai: { value: 0.85, contribution: 0.34, category: 'noise' },
    };
    expect(buildExplanation(inputs, factors)).toBe(
      'SSIM 96% (excellent), pHash 92% (similar), 2.50% pixel diff, AI: noise'
    );
  });
});

describe('SEVERITY_RANK', () => {
  it('ranks info lowest', () => {
    expect(SEVERITY_RANK.info).toBe(0);
  });

  it('ranks warning middle', () => {
    expect(SEVERITY_RANK.warning).toBe(1);
  });

  it('ranks critical highest', () => {
    expect(SEVERITY_RANK.critical).toBe(2);
  });
});

describe('matchesRuleCondition', () => {
  it('returns true for empty condition', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
    };
    expect(matchesRuleCondition(inputs, {})).toBe(true);
  });

  it('matches category when in list', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiCategory: 'cosmetic',
    };
    const condition: RuleCondition = {
      categories: ['cosmetic', 'noise'],
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects category when not in list', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiCategory: 'regression',
    };
    const condition: RuleCondition = {
      categories: ['cosmetic', 'noise'],
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('ignores category condition when aiCategory not provided', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
    };
    const condition: RuleCondition = {
      categories: ['cosmetic', 'noise'],
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('matches severity when within max', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiSeverity: 'info',
    };
    const condition: RuleCondition = {
      maxSeverity: 'warning',
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects severity when exceeds max', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiSeverity: 'critical',
    };
    const condition: RuleCondition = {
      maxSeverity: 'warning',
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('matches exact severity threshold', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiSeverity: 'warning',
    };
    const condition: RuleCondition = {
      maxSeverity: 'warning',
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('matches confidence when >= min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.85,
    };
    const condition: RuleCondition = {
      minConfidence: 0.85,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects confidence when < min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.84,
    };
    const condition: RuleCondition = {
      minConfidence: 0.85,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('matches pixelDiff when <= max', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
    };
    const condition: RuleCondition = {
      maxPixelDiff: 5,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects pixelDiff when > max', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5.1,
      confidenceScore: 0.8,
    };
    const condition: RuleCondition = {
      maxPixelDiff: 5,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('matches SSIM when >= min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      ssimScore: 0.95,
    };
    const condition: RuleCondition = {
      minSSIM: 0.95,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects SSIM when < min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      ssimScore: 0.94,
    };
    const condition: RuleCondition = {
      minSSIM: 0.95,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('ignores SSIM condition when ssimScore not provided', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
    };
    const condition: RuleCondition = {
      minSSIM: 0.95,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('matches pHash when >= min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      phashSimilarity: 0.98,
    };
    const condition: RuleCondition = {
      minPHash: 0.98,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects pHash when < min', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      phashSimilarity: 0.97,
    };
    const condition: RuleCondition = {
      minPHash: 0.98,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });

  it('ignores pHash condition when phashSimilarity not provided', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
    };
    const condition: RuleCondition = {
      minPHash: 0.98,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('requires all conditions to match', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 3,
      confidenceScore: 0.9,
      ssimScore: 0.96,
      phashSimilarity: 0.97,
      aiCategory: 'cosmetic',
      aiSeverity: 'info',
    };
    const condition: RuleCondition = {
      categories: ['cosmetic', 'noise'],
      maxSeverity: 'warning',
      minConfidence: 0.85,
      maxPixelDiff: 5,
      minSSIM: 0.95,
      minPHash: 0.95,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(true);
  });

  it('rejects when any condition fails', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 3,
      confidenceScore: 0.9,
      ssimScore: 0.96,
      phashSimilarity: 0.97,
      aiCategory: 'regression', // This fails
      aiSeverity: 'info',
    };
    const condition: RuleCondition = {
      categories: ['cosmetic', 'noise'],
      maxSeverity: 'warning',
      minConfidence: 0.85,
    };
    expect(matchesRuleCondition(inputs, condition)).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('returns null when no rules match', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 50,
      confidenceScore: 0.3,
    };
    const rules: AutoRule[] = [{ condition: { minConfidence: 0.9 }, action: 'approve' }];
    const result = evaluateRules(inputs, rules);
    expect(result.action).toBeNull();
    expect(result.matchedRule).toBeNull();
  });

  it('returns first matching rule action', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.95,
    };
    const rules: AutoRule[] = [
      { condition: { minConfidence: 0.9 }, action: 'approve' },
      { condition: { minConfidence: 0.8 }, action: 'flag' },
    ];
    const result = evaluateRules(inputs, rules);
    expect(result.action).toBe('approve');
    expect(result.matchedRule).toBe(rules[0]);
  });

  it('skips non-matching rules to find match', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.85,
    };
    const rules: AutoRule[] = [
      { condition: { minConfidence: 0.9 }, action: 'approve' },
      { condition: { minConfidence: 0.8 }, action: 'flag' },
    ];
    const result = evaluateRules(inputs, rules);
    expect(result.action).toBe('flag');
    expect(result.matchedRule).toBe(rules[1]);
  });

  it('returns null for empty rules array', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.95,
    };
    const result = evaluateRules(inputs, []);
    expect(result.action).toBeNull();
    expect(result.matchedRule).toBeNull();
  });

  it('supports reject action', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 5,
      confidenceScore: 0.8,
      aiCategory: 'regression',
    };
    const rules: AutoRule[] = [{ condition: { categories: ['regression'] }, action: 'reject' }];
    const result = evaluateRules(inputs, rules);
    expect(result.action).toBe('reject');
  });
});

describe('DEFAULT_AUTO_RULES', () => {
  it('approves cosmetic changes with high confidence and low severity', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 2,
      confidenceScore: 0.9,
      aiCategory: 'cosmetic',
      aiSeverity: 'info',
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    expect(result.action).toBe('approve');
  });

  it('approves noise changes with high confidence and low severity', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 1,
      confidenceScore: 0.88,
      aiCategory: 'noise',
      aiSeverity: 'info',
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    expect(result.action).toBe('approve');
  });

  it('rejects regressions with sufficient confidence', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 15,
      confidenceScore: 0.75,
      aiCategory: 'regression',
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    expect(result.action).toBe('reject');
  });

  it('approves near-identical images by metrics alone', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 0.1,
      confidenceScore: 0.5, // Low confidence but excellent metrics
      ssimScore: 0.99,
      phashSimilarity: 0.99,
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    expect(result.action).toBe('approve');
  });

  it('does not auto-approve cosmetic with warning severity (unless metrics match)', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 2,
      confidenceScore: 0.9,
      aiCategory: 'cosmetic',
      aiSeverity: 'warning', // Too severe for first rule
      ssimScore: 0.9, // Below 0.98 threshold for third rule
      phashSimilarity: 0.9, // Below 0.98 threshold for third rule
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    // First rule: cosmetic+info - fails due to warning severity
    // Second rule: regression - doesn't apply
    // Third rule: minPHash/minSSIM - fails due to low metrics
    expect(result.action).toBeNull();
  });

  it('does not auto-reject low-confidence regressions', () => {
    const inputs: RuleInputs = {
      pixelDiffPercent: 15,
      confidenceScore: 0.65, // Below 0.70 threshold
      aiCategory: 'regression',
      ssimScore: 0.8, // Below 0.98 threshold for third rule
      phashSimilarity: 0.8, // Below 0.98 threshold for third rule
    };
    const result = evaluateRules(inputs, DEFAULT_AUTO_RULES);
    // Second rule requires minConfidence: 0.70, which fails
    // Third rule requires minPHash/minSSIM: 0.98, which fails
    expect(result.action).toBeNull();
  });
});
