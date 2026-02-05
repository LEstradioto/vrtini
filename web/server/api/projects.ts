import { isAbsolute, normalize } from 'path';
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

const MAX_NAME_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[/\\<>:"|?*\x00-\x1f]/;

function validateName(name: string): string | null {
  if (name.length > MAX_NAME_LENGTH) return 'Name exceeds maximum length';
  if (UNSAFE_NAME_CHARS.test(name)) return 'Name contains invalid characters';
  return null;
}

function validatePath(p: string): string | null {
  if (p.includes('\0')) return 'Path contains null bytes';
  if (!isAbsolute(p)) return 'Path must be absolute';
  const normed = normalize(p);
  if (normed !== p && normed !== p.replace(/\/$/, '')) return 'Path contains traversal sequences';
  return null;
}

function validateConfigFile(cf: string): string | null {
  if (cf.includes('/') || cf.includes('\\')) return 'Config file must be a filename, not a path';
  if (cf.includes('\0')) return 'Config file contains null bytes';
  if (!cf.endsWith('.json')) return 'Config file must end with .json';
  return null;
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

    const nameErr = validateName(name.trim());
    if (nameErr) {
      reply.code(400);
      return { error: nameErr };
    }

    const pathErr = validatePath(path.trim());
    if (pathErr) {
      reply.code(400);
      return { error: pathErr };
    }

    if (configFile !== undefined) {
      if (!isNonEmptyString(configFile)) {
        reply.code(400);
        return { error: 'Config file must be a non-empty string' };
      }
      const cfErr = validateConfigFile(configFile.trim());
      if (cfErr) {
        reply.code(400);
        return { error: cfErr };
      }
    }

    const project = await createProject({
      name: name.trim(),
      path: path.trim(),
      configFile: configFile?.trim(),
    });
    reply.code(201);
    return { project };
  });

  // Update project
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; path?: string; configFile?: string };
  }>('/projects/:id', async (request, reply) => {
    const { name, path, configFile } = request.body;

    if (name !== undefined) {
      if (!isNonEmptyString(name)) {
        reply.code(400);
        return { error: 'Name must be a non-empty string' };
      }
      const nameErr = validateName(name.trim());
      if (nameErr) {
        reply.code(400);
        return { error: nameErr };
      }
    }

    if (path !== undefined) {
      if (!isNonEmptyString(path)) {
        reply.code(400);
        return { error: 'Path must be a non-empty string' };
      }
      const pathErr = validatePath(path.trim());
      if (pathErr) {
        reply.code(400);
        return { error: pathErr };
      }
    }

    if (configFile !== undefined) {
      if (!isNonEmptyString(configFile)) {
        reply.code(400);
        return { error: 'Config file must be a non-empty string' };
      }
      const cfErr = validateConfigFile(configFile.trim());
      if (cfErr) {
        reply.code(400);
        return { error: cfErr };
      }
    }

    const sanitized: { name?: string; path?: string; configFile?: string } = {};
    if (name !== undefined) sanitized.name = name.trim();
    if (path !== undefined) sanitized.path = path.trim();
    if (configFile !== undefined) sanitized.configFile = configFile.trim();

    const project = await updateProject(request.params.id, sanitized);

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
