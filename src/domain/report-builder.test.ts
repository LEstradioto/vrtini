import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  calculateStats,
  sortResults,
  getStatusClass,
  getStatusText,
  getCategoryClass,
  getSeverityClass,
  getRecommendClass,
  getVerdictClass,
  getDiffStatsClass,
  getSsimClass,
  getPhashClass,
  getAutoActionClass,
  buildAiSection,
  buildConfidenceSection,
  buildPhashSection,
  buildAutoActionBadge,
  buildResultCardHtml,
  buildSummaryHtml,
  buildFilterBarHtml,
  type ReportStats,
  type ResultImages,
} from './report-builder.js';
import type {
  ComparisonMatch,
  ComparisonDiff,
  ComparisonNoBaseline,
  ComparisonError,
  ComparisonResult,
} from '../types/index.js';
import type { AIAnalysisResult } from './ai-prompt.js';

// Test fixtures
function makeMatch(overrides: Partial<ComparisonMatch> = {}): ComparisonMatch {
  return {
    reason: 'match',
    match: true,
    baseline: '/path/baseline.png',
    test: '/path/test.png',
    pixelDiff: 0,
    diffPercentage: 0,
    ssimScore: 0.99,
    ...overrides,
  };
}

function makeDiff(overrides: Partial<ComparisonDiff> = {}): ComparisonDiff {
  return {
    reason: 'diff',
    match: false,
    baseline: '/path/baseline.png',
    test: '/path/test.png',
    diffPath: '/path/diff.png',
    pixelDiff: 100,
    diffPercentage: 2.5,
    ...overrides,
  };
}

function makeNoBaseline(overrides: Partial<ComparisonNoBaseline> = {}): ComparisonNoBaseline {
  return {
    reason: 'no-baseline',
    match: false,
    baseline: '/path/baseline.png',
    test: '/path/test.png',
    pixelDiff: 0,
    diffPercentage: 0,
    ...overrides,
  };
}

function makeError(overrides: Partial<ComparisonError> = {}): ComparisonError {
  return {
    reason: 'error',
    match: false,
    baseline: '/path/baseline.png',
    test: '/path/test.png',
    pixelDiff: 0,
    diffPercentage: 0,
    error: 'Something went wrong',
    ...overrides,
  };
}

