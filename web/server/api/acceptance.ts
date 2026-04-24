import type { FastifyPluginAsync } from 'fastify';
import {
  loadAcceptances,
  acceptancesToMap,
  createAcceptance,
  revokeAcceptance,
  type Acceptance,
  type AcceptanceMetrics,
  type AcceptanceSignals,
} from '../services/project-service.js';
import { requireProject } from '../plugins/project.js';
import { NotFoundError, ValidationError } from '../../../src/core/api-errors.js';

export type { Acceptance, AcceptanceMetrics };

export const acceptanceRoutes: FastifyPluginAsync = async (fastify) => {
  // List all acceptances
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/acceptances',
    { preHandler: requireProject },
    async (request) => {
      const project = request.project;
      const acceptances = await loadAcceptances(project.path);

      return {
        acceptances,
        acceptanceMap: acceptancesToMap(acceptances),
      };
    }
  );

  // Create an acceptance
  fastify.post<{
    Params: { id: string };
    Body: {
      filename: string;
      reason?: string;
      comparedAgainst: {
        filename: string;
        type: 'baseline' | 'test';
      };
      metrics: AcceptanceMetrics;
      signals?: AcceptanceSignals;
    };
  }>('/projects/:id/accept', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { filename, reason, comparedAgainst, metrics, signals } = request.body;

    if (!filename) throw new ValidationError('filename is required');
    if (!comparedAgainst?.filename || !comparedAgainst?.type) {
      throw new ValidationError('comparedAgainst.filename and comparedAgainst.type are required');
    }
    if (!metrics || metrics.diffPercentage === undefined) {
      throw new ValidationError('metrics.diffPercentage is required');
    }

    const acceptance = await createAcceptance(project.path, {
      filename,
      reason,
      comparedAgainst,
      metrics,
      signals,
    });

    return { success: true, acceptance };
  });

  // Revoke an acceptance
  fastify.delete<{
    Params: { id: string; filename: string };
  }>('/projects/:id/accept/:filename', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { filename } = request.params;
    const revoked = await revokeAcceptance(project.path, decodeURIComponent(filename));

    if (!revoked) throw new NotFoundError('Acceptance not found');

    return { success: true, revoked: filename };
  });
};
