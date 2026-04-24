import { createReadStream } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import {
  compareImagesWithDiff,
  getCustomDiffPath,
  type CompareInput,
} from '../services/comparison-service.js';
import { loadConfig } from '../services/project-service.js';
import { requireProject } from '../plugins/project.js';
import { NotFoundError, ValidationError } from '../../../src/core/api-errors.js';

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
  }>('/projects/:id/compare', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { config } = await loadConfig(project.path, project.configFile);

    const { left, right, threshold } = request.body;

    if (!left?.type || !left?.filename || !right?.type || !right?.filename) {
      throw new ValidationError(
        'Invalid request. Required: left.type, left.filename, right.type, right.filename'
      );
    }

    return compareImagesWithDiff(
      project.id,
      project.path,
      left,
      right,
      threshold,
      config as { baselineDir: string; outputDir: string }
    );
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
      const { config } = await loadConfig(project.path, project.configFile);

      const filepath = getCustomDiffPath(
        project.path,
        filename,
        config as { baselineDir: string; outputDir: string }
      );

      if (!filepath) throw new NotFoundError('Diff image not found');

      // Stream the file directly instead of using fastify-static sendFile
      // This avoids issues with custom root paths
      reply.type('image/png');
      return reply.send(createReadStream(filepath));
    }
  );
};
