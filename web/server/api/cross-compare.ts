import type { FastifyPluginAsync } from 'fastify';
import { isAbsolute, relative, resolve, sep } from 'path';
import { requireProject } from '../plugins/project.js';
import { rateLimit } from '../plugins/rate-limit.js';
import { loadConfig } from '../services/project-service.js';
import type { VRTConfig } from '../../../src/core/config.js';
import {
  runCrossCompare,
  loadCrossReport,
  loadCrossResults,
  listCrossResults,
  setCrossAcceptance,
  revokeCrossAcceptance,
  setCrossFlag,
  revokeCrossFlag,
  clearCrossResults,
  deleteCrossItems,
} from '../services/cross-compare-service.js';
import {
  createCrossCompareJob,
  getCrossCompareJob,
  getCrossCompareJobStatus,
  startCrossCompareRun,
} from '../services/cross-compare-job-service.js';
import { NotFoundError, ValidationError } from '../../../src/core/api-errors.js';

function rewriteReportImageSources(
  html: string,
  projectId: string,
  projectPath: string,
  config: VRTConfig
): string {
  const baselineRoot = resolve(projectPath, config.baselineDir ?? '.vrtini/baselines');
  const outputRoot = resolve(projectPath, config.outputDir ?? '.vrtini/output');

  return html.replace(/src="([^"]+)"/g, (match, src) => {
    if (!src || src.startsWith('data:')) return match;
    if (!isAbsolute(src)) return match;

    const resolved = resolve(src);
    const allowed =
      resolved === baselineRoot ||
      resolved.startsWith(baselineRoot + sep) ||
      resolved === outputRoot ||
      resolved.startsWith(outputRoot + sep);

    if (!allowed) return match;

    const relPath = relative(projectPath, resolved);
    const url = `/api/projects/${projectId}/files?path=${encodeURIComponent(relPath)}`;
    return `src="${url}"`;
  });
}

function getJobForProject(jobId: string, projectId: string) {
  const job = getCrossCompareJob(jobId);
  if (!job || job.projectId !== projectId) {
    return null;
  }
  return job;
}

export const crossCompareRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { id: string };
    Body?: {
      key?: string;
      itemKeys?: string[];
      scenarios?: string[];
      viewports?: string[];
      resetAcceptances?: boolean;
      async?: boolean;
    };
  }>(
    '/projects/:id/cross-compare',
    { preHandler: [rateLimit({ max: 3, windowMs: 60_000 }), requireProject] },
    async (request, reply) => {
      const project = request.project;
      const { config } = await loadConfig(project.path, project.configFile);
      try {
        const options = {
          key: request.body?.key,
          itemKeys: request.body?.itemKeys,
          scenarios: request.body?.scenarios,
          viewports: request.body?.viewports,
          resetAcceptances: request.body?.resetAcceptances,
        };
        if (request.body?.async) {
          const job = createCrossCompareJob(project.id);
          void startCrossCompareRun(job, project.path, config as VRTConfig, options);
          reply.code(202);
          return reply.send({
            jobId: job.id,
            status: job.status,
            phase: job.phase,
            progress: job.progress,
            total: job.total,
            pairIndex: job.pairIndex,
            pairTotal: job.pairTotal,
            currentPairKey: job.currentPairKey,
            currentPairTitle: job.currentPairTitle,
            startedAt: job.startedAt,
          });
        }

        const reports = await runCrossCompare(
          project.id,
          project.path,
          config as VRTConfig,
          options
        );
        return reply.send({ reports });
      } catch (err) {
        if (err instanceof Error) throw new ValidationError(err.message);
        throw new ValidationError('Cross compare failed');
      }
    }
  );

  fastify.get<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/cross-compare-jobs/:jobId',
    { preHandler: requireProject },
    async (request, reply) => {
      const job = getJobForProject(request.params.jobId, request.params.id);
      if (!job) throw new NotFoundError('Job not found');

      // Snapshot is a discriminated union by status; returning it directly
      // serializes the right shape per status (error/completedAt only on
      // failed/completed). The previous explicit re-spread would leak a
      // `error: undefined` field on running jobs.
      return reply.send(getCrossCompareJobStatus(job));
    }
  );

  fastify.get<{ Params: { id: string; key: string } }>(
    '/projects/:id/cross-reports/:key',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { config } = await loadConfig(project.path, project.configFile);
      const html = await loadCrossReport(project.path, config as VRTConfig, request.params.key);
      const rewritten = rewriteReportImageSources(
        html,
        project.id,
        project.path,
        config as VRTConfig
      );
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(rewritten);
    }
  );

  fastify.get<{ Params: { id: string; key: string } }>(
    '/projects/:id/cross-results/:key',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { config } = await loadConfig(project.path, project.configFile);
      const results = await loadCrossResults(project.path, config as VRTConfig, request.params.key);
      return reply.send({ results });
    }
  );

  fastify.delete<{ Params: { id: string; key: string } }>(
    '/projects/:id/cross-results/:key',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { config } = await loadConfig(project.path, project.configFile);
      await clearCrossResults(project.path, config as VRTConfig, request.params.key);
      return reply.send({ success: true });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { key: string; itemKeys: string[] };
  }>('/projects/:id/cross-delete', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    const { key, itemKeys } = request.body;
    if (!key || !Array.isArray(itemKeys) || itemKeys.length === 0) {
      throw new ValidationError('key and itemKeys are required');
    }
    const { config } = await loadConfig(project.path, project.configFile);
    const result = await deleteCrossItems(project.path, config as VRTConfig, key, itemKeys);
    return reply.send({ success: true, ...result });
  });

  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/cross-results',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { config } = await loadConfig(project.path, project.configFile);
      const results = await listCrossResults(project.path, config as VRTConfig);
      return reply.send({ results });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { key: string; itemKey: string; reason?: string };
  }>('/projects/:id/cross-accept', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    const { key, itemKey, reason } = request.body;
    if (!key || !itemKey) {
      throw new ValidationError('key and itemKey are required');
    }
    // Keep accept path fast: we persist to acceptances store only.
    // Cross results are enriched from acceptances at read-time.
    const record = await setCrossAcceptance(project.path, key, itemKey, reason);
    return reply.send({ success: true, acceptance: { itemKey, ...record } });
  });

  fastify.delete<{ Params: { id: string; key: string; itemKey: string } }>(
    '/projects/:id/cross-accept/:key/:itemKey',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { key, itemKey } = request.params;
      // Keep revoke path fast; avoid rewriting large results.json payloads.
      const revoked = await revokeCrossAcceptance(project.path, key, itemKey);
      return reply.send({ success: revoked });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { key: string; itemKey: string; reason?: string };
  }>('/projects/:id/cross-flag', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    const { key, itemKey, reason } = request.body;
    if (!key || !itemKey) {
      throw new ValidationError('key and itemKey are required');
    }
    // Keep flag path fast: persist flag store only.
    const record = await setCrossFlag(project.path, key, itemKey, reason);
    return reply.send({ success: true, flag: { itemKey, ...record } });
  });

  fastify.delete<{ Params: { id: string; key: string; itemKey: string } }>(
    '/projects/:id/cross-flag/:key/:itemKey',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      const { key, itemKey } = request.params;
      // Keep unflag path fast; avoid rewriting large results payload.
      const revoked = await revokeCrossFlag(project.path, key, itemKey);
      return reply.send({ success: revoked });
    }
  );
};
