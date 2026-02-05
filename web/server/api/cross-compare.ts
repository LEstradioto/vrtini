import type { FastifyPluginAsync } from 'fastify';
import { isAbsolute, relative, resolve, sep } from 'path';
import { requireProject } from '../plugins/project.js';
import { loadConfig } from '../services/project-service.js';
import type { VRTConfig } from '../../../src/core/config.js';
import {
  runCrossCompare,
  loadCrossReport,
  loadCrossResults,
  listCrossResults,
  setCrossAcceptance,
  revokeCrossAcceptance,
  clearCrossResults,
  deleteCrossItems,
} from '../services/cross-compare-service.js';

function rewriteReportImageSources(
  html: string,
  projectId: string,
  projectPath: string,
  config: VRTConfig
): string {
  const baselineRoot = resolve(projectPath, config.baselineDir ?? '.vrt/baselines');
  const outputRoot = resolve(projectPath, config.outputDir ?? '.vrt/output');

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

export const crossCompareRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { id: string };
    Body?: { key?: string; itemKeys?: string[]; scenarios?: string[]; viewports?: string[] };
  }>('/projects/:id/cross-compare', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);
    const reports = await runCrossCompare(project.id, project.path, config as VRTConfig, {
      key: request.body?.key,
      itemKeys: request.body?.itemKeys,
      scenarios: request.body?.scenarios,
      viewports: request.body?.viewports,
    });
    return reply.send({ reports });
  });

  fastify.get<{ Params: { id: string; key: string } }>(
    '/projects/:id/cross-reports/:key',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
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
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
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
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
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
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { key, itemKeys } = request.body;
    if (!key || !Array.isArray(itemKeys) || itemKeys.length === 0) {
      reply.code(400);
      return { error: 'key and itemKeys are required' };
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
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
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
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { key, itemKey, reason } = request.body;
    if (!key || !itemKey) {
      reply.code(400);
      return { error: 'key and itemKey are required' };
    }
    const { config } = await loadConfig(project.path, project.configFile);
    const record = await setCrossAcceptance(
      project.path,
      key,
      itemKey,
      reason,
      config as VRTConfig
    );
    return reply.send({ success: true, acceptance: { itemKey, ...record } });
  });

  fastify.delete<{ Params: { id: string; key: string; itemKey: string } }>(
    '/projects/:id/cross-accept/:key/:itemKey',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
      const { key, itemKey } = request.params;
      const { config } = await loadConfig(project.path, project.configFile);
      const revoked = await revokeCrossAcceptance(project.path, key, itemKey, config as VRTConfig);
      return reply.send({ success: revoked });
    }
  );
};
