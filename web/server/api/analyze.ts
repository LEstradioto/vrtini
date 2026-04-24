import type { FastifyPluginAsync } from 'fastify';
import { existsSync } from 'fs';
import {
  analyzeWithAI,
  analyzeMultiple,
  type AIAnalysisResult,
  type AIProvider,
} from '../../../src/ai-analysis.js';
import { getImagePath, type ImageType } from '../../../src/core/paths.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { requireProject } from '../plugins/project.js';
import { rateLimit } from '../plugins/rate-limit.js';
import { pickProviderFromEnv } from '../../../src/core/env.js';
import { ApiError, ValidationError } from '../../../src/core/api-errors.js';
import {
  PROVIDERS,
  getProviderStatuses,
  loadProjectAIConfig,
  validateProviderCredential,
  type LoadedAIConfig,
  type ValidateProviderBody,
} from '../services/ai-provider-service.js';

interface AnalyzeItem {
  baseline: { type: 'baseline' | 'test'; filename: string };
  test: { type: 'baseline' | 'test'; filename: string };
  diff?: { type: 'diff' | 'custom-diff'; filename: string };
  name?: string;
}

interface AnalyzeRequest {
  items: AnalyzeItem[];
}

interface AnalyzeResultItem {
  filename: string;
  analysis?: AIAnalysisResult;
  error?: string;
}

/** Build the options object passed to analyzeWithAI/analyzeMultiple. */
function toAnalysisOptions(provider: AIProvider, aiConfig: LoadedAIConfig | undefined) {
  return {
    provider,
    apiKey: aiConfig?.apiKey,
    authToken: aiConfig?.authToken,
    model: aiConfig?.model,
    baseUrl: aiConfig?.baseUrl,
    visionCompare: aiConfig?.visionCompare,
  };
}

export const analyzeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { id: string };
  }>('/projects/:id/analyze/providers', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const aiConfig = await loadProjectAIConfig(project.path, project.configFile);
    return {
      activeProvider: aiConfig?.provider ?? null,
      providers: getProviderStatuses(aiConfig),
    };
  });

  fastify.post<{
    Params: { id: string };
    Body: ValidateProviderBody;
  }>('/projects/:id/analyze/validate-provider', { preHandler: requireProject }, async (request) => {
    const provider = request.body?.provider;
    if (!provider || !PROVIDERS.includes(provider)) {
      throw new ValidationError(`provider must be one of: ${PROVIDERS.join(', ')}`);
    }
    return validateProviderCredential(request.body);
  });

  fastify.post<{
    Params: { id: string };
    Body: AnalyzeRequest;
  }>(
    '/projects/:id/analyze',
    { preHandler: [rateLimit({ max: 5, windowMs: 60_000 }), requireProject] },
    async (request) => {
      const project = request.project;
      const { items } = request.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new ValidationError('items array is required and must not be empty');
      }

      const aiConfig = await loadProjectAIConfig(project.path, project.configFile, {
        requireEnabled: true,
      });
      const provider = aiConfig?.provider || pickProviderFromEnv();

      if (!provider) {
        throw new ValidationError(
          'AI not configured. Set ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, OPENROUTER_API_KEY, or GOOGLE_API_KEY, or configure AI in project settings.'
        );
      }

      const resolvePath = (type: string, filename: string): string =>
        getImagePath(project.path, type as ImageType, filename);

      const results: AnalyzeResultItem[] = [];

      // Single-item path: return structured error on failure without blowing up the batch.
      if (items.length === 1) {
        const item = items[0];
        try {
          const baselinePath = resolvePath(item.baseline.type, item.baseline.filename);
          const testPath = resolvePath(item.test.type, item.test.filename);
          const diffPath = item.diff ? resolvePath(item.diff.type, item.diff.filename) : undefined;

          if (!existsSync(baselinePath)) {
            throw new Error(`Baseline image not found: ${item.baseline.filename}`);
          }
          if (!existsSync(testPath)) {
            throw new Error(`Test image not found: ${item.test.filename}`);
          }

          const analysis = await analyzeWithAI(baselinePath, testPath, diffPath, {
            ...toAnalysisOptions(provider, aiConfig),
            scenarioName: item.name || item.test.filename,
          });

          results.push({ filename: item.test.filename, analysis });
        } catch (err) {
          results.push({ filename: item.test.filename, error: getErrorMessage(err) });
        }
        return { results };
      }

      // Batch path: analyzeMultiple handles per-item errors internally.
      const comparisons = items.map((item) => ({
        baseline: resolvePath(item.baseline.type, item.baseline.filename),
        test: resolvePath(item.test.type, item.test.filename),
        diff: item.diff ? resolvePath(item.diff.type, item.diff.filename) : undefined,
        name: item.name || item.test.filename,
      }));

      try {
        const batchResults = await analyzeMultiple(
          comparisons,
          toAnalysisOptions(provider, aiConfig),
          3
        );

        for (const [name, result] of batchResults) {
          if (result instanceof Error) {
            results.push({ filename: name, error: result.message });
          } else {
            results.push({ filename: name, analysis: result });
          }
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError('internal', 500, 'Batch analysis failed', getErrorMessage(err));
      }

      return { results };
    }
  );
};
