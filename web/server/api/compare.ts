import { createReadStream } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { getErrorMessage } from '../../../src/core/errors.js';
import {
  compareImagesWithDiff,
  getCustomDiffPath,
  type CompareInput,
} from '../services/comparison-service.js';
import { loadConfig } from '../services/project-service.js';
import { requireProject } from '../plugins/project.js';

export interface CompareRequest {
  left: CompareInput;
  right: CompareInput;
  threshold?: number;
}

export const compareRoutes: FastifyPluginAsync = async (fastify) => {
  // Compare any two images and generate a diff
  fastify.post<{
    Params: { id: string };
    Body: CompareRequest;
  }>('/projects/:id/compare', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);

    const { left, right, threshold } = request.body;

    if (!left?.type || !left?.filename || !right?.type || !right?.filename) {
      reply.code(400);
      return {
        error: 'Invalid request. Required: left.type, left.filename, right.type, right.filename',
      };
    }

    try {
      const result = await compareImagesWithDiff(
        project.id,
        project.path,
        left,
        right,
        threshold,
        config as { baselineDir: string; outputDir: string }
      );
      return result;
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.includes('not found')) {
        reply.code(404);
        return { error: message };
      }
      reply.code(500);
      return { error: 'Comparison failed', details: message };
    }
  });

  // Serve custom diff images
  fastify.get<{
    Params: { id: string; filename: string };
  }>(
    '/projects/:id/images/custom-diff/:filename',
    { preHandler: requireProject },
    async (request, reply) => {
      const { filename } = request.params;
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
      const { config } = await loadConfig(project.path, project.configFile);

      const filepath = getCustomDiffPath(
        project.path,
        filename,
        config as { baselineDir: string; outputDir: string }
      );

      if (!filepath) {
        reply.code(404);
        return { error: 'Diff image not found' };
      }

      // Stream the file directly instead of using fastify-static sendFile
      // This avoids issues with custom root paths
      reply.type('image/png');
      return reply.send(createReadStream(filepath));
    }
  );
};
