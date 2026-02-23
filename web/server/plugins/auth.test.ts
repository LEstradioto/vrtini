import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAuth } from './auth.js';

const originalToken = process.env.VRT_AUTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.VRT_AUTH_TOKEN;
  } else {
    process.env.VRT_AUTH_TOKEN = originalToken;
  }
});

describe('registerAuth', () => {
  it('rejects non-loopback API requests without bearer token when enabled', async () => {
    process.env.VRT_AUTH_TOKEN = 'secret-token';
    const fastify = Fastify({ logger: false });
    registerAuth(fastify);
    fastify.get('/api/ping', async () => ({ ok: true }));
    await fastify.ready();

    const unauthorized = await fastify.inject({
      method: 'GET',
      url: '/api/ping',
      remoteAddress: '10.0.0.42',
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await fastify.inject({
      method: 'GET',
      url: '/api/ping',
      remoteAddress: '10.0.0.42',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(authorized.statusCode).toBe(200);

    await fastify.close();
  });

  it('allows loopback and non-api routes without bearer token', async () => {
    process.env.VRT_AUTH_TOKEN = 'secret-token';
    const fastify = Fastify({ logger: false });
    registerAuth(fastify);
    fastify.get('/api/ping', async () => ({ ok: true }));
    fastify.get('/health', async () => ({ ok: true }));
    await fastify.ready();

    const loopbackApi = await fastify.inject({
      method: 'GET',
      url: '/api/ping',
      remoteAddress: '127.0.0.1',
    });
    expect(loopbackApi.statusCode).toBe(200);

    const remoteHealth = await fastify.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '10.0.0.42',
    });
    expect(remoteHealth.statusCode).toBe(200);

    await fastify.close();
  });
});
