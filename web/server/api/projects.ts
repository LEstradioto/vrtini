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
import { NotFoundError, ValidationError } from '../../../src/core/api-errors.js';

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

function assertName(name: string): void {
  const err = validateName(name);
  if (err) throw new ValidationError(err);
}

function assertPath(p: string): void {
  const err = validatePath(p);
  if (err) throw new ValidationError(err);
}

function assertConfigFile(cf: string): void {
  const err = validateConfigFile(cf);
  if (err) throw new ValidationError(err);
}

export const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/info', async () => getServerInfo());

  fastify.get('/projects', async () => {
    const projects = await getProjects();
    return { projects };
  });

  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request) => {
    const project = await getProject(request.params.id);
    if (!project) throw new NotFoundError('Project not found');
    return { project };
  });

  fastify.post<{
    Body: { name: string; path: string; configFile?: string };
  }>('/projects', async (request, reply) => {
    const { name, path, configFile } = request.body;

    if (!isNonEmptyString(name) || !isNonEmptyString(path)) {
      throw new ValidationError('Name and path are required');
    }
    assertName(name.trim());
    assertPath(path.trim());

    if (configFile !== undefined) {
      if (!isNonEmptyString(configFile)) {
        throw new ValidationError('Config file must be a non-empty string');
      }
      assertConfigFile(configFile.trim());
    }

    const project = await createProject({
      name: name.trim(),
      path: path.trim(),
      configFile: configFile?.trim(),
    });
    reply.code(201);
    return { project };
  });

  fastify.put<{
    Params: { id: string };
    Body: { name?: string; path?: string; configFile?: string };
  }>('/projects/:id', async (request) => {
    const { name, path, configFile } = request.body;

    if (name !== undefined) {
      if (!isNonEmptyString(name)) throw new ValidationError('Name must be a non-empty string');
      assertName(name.trim());
    }
    if (path !== undefined) {
      if (!isNonEmptyString(path)) throw new ValidationError('Path must be a non-empty string');
      assertPath(path.trim());
    }
    if (configFile !== undefined) {
      if (!isNonEmptyString(configFile)) {
        throw new ValidationError('Config file must be a non-empty string');
      }
      assertConfigFile(configFile.trim());
    }

    const sanitized: { name?: string; path?: string; configFile?: string } = {};
    if (name !== undefined) sanitized.name = name.trim();
    if (path !== undefined) sanitized.path = path.trim();
    if (configFile !== undefined) sanitized.configFile = configFile.trim();

    const project = await updateProject(request.params.id, sanitized);
    if (!project) throw new NotFoundError('Project not found');
    return { project };
  });

  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request) => {
    const deleted = await deleteProject(request.params.id);
    if (!deleted) throw new NotFoundError('Project not found');
    return { success: true };
  });
};
