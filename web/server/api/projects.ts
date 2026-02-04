import type { FastifyPluginAsync } from 'fastify';
import {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from '../services/store.js';
import { getServerInfo } from '../services/project-service.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get server info (cwd, detect existing config)
  fastify.get('/info', async () => {
    return getServerInfo();
  });

  // List all projects
  fastify.get('/projects', async () => {
    const projects = await getProjects();
    return { projects };
  });

  // Get single project
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = await getProject(request.params.id);

    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    return { project };
  });

  // Create project
  fastify.post<{
    Body: { name: string; path: string; configFile?: string };
  }>('/projects', async (request, reply) => {
    const { name, path, configFile } = request.body;

    if (!isNonEmptyString(name) || !isNonEmptyString(path)) {
      reply.code(400);
      return { error: 'Name and path are required' };
    }

    const project = await createProject({ name, path, configFile });
    reply.code(201);
    return { project };
  });

  // Update project
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; path?: string; configFile?: string };
  }>('/projects/:id', async (request, reply) => {
    const project = await updateProject(request.params.id, request.body);

    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    return { project };
  });

  // Delete project
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const deleted = await deleteProject(request.params.id);

    if (!deleted) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    return { success: true };
  });
};
