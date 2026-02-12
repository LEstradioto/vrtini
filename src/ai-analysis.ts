import { existsSync } from 'fs';
import {
  buildAnalysisPrompt,
  parseAIResponse,
  type AIAnalysisResult,
  type ChangeCategory,
  type Severity,
  type Recommendation,
  type DomDiffContext,
} from './domain/ai-prompt.js';
import {
  type AIProvider,
  type AIProviderName,
  createAnalysisResult,
  createAnthropicProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createGoogleProvider,
} from './adapters/index.js';

export type { AIAnalysisResult, ChangeCategory, Severity, Recommendation };
export type { AIProviderName as AIProvider };

export interface AIAnalysisOptions {
  provider: AIProviderName;
  apiKey?: string;
  authToken?: string;
  model?: string;
  baseUrl?: string;
  scenarioName?: string;
  url?: string;
  pixelDiff?: number;
  diffPercentage?: number;
  ssimScore?: number;
  domDiff?: DomDiffContext;
}

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  anthropic: 'claude-haiku-4-5-20241022',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-3-flash-preview',
  google: 'gemini-3-flash',
};

function ensureFileExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} image not found: ${path}`);
  }
}

function resolveModel(options: AIAnalysisOptions): string {
  return options.model || DEFAULT_MODELS[options.provider];
}

function getProvider(options: AIAnalysisOptions): AIProvider {
  switch (options.provider) {
    case 'anthropic':
      return createAnthropicProvider({ apiKey: options.apiKey, authToken: options.authToken });
    case 'openai':
      return createOpenAIProvider({ apiKey: options.apiKey });
    case 'openrouter':
      return createOpenRouterProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    case 'google':
      return createGoogleProvider({ apiKey: options.apiKey });
    default:
      throw new Error(`Unsupported AI provider: ${options.provider}`);
  }
}

/**
 * Analyze visual differences between two screenshots using AI vision.
 */
export async function analyzeWithAI(
  baselinePath: string,
  testPath: string,
  diffPath: string | undefined,
  options: AIAnalysisOptions
): Promise<AIAnalysisResult> {
  ensureFileExists(baselinePath, 'Baseline');
  ensureFileExists(testPath, 'Test');

  const provider = getProvider(options);
  const model = resolveModel(options);
  const prompt = buildAnalysisPrompt(options);

  const response = await provider.analyze({
    images: {
      baseline: baselinePath,
      test: testPath,
      diff: diffPath && existsSync(diffPath) ? diffPath : undefined,
    },
    prompt,
    model,
  });

  const parsed = parseAIResponse(response.text);
  return createAnalysisResult(parsed, options.provider, model, response.tokensUsed);
}

/**
 * Batch analyze multiple image pairs.
 * Processes in parallel with concurrency limit.
 */
export async function analyzeMultiple(
  comparisons: {
    baseline: string;
    test: string;
    diff?: string;
    name: string;
  }[],
  options: AIAnalysisOptions,
  concurrency = 3
): Promise<Map<string, AIAnalysisResult | Error>> {
  const results = new Map<string, AIAnalysisResult | Error>();

  for (let i = 0; i < comparisons.length; i += concurrency) {
    const batch = comparisons.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((comp) =>
        analyzeWithAI(comp.baseline, comp.test, comp.diff, {
          ...options,
          scenarioName: comp.name,
        })
      )
    );

    for (let idx = 0; idx < batchResults.length; idx += 1) {
      const settled = batchResults[idx];
      const name = batch[idx]?.name || 'unknown';
      if (settled.status === 'fulfilled') {
        results.set(name, settled.value);
      } else {
        results.set(name, new Error(settled.reason?.message || 'Unknown error'));
      }
    }
  }

  return results;
}
