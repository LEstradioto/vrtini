import type { FastifyPluginAsync } from 'fastify';
import {
  loadConfig,
  saveConfig,
  getConfigSchemaInfo,
  listProjectProfiles,
} from '../services/project-service.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { requireProject } from '../plugins/project.js';

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // Get project config
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/config',
    { preHandler: requireProject },
    async (request) => {
      const project = request.project;
      return loadConfig(project.path, project.configFile);
    }
  );

  // Update project config
  fastify.put<{
    Params: { id: string };
    Body: { config: unknown };
  }>('/projects/:id/config', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
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

  // List vrtini profiles (all vrtini*.config.json files) for a project
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/profiles',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      try {
        const profiles = await listProjectProfiles(project.path);
        return { profiles };
      } catch (err) {
        reply.code(500);
        return { error: 'Failed to list profiles', details: getErrorMessage(err) };
      }
    }
  );

  // Get config schema info (for building forms)
  fastify.get('/schema', async () => {
    return getConfigSchemaInfo();
  });
};
