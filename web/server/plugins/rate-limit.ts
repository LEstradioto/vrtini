import type { FastifyReply, FastifyRequest } from 'fastify';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitOptions {
  /** Max requests allowed in the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
}

const buckets = new Map<string, TokenBucket>();

// Clean up stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 600_000) {
      buckets.delete(key);
    }
  }
}, 300_000).unref();

function consume(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: max, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / windowMs) * max;
  bucket.tokens = Math.min(max, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // Time until one token is available
  const retryAfterMs = Math.ceil(((1 - bucket.tokens) / max) * windowMs);
  return { allowed: false, retryAfterMs };
}

/**
 * Creates a Fastify preHandler that rate-limits requests.
 * Keyed by client IP + route path.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = request.ip;
    const key = `${ip}:${request.routeOptions.url}`;
    const { allowed, retryAfterMs } = consume(key, opts.max, opts.windowMs);

    if (!allowed) {
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      reply.code(429).send({
        error: 'Too many requests',
        retryAfterMs,
      });
    }
  };
}
