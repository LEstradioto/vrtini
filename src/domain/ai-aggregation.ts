/**
 * Aggregation of per-chunk AI analyses into a single verdict.
 * Pure — no I/O, no provider calls. The orchestrator (ai-analysis.ts)
 * runs N chunk analyses in parallel, then funnels the results here.
 */

import type { AIAnalysisResult, ChangeCategory, Recommendation, Severity } from './ai-prompt.js';
import type { VisionChunk } from './vision-chunking.js';

const RECOMMENDATION_SCORES: Record<Recommendation, number> = {
  approve: 1,
  review: 0,
  reject: -1,
};

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const APPROVE_THRESHOLD = 0.35;
const REJECT_THRESHOLD = -0.35;
const MAX_DETAIL_LINES = 12;

export interface ChunkAnalysis {
  chunk: VisionChunk;
  analysis: AIAnalysisResult;
}

/**
 * Combine per-chunk analyses into one weighted verdict. Single-chunk
 * input passes through unchanged. Multi-chunk:
 *  - confidence-weighted average of recommendation scores
 *  - approve only when no chunk rejected and average ≥ +0.35
 *  - reject when ≥ half rejected OR average ≤ −0.35
 *  - approve downgrades to review if any chunk reported `critical` severity
 *  - chosen category is the one with highest summed confidence
 */
export function aggregateChunkAnalyses(
  chunks: ChunkAnalysis[],
  provider: string,
  model: string,
  verticalOffset: number
): AIAnalysisResult {
  if (chunks.length === 1) return chunks[0].analysis;

  let weightedScore = 0;
  let weightedTotal = 0;
  let confidenceSum = 0;
  let tokensUsed = 0;
  let highestSeverity: Severity = 'info';
  let rejectCount = 0;

  const categoryWeights = new Map<ChangeCategory, number>();
  const detailLines: string[] = [];

  for (const { chunk, analysis } of chunks) {
    const confidence = Math.max(0, Math.min(1, analysis.confidence));
    weightedScore += (RECOMMENDATION_SCORES[analysis.recommendation] ?? 0) * confidence;
    weightedTotal += confidence;
    confidenceSum += confidence;
    tokensUsed += analysis.tokensUsed ?? 0;
    if (analysis.recommendation === 'reject') rejectCount += 1;
    if (SEVERITY_RANK[analysis.severity] > SEVERITY_RANK[highestSeverity]) {
      highestSeverity = analysis.severity;
    }
    categoryWeights.set(
      analysis.category,
      (categoryWeights.get(analysis.category) ?? 0) + confidence
    );
    detailLines.push(
      `Chunk ${chunk.index}: ${analysis.recommendation} (${(confidence * 100).toFixed(0)}%) - ${analysis.summary}`
    );
  }

  const averageScore = weightedTotal > 0 ? weightedScore / weightedTotal : 0;
  const avgConfidence = chunks.length > 0 ? confidenceSum / chunks.length : 0;
  let recommendation: Recommendation = 'review';
  if (averageScore >= APPROVE_THRESHOLD && rejectCount === 0) recommendation = 'approve';
  else if (averageScore <= REJECT_THRESHOLD || rejectCount >= Math.ceil(chunks.length / 2)) {
    recommendation = 'reject';
  }
  if (recommendation === 'approve' && highestSeverity === 'critical') recommendation = 'review';

  let category: ChangeCategory = 'layout_shift';
  let bestCategoryWeight = -1;
  for (const [candidate, weight] of categoryWeights.entries()) {
    if (weight > bestCategoryWeight) {
      bestCategoryWeight = weight;
      category = candidate;
    }
  }

  const approveCount = chunks.filter((entry) => entry.analysis.recommendation === 'approve').length;
  const reviewCount = chunks.filter((entry) => entry.analysis.recommendation === 'review').length;
  const rejectChunks = chunks.length - approveCount - reviewCount;
  const summary =
    recommendation === 'approve'
      ? `Chunked AI compare approved (${approveCount}/${chunks.length} chunks).`
      : recommendation === 'reject'
        ? `Chunked AI compare rejected (${rejectChunks}/${chunks.length} chunks signaled reject).`
        : `Chunked AI compare requires review (approve:${approveCount}, review:${reviewCount}, reject:${rejectChunks}).`;

  return {
    category,
    severity: highestSeverity,
    confidence: Number(avgConfidence.toFixed(2)),
    summary,
    details: detailLines.slice(0, MAX_DETAIL_LINES),
    recommendation,
    reasoning: `Aggregated from ${chunks.length} vertically aligned chunks (offset ${verticalOffset}px). Weighted score ${averageScore.toFixed(3)}.`,
    provider,
    model,
    tokensUsed,
  };
}
