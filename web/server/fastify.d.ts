import 'fastify';
import type { Project } from './services/store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by the `requireProject` preHandler. Accessing this on a route that
     * does not register `requireProject` is a bug (value will be undefined).
     */
    project: Project;
  }
}
