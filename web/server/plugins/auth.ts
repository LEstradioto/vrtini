import type { FastifyInstance } from 'fastify';
import { log } from '../../../src/core/logger.js';

function isLoopbackRemote(remoteAddress?: string): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  );
}

/**
 * Optional bearer-token authentication for API routes.
 *
 * Activated only when the VRT_AUTH_TOKEN environment variable is set.
 * API requests from non-loopback clients must include:
 *   Authorization: Bearer <token>
 */
export function registerAuth(fastify: FastifyInstance): void {
  const token = process.env.VRT_AUTH_TOKEN?.trim();
  if (!token) return;

  log.info('Authentication enabled — VRT_AUTH_TOKEN is set');

  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api')) return;
    if (isLoopbackRemote(request.ip)) return;
    const header = request.headers.authorization;
    if (!header || header !== `Bearer ${token}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
