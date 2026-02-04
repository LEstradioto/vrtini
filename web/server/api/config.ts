import type { FastifyPluginAsync } from 'fastify';
import { loadConfig, saveConfig, getConfigSchemaInfo } from '../services/project-service.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { requireProject } from '../plugins/project.js';

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // Get project config
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/config',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      try {
        const result = await loadConfig(project.path, project.configFile);
        return result;
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.includes('not found')) {
          reply.code(404);
          return { error: 'Config file not found', path: message };
        }
        reply.code(500);
        return { error: 'Failed to read config', details: message };
      }
    }
  );

  // Update project config
  fastify.put<{
    Params: { id: string };
    Body: { config: unknown };
  }>('/projects/:id/config', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    try {
      const result = await saveConfig(project.path, project.configFile, request.body.config);

      if (!result.success) {
        reply.code(400);
        return { error: 'Invalid config', issues: result.errors };
      }

      return { success: true, config: result.config };
    } catch (err) {
      reply.code(500);
      return { error: 'Failed to save config', details: getErrorMessage(err) };
    }
  });

  // Get config schema info (for building forms)
  fastify.get('/schema', async () => {
    return getConfigSchemaInfo();
  });
};
