import type { FastifyReply, FastifyRequest } from 'fastify';
import { getProject } from '../services/store.js';

export async function requireProject(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const project = await getProject(request.params.id);
  if (!project) {
    reply.code(404).send({ error: 'Project not found' });
    return;
  }
  request.project = project;
}
