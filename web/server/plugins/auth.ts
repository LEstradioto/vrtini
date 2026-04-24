import { timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { log } from '../../../src/core/logger.js';
import { readAuthToken } from '../../../src/core/env.js';

/**
 * Check loopback against the raw socket address, not `request.ip`. Fastify's
 * `request.ip` honors `X-Forwarded-For` when `trustProxy` is set — we keep the
 * check on `socket.remoteAddress` so the auth short-circuit can't be spoofed
 * by an attacker even if someone later enables `trustProxy`.
 */
function isLoopbackSocket(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  );
}

/**
 * Constant-time comparison of two strings (prevents timing-based token probe).
 * Equal-length requirement is enforced before the compare to avoid leaking
 * length via timingSafeEqual's fast-path.
 */
function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Optional bearer-token authentication for API routes.
 *
 * Activated only when the VRT_AUTH_TOKEN environment variable is set.
 * API requests from non-loopback clients must include:
 *   Authorization: Bearer <token>
 */
export function registerAuth(fastify: FastifyInstance): void {
  const token = readAuthToken();
  if (!token) return;

  const expectedHeader = `Bearer ${token}`;
  log.info('Authentication enabled — VRT_AUTH_TOKEN is set');

  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api')) return;
    if (isLoopbackSocket(request.socket.remoteAddress)) return;
    const header = request.headers.authorization;
    if (!header || !safeEqualString(header, expectedHeader)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
