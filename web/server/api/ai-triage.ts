import type { FastifyPluginAsync } from 'fastify';
import { resolve } from 'path';
import { requireProject } from '../plugins/project.js';
import { loadConfig } from '../services/project-service.js';
import type { VRTConfig } from '../../../src/core/config.js';
import {
  loadCrossResults,
  saveCrossItemAIResults,
} from '../services/cross-compare-service.js';
import { analyzeWithAI, type AIAnalysisOptions } from '../../../src/ai-analysis.js';
import type { AIAnalysisResult } from '../../../src/domain/ai-prompt.js';

export const aiTriageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { id: string; key: string };
    Body?: { itemKeys?: string[] };
  }>(
    '/projects/:id/cross-compare/:key/ai-triage',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const { key } = request.params;
      const { config } = await loadConfig(project.path, project.configFile);
      const vrtConfig = config as VRTConfig;

      const aiConfig = vrtConfig.ai;
      if (!aiConfig?.enabled) {
        reply.code(400);
        return { error: 'AI analysis is not enabled in config' };
      }

      const crossResults = await loadCrossResults(project.path, vrtConfig, key);
      const requestedKeys = request.body?.itemKeys;
      const targetItems = requestedKeys?.length
        ? crossResults.items.filter(
            (item) => requestedKeys.includes(item.itemKey ?? `${item.scenario}__${item.viewport}`)
          )
        : crossResults.items;

      if (targetItems.length === 0) {
        reply.code(400);
        return { error: 'No items matched the provided keys' };
      }

      const options: AIAnalysisOptions = {
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        authToken: aiConfig.authToken,
        model: aiConfig.model,
        baseUrl: (aiConfig as Record<string, unknown>).baseUrl as string | undefined,
      };

      const results: { itemKey: string; analysis?: AIAnalysisResult; error?: string }[] = [];
      const updates = new Map<string, AIAnalysisResult>();
      const concurrency = 3;

      for (let i = 0; i < targetItems.length; i += concurrency) {
        const batch = targetItems.slice(i, i + concurrency);
        const settled = await Promise.allSettled(
          batch.map((item) => {
            const baselinePath = resolve(project.path, item.baseline);
            const testPath = resolve(project.path, item.test);
            const diffPath = item.diff ? resolve(project.path, item.diff) : undefined;
            return analyzeWithAI(baselinePath, testPath, diffPath, {
              ...options,
              scenarioName: item.scenario,
              diffPercentage: item.diffPercentage,
              pixelDiff: item.pixelDiff,
              ssimScore: item.ssimScore,
            });
          })
        );

        for (let j = 0; j < settled.length; j++) {
          const item = batch[j];
          const itemKey = item.itemKey ?? `${item.scenario}__${item.viewport}`;
          const result = settled[j];

          if (result.status === 'fulfilled') {
            results.push({ itemKey, analysis: result.value });
            updates.set(itemKey, result.value);
          } else {
            results.push({
              itemKey,
              error: result.reason?.message || 'Analysis failed',
            });
          }
        }
      }

      // Persist AI results to the results.json file
      if (updates.size > 0) {
        await saveCrossItemAIResults(project.path, vrtConfig, key, updates);
      }

      return reply.send({ results });
    }
  );
};
