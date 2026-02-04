/**
 * Pure AI prompt/response handling functions (no I/O, no API calls).
 */

export type ChangeCategory =
  | 'regression'
  | 'cosmetic'
  | 'content_change'
  | 'layout_shift'
  | 'noise';

export type Severity = 'critical' | 'warning' | 'info';
export type Recommendation = 'approve' | 'review' | 'reject';

export interface AIAnalysisResult {
  category: ChangeCategory;
  severity: Severity;
  confidence: number;
  summary: string;
  details: string[];
  recommendation: Recommendation;
  reasoning: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

export interface PromptContext {
  url?: string;
  scenarioName?: string;
  pixelDiff?: number;
  diffPercentage?: number;
  ssimScore?: number;
}

export function buildContextLines(ctx: PromptContext): string[] {
  const lines: string[] = [];
  if (ctx.url) lines.push(`URL: ${ctx.url}`);
  if (ctx.scenarioName) lines.push(`Scenario: ${ctx.scenarioName}`);
  if (ctx.pixelDiff !== undefined) lines.push(`Pixel diff: ${ctx.pixelDiff} pixels`);
  if (ctx.diffPercentage !== undefined)
    lines.push(`Diff percentage: ${ctx.diffPercentage.toFixed(2)}%`);
  if (ctx.ssimScore !== undefined) lines.push(`SSIM score: ${(ctx.ssimScore * 100).toFixed(1)}%`);
  return lines;
}

export function buildAnalysisPrompt(ctx: PromptContext): string {
  const contextLines = buildContextLines(ctx);

  return `You are a visual regression testing assistant analyzing UI screenshots for changes.

You are comparing:
- IMAGE 1: Baseline (the approved/expected state)
- IMAGE 2: Current test (the new screenshot to evaluate)
- IMAGE 3: Pixel diff (highlights where pixels differ, if provided)

${contextLines.length > 0 ? `Context:\n${contextLines.join('\n')}` : ''}

Analyze the differences and respond with ONLY a valid JSON object (no markdown, no explanation outside JSON):

{
  "category": "regression" | "cosmetic" | "content_change" | "layout_shift" | "noise",
  "severity": "critical" | "warning" | "info",
  "confidence": <number between 0.0 and 1.0>,
  "summary": "<one sentence describing the key change>",
  "details": ["<specific change 1>", "<specific change 2>", ...],
  "recommendation": "approve" | "review" | "reject",
  "reasoning": "<why you made this recommendation>"
}

Category definitions:
- regression: Unintended visual bug (broken layout, missing elements, rendering errors)
- cosmetic: Minor visual difference unlikely to affect UX (font rendering, anti-aliasing, subpixel differences)
- content_change: Text or image content that changed (may be intentional)
- layout_shift: Spacing, positioning, or size changes (may be intentional redesign)
- noise: Non-deterministic differences (animation frames, timestamps, cursors, loading states)

Severity guidelines:
- critical: Broken functionality, missing important elements, major layout issues
- warning: Noticeable changes that may or may not be intentional
- info: Minor changes unlikely to impact user experience

Recommendation guidelines:
- approve: Safe to auto-approve (cosmetic/noise with high confidence)
- review: Human should look at this (content changes, uncertain cases)
- reject: Likely a regression that needs fixing`;
}

export interface RawAIResponse {
  category: ChangeCategory;
  severity: Severity;
  confidence: number;
  summary: string;
  details: string[];
  recommendation: Recommendation;
  reasoning: string;
}

/**
 * Extract JSON from AI response text, handling markdown code blocks.
 */
export function extractJsonFromResponse(responseText: string): string {
  const trimmed = responseText.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return jsonMatch ? jsonMatch[1] : trimmed;
}

/**
 * Parse AI response text into structured result.
 * Throws if JSON is invalid.
 */
export function parseAIResponse(responseText: string): RawAIResponse {
  const jsonText = extractJsonFromResponse(responseText);
  try {
    return JSON.parse(jsonText) as RawAIResponse;
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${jsonText.slice(0, 200)}...`);
  }
}

/**
 * Map raw AI response to full result with provider metadata.
 */
export function buildAnalysisResult(
  raw: RawAIResponse,
  provider: string,
  model: string,
  tokensUsed?: number
): AIAnalysisResult {
  return {
    ...raw,
    provider,
    model,
    tokensUsed,
  };
}
