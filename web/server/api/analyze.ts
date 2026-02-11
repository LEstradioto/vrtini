import type { FastifyPluginAsync } from 'fastify';
import { existsSync } from 'fs';
import {
  analyzeWithAI,
  analyzeMultiple,
  type AIAnalysisResult,
  type AIProvider,
} from '../../../src/core/ai-analysis.js';
import { getImagePath, type ImageType } from '../../../src/core/paths.js';
import { loadProjectConfig } from '../../../src/core/config-manager.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { requireProject } from '../plugins/project.js';
import { rateLimit } from '../plugins/rate-limit.js';

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

function resolveProvider(): AIProvider | null {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export const analyzeRoutes: FastifyPluginAsync = async (fastify) => {
  // Analyze images using AI
  fastify.post<{
    Params: { id: string };
    Body: AnalyzeRequest;
  }>(
    '/projects/:id/analyze',
    { preHandler: [rateLimit({ max: 5, windowMs: 60_000 }), requireProject] },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const { items } = request.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        reply.code(400);
        return { error: 'items array is required and must not be empty' };
      }

      // Load project config to get AI settings
      let aiConfig:
        | { provider: AIProvider; apiKey?: string; authToken?: string; model?: string }
        | undefined;

      try {
        const config = await loadProjectConfig(project.path, project.configFile);
        if (config.ai?.enabled && config.ai?.provider) {
          aiConfig = {
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            authToken: config.ai.authToken,
            model: config.ai.model,
          };
        }
      } catch {
        // Ignore config errors, will check for API keys in env
      }

      // Check if AI is configured
      const provider = aiConfig?.provider || resolveProvider();

      if (!provider) {
        reply.code(400);
        return {
          error:
            'AI not configured. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN (Claude Max), or OPENAI_API_KEY, or configure AI in project settings.',
        };
      }

      // Helper to resolve paths using the project path
      const resolvePath = (type: string, filename: string): string =>
        getImagePath(project.path, type as ImageType, filename);

      const results: AnalyzeResultItem[] = [];

      // Single item analysis
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
            provider: provider as AIProvider,
            apiKey: aiConfig?.apiKey,
            authToken: aiConfig?.authToken,
            model: aiConfig?.model,
            scenarioName: item.name || item.test.filename,
          });

          results.push({
            filename: item.test.filename,
            analysis,
          });
        } catch (err) {
          results.push({
            filename: item.test.filename,
            error: getErrorMessage(err),
          });
        }

        return { results };
      }

      // Batch analysis with concurrency
      const comparisons = items.map((item) => ({
        baseline: resolvePath(item.baseline.type, item.baseline.filename),
        test: resolvePath(item.test.type, item.test.filename),
        diff: item.diff ? resolvePath(item.diff.type, item.diff.filename) : undefined,
        name: item.name || item.test.filename,
      }));

      try {
        const batchResults = await analyzeMultiple(
          comparisons,
          {
            provider: provider as AIProvider,
            apiKey: aiConfig?.apiKey,
            authToken: aiConfig?.authToken,
            model: aiConfig?.model,
          },
          3 // concurrency
        );

        for (const [name, result] of batchResults) {
          if (result instanceof Error) {
            results.push({
              filename: name,
              error: result.message,
            });
          } else {
            results.push({
              filename: name,
              analysis: result,
            });
          }
        }
      } catch (err) {
        reply.code(500);
        return { error: 'Batch analysis failed', details: getErrorMessage(err) };
      }

      return { results };
    }
  );
};
