import type { FastifyPluginAsync } from 'fastify';
import {
  loadConfig,
  saveConfig,
  getConfigSchemaInfo,
  listProjectProfiles,
} from '../services/project-service.js';
import { requireProject } from '../plugins/project.js';
import { ValidationError } from '../../../src/core/api-errors.js';

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
  }>('/projects/:id/config', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const result = await saveConfig(project.path, project.configFile, request.body.config);

    if (!result.success) {
      throw new ValidationError('Invalid config', { issues: result.errors });
    }

    return { success: true, config: result.config };
  });

  // List vrtini profiles (all vrtini*.config.json files) for a project
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/profiles',
    { preHandler: requireProject },
    async (request) => {
      const project = request.project;
      const profiles = await listProjectProfiles(project.path);
      return { profiles };
    }
  );

  // Get config schema info (for building forms)
  fastify.get('/schema', async () => {
    return getConfigSchemaInfo();
  });
};
