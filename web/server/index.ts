import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { projectsRoutes } from './api/projects.js';
import { configRoutes } from './api/config.js';
import { imagesRoutes } from './api/images.js';
import { testRoutes } from './api/test.js';
import { compareRoutes } from './api/compare.js';
import { acceptanceRoutes } from './api/acceptance.js';
import { analyzeRoutes } from './api/analyze.js';
import { crossCompareRoutes } from './api/cross-compare.js';
import { aiTriageRoutes } from './api/ai-triage.js';
import { registerAuth } from './plugins/auth.js';
import { log } from '../../src/core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  port: number;
  host?: string;
  open?: boolean;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1'
  );
}

export function assertSecureHostBinding(options: {
  host: string;
  authToken?: string;
  allowInsecureRemote?: boolean;
}): void {
  const exposingRemoteHost = !isLoopbackHost(options.host);
  if (exposingRemoteHost && !options.authToken?.trim() && !options.allowInsecureRemote) {
    throw new Error(
      `Refusing to bind to non-loopback host "${options.host}" without VRT_AUTH_TOKEN. ` +
        'Set VRT_AUTH_TOKEN, use a loopback host, or set VRT_ALLOW_INSECURE_REMOTE=1 explicitly.'
    );
  }
}

function getOpenCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'start';
  return 'xdg-open';
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, open } = options;
  const host = options.host ?? process.env.VRT_HOST ?? '127.0.0.1';
  const isDev = process.env.NODE_ENV !== 'production';
  const authToken = process.env.VRT_AUTH_TOKEN?.trim();
  const allowInsecureRemote = process.env.VRT_ALLOW_INSECURE_REMOTE === '1';
  assertSecureHostBinding({ host, authToken, allowInsecureRemote });

  const fastify = Fastify({
    maxParamLength: 256, // Allow longer filenames in routes (default is 100)
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // CORS for development
  await fastify.register(fastifyCors, {
    origin: isDev,
  });

  // Optional bearer-token auth (enabled when VRT_AUTH_TOKEN is set)
  // Remote bind without token is blocked above unless explicitly overridden.
  registerAuth(fastify);

  // Security headers
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; frame-ancestors 'none'"
    );
  });

  // API routes
  await fastify.register(projectsRoutes, { prefix: '/api' });
  await fastify.register(configRoutes, { prefix: '/api' });
  await fastify.register(imagesRoutes, { prefix: '/api' });
  await fastify.register(testRoutes, { prefix: '/api' });
  await fastify.register(compareRoutes, { prefix: '/api' });
  await fastify.register(crossCompareRoutes, { prefix: '/api' });
  await fastify.register(aiTriageRoutes, { prefix: '/api' });
  await fastify.register(acceptanceRoutes, { prefix: '/api' });
  await fastify.register(analyzeRoutes, { prefix: '/api' });

  // Serve static files from client build
  // From dist/web/server/ -> web/client/dist
  const clientDist = resolve(__dirname, '..', '..', '..', 'web', 'client', 'dist');

  if (existsSync(clientDist)) {
    await fastify.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });

    // SPA fallback
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  } else if (isDev) {
    // In dev, proxy to Vite dev server
    log.info('Client dist not found. Run `npm run build:client` or use Vite dev server.');
  }

  try {
    await fastify.listen({ port, host });

    const url = `http://localhost:${port}`;
    log.info(`\n  vrtini Web UI running at: ${url}\n`);

    if (open) {
      const cmd = getOpenCommand(process.platform);
      execFile(cmd, [url]);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
