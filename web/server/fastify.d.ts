import 'fastify';
import type { Project } from './services/store.js';

declare module 'fastify' {
  interface FastifyRequest {
    project?: Project;
  }
}
