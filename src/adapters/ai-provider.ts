/**
 * AI provider interface for visual analysis.
 * Implementations handle SDK-specific logic.
 */

import type { AIAnalysisResult, RawAIResponse } from '../domain/ai-prompt.js';

export type AIProviderName = 'anthropic' | 'openai' | 'openrouter' | 'google';

export interface ImageInput {
  baseline: string;
  test: string;
  diff: string | undefined;
}

export interface AnalysisRequest {
  images: ImageInput;
  prompt: string;
  model: string;
}

export interface AnalysisResponse {
  text: string;
  tokensUsed?: number;
}

export interface AIProvider {
  readonly name: AIProviderName;
  analyze(request: AnalysisRequest): Promise<AnalysisResponse>;
}

export function createAnalysisResult(
  parsed: RawAIResponse,
  providerName: AIProviderName,
  model: string,
  tokensUsed?: number
): AIAnalysisResult {
  return {
    ...parsed,
    provider: providerName,
    model,
    tokensUsed,
  };
}
