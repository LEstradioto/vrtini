import type { FastifyInstance } from 'fastify';
import { log } from '../../../src/core/logger.js';

/**
 * Optional bearer-token authentication.
 *
 * Activated only when the VRT_AUTH_TOKEN environment variable is set.
 * When active, every request must include `Authorization: Bearer <token>`.
 * Static assets and the health-check endpoint are exempt.
 */
export function registerAuth(fastify: FastifyInstance): void {
  const token = process.env.VRT_AUTH_TOKEN;
  if (!token) return;

  log.info('Authentication enabled — VRT_AUTH_TOKEN is set');

  fastify.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header || header !== `Bearer ${token}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
