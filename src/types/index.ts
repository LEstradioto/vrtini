/**
 * Shared types to prevent circular imports.
 */

import type { PerceptualHashResult } from '../phash.js';
import type { AIAnalysisResult } from '../domain/ai-prompt.js';
import type { Verdict, ScoringFactors } from '../domain/scoring.js';
import type { UnifiedConfidence, EngineResult } from '../engines/index.js';
import type { DomDiffResult } from '../engines/dom-diff.js';

export interface BrowserRef {
  name: 'chromium' | 'webkit';
  version?: string;
}

export function formatBrowser(ref: BrowserRef): string {
  return ref.version ? `${ref.name}-v${ref.version}` : ref.name;
}

export interface ConfidenceResult {
  score: number;
  verdict: Verdict;
  explanation: string;
  factors: ScoringFactors;
}

/**
 * Discriminated union for comparison results.
 * Each variant contains only the fields relevant to that outcome.
 */
export type ComparisonResult =
  | ComparisonMatch
  | ComparisonDiff
  | ComparisonNoBaseline
  | ComparisonNoTest
  | ComparisonError;

/** Base fields present in all comparison results */
interface ComparisonBase {
  baseline: string;
  test: string;
  approved?: boolean;
}

/** Images match within threshold */
export interface ComparisonMatch extends ComparisonBase {
  reason: 'match';
  match: true;
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  phash?: PerceptualHashResult;
  diffPath?: string;
  matchReason?: 'exact' | 'tolerance';
}

/** Images differ - the primary case with full analysis data */
export interface ComparisonDiff extends ComparisonBase {
  reason: 'diff';
  match: false;
  diffPath: string;
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  sizeMismatchError?: string;
  phash?: PerceptualHashResult;
  aiAnalysis?: AIAnalysisResult;
  confidence?: ConfidenceResult;
  autoAction?: 'approve' | 'flag' | 'reject' | null;
  unifiedConfidence?: UnifiedConfidence;
  engineResults?: EngineResult[];
  domDiff?: DomDiffResult;
}

/** No baseline image exists (new test) */
export interface ComparisonNoBaseline extends ComparisonBase {
  reason: 'no-baseline';
  match: false;
  pixelDiff: 0;
  diffPercentage: 0;
}

/** No test image exists */
export interface ComparisonNoTest extends ComparisonBase {
  reason: 'no-test';
  match: false;
  pixelDiff: 0;
  diffPercentage: 0;
}

/** An error occurred during comparison */
export interface ComparisonError extends ComparisonBase {
  reason: 'error';
  match: false;
  pixelDiff: 0;
  diffPercentage: 0;
  error: string;
  ssimScore?: number;
  phash?: PerceptualHashResult;
}

/** Type guard to check if result is a diff */
export function isDiff(result: ComparisonResult): result is ComparisonDiff {
  return result.reason === 'diff';
}

/** Type guard to check if result is a match */
export function isMatch(result: ComparisonResult): result is ComparisonMatch {
  return result.reason === 'match';
}

/** Type guard to check if result has phash data */
export function hasPhash(
  result: ComparisonResult
): result is ComparisonResult & { phash: PerceptualHashResult } {
  return 'phash' in result && result.phash !== undefined;
}

/** Type guard to check if result has AI analysis */
export function hasAiAnalysis(
  result: ComparisonResult
): result is ComparisonDiff & { aiAnalysis: AIAnalysisResult } {
  return result.reason === 'diff' && result.aiAnalysis !== undefined;
}

/** Helper to get optional ssimScore from any result */
export function getSsimScore(result: ComparisonResult): number | undefined {
  return 'ssimScore' in result ? result.ssimScore : undefined;
}

/** Helper to get optional diffPath from result */
export function getDiffPath(result: ComparisonResult): string | undefined {
  if ('diffPath' in result && result.diffPath) return result.diffPath;
  return result.reason === 'diff' ? result.diffPath : undefined;
}

/** Helper to get error message if present */
export function getResultError(result: ComparisonResult): string | undefined {
  if (result.reason === 'error') return result.error;
  if (result.reason === 'diff') return result.sizeMismatchError;
  return undefined;
}