function makeAiAnalysis(overrides: Partial<AIAnalysisResult> = {}): AIAnalysisResult {
  return {
    category: 'cosmetic',
    severity: 'info',
    confidence: 0.85,
    summary: 'Minor visual change',
    details: ['Font slightly different', 'Spacing adjusted'],
    recommendation: 'approve',
    reasoning: 'Changes are cosmetic only',
    provider: 'anthropic',
    model: 'claude-3',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes less than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes multiple special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('returns unchanged string without special chars', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('calculateStats', () => {
  it('counts all zeroes for empty array', () => {
    const stats = calculateStats([]);
    expect(stats).toEqual({
      passed: 0,
      smartPass: 0,
      failed: 0,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 0,
    });
  });

  it('counts passed results', () => {
    const results = [makeMatch(), makeMatch()];
    const stats = calculateStats(results);
    expect(stats.passed).toBe(2);
    expect(stats.smartPass).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('counts smart pass results', () => {
    const results = [makeMatch({ diffPercentage: 0.25 })];
    const stats = calculateStats(results);
    expect(stats.passed).toBe(1);
    expect(stats.smartPass).toBe(1);
  });

  it('counts failed results', () => {
    const results = [makeDiff(), makeDiff(), makeDiff()];
    const stats = calculateStats(results);
    expect(stats.failed).toBe(3);
    expect(stats.passed).toBe(0);
  });

  it('counts no-baseline results', () => {
    const results = [makeNoBaseline(), makeNoBaseline()];
    const stats = calculateStats(results);
    expect(stats.noBaseline).toBe(2);
  });

  it('counts error results', () => {
    const results = [makeError()];
    const stats = calculateStats(results);
    expect(stats.errors).toBe(1);
  });

  it('counts auto-approved results', () => {
    const results = [
      makeDiff({ autoAction: 'approve' }),
      makeDiff({ autoAction: 'reject' }),
      makeDiff({ autoAction: 'approve' }),
    ];
    const stats = calculateStats(results);
    expect(stats.autoApproved).toBe(2);
  });

  it('counts ai-analyzed results', () => {
    const results = [
      makeDiff({ aiAnalysis: makeAiAnalysis() }),
      makeDiff(),
      makeDiff({ aiAnalysis: makeAiAnalysis() }),
    ];
    const stats = calculateStats(results);
    expect(stats.aiAnalyzed).toBe(2);
  });

  it('calculates mixed results correctly', () => {
    const results: ComparisonResult[] = [
      makeMatch(),
      makeDiff({ autoAction: 'approve', aiAnalysis: makeAiAnalysis() }),
      makeNoBaseline(),
      makeError(),
    ];
    const stats = calculateStats(results);
    expect(stats).toEqual({
      passed: 1,
      smartPass: 0,
      failed: 1,
      noBaseline: 1,
      errors: 1,
      approved: 0,
      autoApproved: 1,
      aiAnalyzed: 1,
    });
  });
});

describe('sortResults', () => {
  it('returns empty array for empty input', () => {
    expect(sortResults([])).toEqual([]);
  });

  it('puts failed results before passed', () => {
    const passed = makeMatch();
    const failed = makeDiff();
    const sorted = sortResults([passed, failed]);
    expect(sorted[0]).toBe(failed);
    expect(sorted[1]).toBe(passed);
  });

  it('sorts failed results by SSIM ascending', () => {
    const low = makeDiff({ ssimScore: 0.5 });
    const high = makeDiff({ ssimScore: 0.9 });
    const sorted = sortResults([high, low]);
    expect(sorted[0]).toBe(low);
    expect(sorted[1]).toBe(high);
  });

  it('sorts by diff percentage descending when SSIM equal', () => {
    const lowDiff = makeDiff({ ssimScore: 0.8, diffPercentage: 5 });
    const highDiff = makeDiff({ ssimScore: 0.8, diffPercentage: 15 });
    const sorted = sortResults([lowDiff, highDiff]);
    expect(sorted[0]).toBe(highDiff);
    expect(sorted[1]).toBe(lowDiff);
  });

  it('treats undefined SSIM as 1', () => {
    const noSsim = makeDiff({ ssimScore: undefined });
    const lowSsim = makeDiff({ ssimScore: 0.7 });
    const sorted = sortResults([noSsim, lowSsim]);
    expect(sorted[0]).toBe(lowSsim);
    expect(sorted[1]).toBe(noSsim);
  });

  it('does not mutate original array', () => {
    const original = [makeMatch(), makeDiff()];
    const copy = [...original];
    sortResults(original);
    expect(original).toEqual(copy);
  });
});

describe('getStatusClass', () => {
  it('returns "passed" for match', () => {
    expect(getStatusClass(makeMatch())).toBe('passed');
  });

  it('returns "failed" for diff', () => {
    expect(getStatusClass(makeDiff())).toBe('failed');
  });

  it('returns "new" for no-baseline', () => {
    expect(getStatusClass(makeNoBaseline())).toBe('new');
  });

  it('returns "error" for error', () => {
    expect(getStatusClass(makeError())).toBe('error');
  });
});

describe('getStatusText', () => {
  it('returns "Passed" for match', () => {
    expect(getStatusText(makeMatch())).toBe('Passed');
  });

  it('returns "Smart Pass" for match with diff percentage', () => {
    expect(getStatusText(makeMatch({ diffPercentage: 0.5 }))).toBe('Smart Pass');
  });

  it('returns "Failed" for diff', () => {
    expect(getStatusText(makeDiff())).toBe('Failed');
  });

  it('returns "New (no baseline)" for no-baseline', () => {
    expect(getStatusText(makeNoBaseline())).toBe('New (no baseline)');
  });

  it('returns "Error" for error', () => {
    expect(getStatusText(makeError())).toBe('Error');
  });
});

describe('getCategoryClass', () => {
  it('returns "category-regression" for regression', () => {
    expect(getCategoryClass('regression')).toBe('category-regression');
  });

  it('returns "category-cosmetic" for cosmetic', () => {
    expect(getCategoryClass('cosmetic')).toBe('category-cosmetic');
  });

  it('returns "category-cosmetic" for noise', () => {
    expect(getCategoryClass('noise')).toBe('category-cosmetic');
  });

  it('returns "category-change" for other values', () => {
    expect(getCategoryClass('content_change')).toBe('category-change');
    expect(getCategoryClass('layout_shift')).toBe('category-change');
  });
});

describe('getSeverityClass', () => {
  it('returns "severity-critical" for critical', () => {
    expect(getSeverityClass('critical')).toBe('severity-critical');
  });

  it('returns "severity-warning" for warning', () => {
    expect(getSeverityClass('warning')).toBe('severity-warning');
  });

  it('returns "severity-info" for info', () => {
    expect(getSeverityClass('info')).toBe('severity-info');
  });

  it('returns "severity-info" for unknown values', () => {
    expect(getSeverityClass('unknown')).toBe('severity-info');
  });
});

describe('getRecommendClass', () => {
  it('returns "recommend-approve" for approve', () => {
    expect(getRecommendClass('approve')).toBe('recommend-approve');
  });

  it('returns "recommend-reject" for reject', () => {
    expect(getRecommendClass('reject')).toBe('recommend-reject');
  });

  it('returns "recommend-review" for review', () => {
    expect(getRecommendClass('review')).toBe('recommend-review');
  });

  it('returns "recommend-review" for unknown values', () => {
    expect(getRecommendClass('unknown')).toBe('recommend-review');
  });
});

describe('getVerdictClass', () => {
  it('returns "verdict-pass" for pass', () => {
    expect(getVerdictClass('pass')).toBe('verdict-pass');
  });

  it('returns "verdict-pass" for likely-pass', () => {
    expect(getVerdictClass('likely-pass')).toBe('verdict-pass');
  });

  it('returns "verdict-fail" for fail', () => {
    expect(getVerdictClass('fail')).toBe('verdict-fail');
  });

  it('returns "verdict-fail" for likely-fail', () => {
    expect(getVerdictClass('likely-fail')).toBe('verdict-fail');
  });

  it('returns "verdict-review" for needs-review', () => {
    expect(getVerdictClass('needs-review')).toBe('verdict-review');
  });

  it('returns "verdict-review" for unknown values', () => {
    expect(getVerdictClass('unknown')).toBe('verdict-review');
  });
});

describe('getDiffStatsClass', () => {
  it('returns "diff-high" for > 5%', () => {
    expect(getDiffStatsClass(5.1)).toBe('diff-high');
    expect(getDiffStatsClass(10)).toBe('diff-high');
  });

  it('returns "diff-medium" for > 1% and <= 5%', () => {
    expect(getDiffStatsClass(1.1)).toBe('diff-medium');
    expect(getDiffStatsClass(5)).toBe('diff-medium');
  });

  it('returns "diff-low" for <= 1%', () => {
    expect(getDiffStatsClass(1)).toBe('diff-low');
    expect(getDiffStatsClass(0.5)).toBe('diff-low');
    expect(getDiffStatsClass(0)).toBe('diff-low');
  });
});

describe('getSsimClass', () => {
  it('returns "ssim-good" for >= 0.95', () => {
    expect(getSsimClass(0.95)).toBe('ssim-good');
    expect(getSsimClass(0.99)).toBe('ssim-good');
    expect(getSsimClass(1)).toBe('ssim-good');
  });

  it('returns "ssim-warn" for >= 0.8 and < 0.95', () => {
    expect(getSsimClass(0.8)).toBe('ssim-warn');
    expect(getSsimClass(0.9)).toBe('ssim-warn');
    expect(getSsimClass(0.949)).toBe('ssim-warn');
  });

  it('returns "ssim-bad" for < 0.8', () => {
    expect(getSsimClass(0.79)).toBe('ssim-bad');
    expect(getSsimClass(0.5)).toBe('ssim-bad');
    expect(getSsimClass(0)).toBe('ssim-bad');
  });
});

describe('getPhashClass', () => {
  it('returns "phash-good" for >= 0.95', () => {
    expect(getPhashClass(0.95)).toBe('phash-good');
    expect(getPhashClass(1)).toBe('phash-good');
  });

  it('returns "phash-warn" for >= 0.85 and < 0.95', () => {
    expect(getPhashClass(0.85)).toBe('phash-warn');
    expect(getPhashClass(0.9)).toBe('phash-warn');
  });

  it('returns "phash-bad" for < 0.85', () => {
    expect(getPhashClass(0.84)).toBe('phash-bad');
    expect(getPhashClass(0.5)).toBe('phash-bad');
  });
});

describe('getAutoActionClass', () => {
  it('returns "auto-approve" for approve', () => {
    expect(getAutoActionClass('approve')).toBe('auto-approve');
  });

  it('returns "auto-reject" for reject', () => {
    expect(getAutoActionClass('reject')).toBe('auto-reject');
  });

  it('returns "auto-flag" for flag', () => {
    expect(getAutoActionClass('flag')).toBe('auto-flag');
  });

  it('returns "auto-flag" for unknown values', () => {
    expect(getAutoActionClass('unknown')).toBe('auto-flag');
  });
});

describe('buildAiSection', () => {
  it('returns empty string for match result', () => {
    expect(buildAiSection(makeMatch())).toBe('');
  });

  it('returns empty string for diff without AI analysis', () => {
    expect(buildAiSection(makeDiff())).toBe('');
  });

  it('builds HTML for diff with AI analysis', () => {
    const result = makeDiff({
      aiAnalysis: makeAiAnalysis({
        category: 'regression',
        severity: 'critical',
        confidence: 0.92,
        summary: 'Button missing',
        details: ['Submit button removed'],
        recommendation: 'reject',
        reasoning: 'Critical UI element missing',
      }),
    });
    const html = buildAiSection(result);

    expect(html).toContain('ai-analysis');
    expect(html).toContain('AI Analysis');
    expect(html).toContain('category-regression');
    expect(html).toContain('severity-critical');
    expect(html).toContain('92% confident');
    expect(html).toContain('recommend-reject');
    expect(html).toContain('Button missing');
    expect(html).toContain('Submit button removed');
    expect(html).toContain('Critical UI element missing');
  });

  it('escapes HTML in AI analysis content', () => {
    const result = makeDiff({
      aiAnalysis: makeAiAnalysis({
        summary: '<script>alert("xss")</script>',
      }),
    });
    const html = buildAiSection(result);

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});

describe('buildConfidenceSection', () => {
  it('returns empty string for match result', () => {
    expect(buildConfidenceSection(makeMatch())).toBe('');
  });

  it('returns empty string for diff without confidence', () => {
    expect(buildConfidenceSection(makeDiff())).toBe('');
  });

  it('builds HTML for diff with confidence', () => {
    const result = makeDiff({
      confidence: {
        score: 0.75,
        verdict: 'likely-pass',
        explanation: 'Likely safe to approve',
        factors: {
          ssim: { value: 0.92, contribution: 0.23 },
          phash: { value: 0.95, contribution: 0.19 },
          pixel: { value: 0.8, contribution: 0.12 },
        },
      },
    });
    const html = buildConfidenceSection(result);

    expect(html).toContain('confidence-score');
    expect(html).toContain('75%');
    expect(html).toContain('likely-pass');
    expect(html).toContain('verdict-pass');
  });
});

describe('buildPhashSection', () => {
  it('returns empty string for result without phash', () => {
    expect(buildPhashSection(makeDiff())).toBe('');
  });

  it('builds HTML for result with phash', () => {
    const result = makeDiff({
      phash: { baselineHash: 'abc', testHash: 'def', hammingDistance: 5, similarity: 0.92 },
    });
    const html = buildPhashSection(result);

    expect(html).toContain('phash-score');
    expect(html).toContain('phash-warn');
    expect(html).toContain('92%');
  });

  it('applies correct class based on similarity', () => {
    const good = makeDiff({
      phash: { baselineHash: 'a', testHash: 'a', hammingDistance: 0, similarity: 0.98 },
    });
    const bad = makeDiff({
      phash: { baselineHash: 'a', testHash: 'b', hammingDistance: 20, similarity: 0.7 },
    });

    expect(buildPhashSection(good)).toContain('phash-good');
    expect(buildPhashSection(bad)).toContain('phash-bad');
  });
});

describe('buildAutoActionBadge', () => {
  it('returns empty string for match result', () => {
    expect(buildAutoActionBadge(makeMatch())).toBe('');
  });

  it('returns empty string for diff without auto action', () => {
    expect(buildAutoActionBadge(makeDiff())).toBe('');
  });

  it('builds badge for approve action', () => {
    const result = makeDiff({ autoAction: 'approve' });
    const html = buildAutoActionBadge(result);

    expect(html).toContain('auto-action');
    expect(html).toContain('auto-approve');
    expect(html).toContain('Auto: approve');
  });

  it('builds badge for reject action', () => {
    const result = makeDiff({ autoAction: 'reject' });
    const html = buildAutoActionBadge(result);

    expect(html).toContain('auto-reject');
    expect(html).toContain('Auto: reject');
  });

  it('builds badge for flag action', () => {
    const result = makeDiff({ autoAction: 'flag' });
    const html = buildAutoActionBadge(result);

    expect(html).toContain('auto-flag');
    expect(html).toContain('Auto: flag');
  });
});

describe('buildResultCardHtml', () => {
  const defaultImages: ResultImages = {
    baseline: 'data:image/png;base64,baseline',
    test: 'data:image/png;base64,test',
    diff: 'data:image/png;base64,diff',
  };

  it('builds card for passed result', () => {
    const html = buildResultCardHtml(makeMatch(), defaultImages, 'homepage');

    expect(html).toContain('class="result passed"');
    expect(html).toContain('homepage');
    expect(html).toContain('Passed');
    expect(html).toContain('Compare');
    expect(html).not.toContain('approve-btn');
  });

  it('builds card for smart pass result', () => {
    const html = buildResultCardHtml(makeMatch({ diffPercentage: 0.2 }), defaultImages, 'homepage');

    expect(html).toContain('class="result passed smart-pass"');
    expect(html).toContain('Smart Pass');
  });

  it('builds card for failed result with approve button', () => {
    const html = buildResultCardHtml(makeDiff(), defaultImages, 'checkout');

    expect(html).toContain('class="result failed"');
    expect(html).toContain('Failed');
    expect(html).toContain('approve-btn');
    expect(html).toContain('data-action="approve"');
  });

  it('builds card with diff stats', () => {
    const result = makeDiff({ pixelDiff: 1500, diffPercentage: 3.25 });
    const html = buildResultCardHtml(result, defaultImages, 'test');

    expect(html).toContain('3.25%');
    expect(html).toContain('1,500 px');
    expect(html).toContain('diff-medium');
  });

  it('builds card with SSIM score', () => {
    const result = makeDiff({ ssimScore: 0.87 });
    const html = buildResultCardHtml(result, defaultImages, 'test');

    expect(html).toContain('SSIM');
    expect(html).toContain('87.0%');
    expect(html).toContain('ssim-warn');
  });

  it('builds card with error message', () => {
    const html = buildResultCardHtml(makeError(), defaultImages, 'test');

    expect(html).toContain('class="result error"');
    expect(html).toContain('Something went wrong');
  });

  it('handles missing images', () => {
    const noImages: ResultImages = { baseline: null, test: null, diff: null };
    const html = buildResultCardHtml(makeMatch(), noImages, 'test');

    expect(html).toContain('No baseline');
    expect(html).toContain('No diff');
    expect(html).toContain('No test image');
  });

  it('adds auto-approved class when applicable', () => {
    const result = makeDiff({ autoAction: 'approve' });
    const html = buildResultCardHtml(result, defaultImages, 'test');

    expect(html).toContain('auto-approved');
  });

  it('escapes HTML in name', () => {
    const html = buildResultCardHtml(makeMatch(), defaultImages, '<script>xss</script>');

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>xss');
  });
});

describe('buildSummaryHtml', () => {
  it('builds summary with basic counts', () => {
    const stats: ReportStats = {
      passed: 10,
      smartPass: 0,
      failed: 2,
      noBaseline: 1,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 0,
    };
    const html = buildSummaryHtml(stats);

    expect(html).toContain('>10<');
    expect(html).toContain('>2<');
    expect(html).toContain('>1<');
    expect(html).toContain('>0<');
    expect(html).not.toContain('Auto-Approved');
    expect(html).not.toContain('AI Analyzed');
  });

  it('includes smart pass section when count > 0', () => {
    const stats: ReportStats = {
      passed: 4,
      smartPass: 2,
      failed: 0,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 0,
    };
    const html = buildSummaryHtml(stats);

    expect(html).toContain('Smart Pass');
    expect(html).toContain('>2<');
  });

  it('includes auto-approved section when count > 0', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 3,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 2,
      aiAnalyzed: 0,
    };
    const html = buildSummaryHtml(stats);

    expect(html).toContain('Auto-Approved');
    expect(html).toContain('>2<');
  });

  it('includes AI analyzed section when count > 0', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 3,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 4,
    };
    const html = buildSummaryHtml(stats);

    expect(html).toContain('AI Analyzed');
    expect(html).toContain('>4<');
  });
});

describe('buildFilterBarHtml', () => {
  it('builds filter bar with standard buttons', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 3,
      noBaseline: 1,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 0,
    };
    const html = buildFilterBarHtml(stats);

    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-filter="failed"');
    expect(html).toContain('data-filter="new"');
    expect(html).toContain('data-filter="passed"');
  });

  it('includes auto-approved button when count > 0', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 3,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 2,
      aiAnalyzed: 0,
    };
    const html = buildFilterBarHtml(stats);

    expect(html).toContain('data-filter="auto-approved"');
    expect(html).toContain('Auto-Approved');
  });

  it('includes smart pass button when count > 0', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 1,
      failed: 0,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 0,
      aiAnalyzed: 0,
    };
    const html = buildFilterBarHtml(stats);

    expect(html).toContain('data-filter="smart-pass"');
    expect(html).toContain('Smart Pass');
  });

  it('includes needs-review button when there are non-auto-approved failures', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 5,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 2,
      aiAnalyzed: 0,
    };
    const html = buildFilterBarHtml(stats);

    expect(html).toContain('data-filter="needs-review"');
    expect(html).toContain('Needs Review');
  });

  it('excludes needs-review button when all failures are auto-approved', () => {
    const stats: ReportStats = {
      passed: 5,
      smartPass: 0,
      failed: 3,
      noBaseline: 0,
      errors: 0,
      approved: 0,
      autoApproved: 3,
      aiAnalyzed: 0,
    };
    const html = buildFilterBarHtml(stats);

    expect(html).not.toContain('data-filter="needs-review"');
  });
});
