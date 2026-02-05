import type { FastifyPluginAsync } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { isAbsolute, resolve, sep } from 'path';
import { PNG } from 'pngjs';
import {
  getProjectImages,
  getImageDirectory,
  approveImage,
  rejectImage,
  bulkApproveImages,
  revertImage,
  loadConfig,
} from '../services/project-service.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { resizeImageData } from '../../../src/domain/image-diff.js';
import { requireProject } from '../plugins/project.js';

export const imagesRoutes: FastifyPluginAsync = async (fastify) => {
  // List images for a project
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/images',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }
      const { config } = await loadConfig(project.path, project.configFile);
      return getProjectImages(project.path, config as { baselineDir: string; outputDir: string });
    }
  );

  // Serve a file from output/baseline dirs (used by HTML reports)
  fastify.get<{
    Params: { id: string };
    Querystring: { path?: string; thumb?: string; max?: string };
  }>('/projects/:id/files', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);
    const configData = config as { baselineDir?: string; outputDir?: string };
    const filePath = request.query.path;

    if (!filePath) {
      reply.code(400);
      return { error: 'path query param is required' };
    }

    const baselineRoot = resolve(project.path, configData.baselineDir ?? '.vrt/baselines');
    const outputRoot = resolve(project.path, configData.outputDir ?? '.vrt/output');
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(project.path, filePath);

    const allowed =
      resolved === baselineRoot ||
      resolved.startsWith(baselineRoot + sep) ||
      resolved === outputRoot ||
      resolved.startsWith(outputRoot + sep);

    if (!allowed) {
      reply.code(403);
      return { error: 'Path not allowed' };
    }

    if (!existsSync(resolved)) {
      reply.code(404);
      return { error: 'File not found' };
    }

    const thumb = request.query.thumb === '1' || request.query.thumb === 'true';
    const maxDimension = request.query.max ? Number(request.query.max) : 0;

    if (!thumb || !Number.isFinite(maxDimension) || maxDimension <= 0) {
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      reply.type('image/png');
      return reply.send(createReadStream(resolved));
    }

    try {
      const thumbDir = resolve(project.path, '.vrt', 'thumbs');
      const key = createHash('sha1').update(`${resolved}:${maxDimension}`).digest('hex');
      const thumbPath = resolve(thumbDir, `${key}.png`);

      if (existsSync(thumbPath)) {
        reply.header('Cache-Control', 'no-cache, must-revalidate');
        reply.type('image/png');
        return reply.send(createReadStream(thumbPath));
      }

      const buffer = await readFile(resolved);
      const png = PNG.sync.read(buffer);
      const { width, height } = png;
      const scale = Math.min(maxDimension / width, maxDimension / height, 1);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      if (scale >= 1) {
        reply.header('Cache-Control', 'no-cache, must-revalidate');
        reply.type('image/png');
        return reply.send(buffer);
      }

      const resizedData = resizeImageData(png.data, width, height, targetWidth, targetHeight);
      const resized = new PNG({ width: targetWidth, height: targetHeight });
      resized.data = resizedData;
      const outBuffer = PNG.sync.write(resized);

      await mkdir(thumbDir, { recursive: true });
      await writeFile(thumbPath, outBuffer);

      reply.header('Cache-Control', 'no-cache, must-revalidate');
      reply.type('image/png');
      return reply.send(outBuffer);
    } catch {
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      reply.type('image/png');
      return reply.send(createReadStream(resolved));
    }
  });

  // Serve an image file
  fastify.get<{
    Params: { id: string; type: string; filename: string };
  }>(
    '/projects/:id/images/:type/:filename',
    { preHandler: requireProject },
    async (request, reply) => {
      const { type, filename } = request.params;
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const { config } = await loadConfig(project.path, project.configFile);
      const dir = getImageDirectory(
        project.path,
        type,
        config as { baselineDir: string; outputDir: string }
      );

      if (!dir) {
        reply.code(400);
        return { error: 'Invalid type. Use: baseline, test, diff' };
      }

      const filepath = resolve(dir, filename);

      if (!existsSync(filepath)) {
        reply.code(404);
        return { error: 'Image not found' };
      }

      reply.header('Cache-Control', 'no-cache, must-revalidate');
      return reply.sendFile(filename, dir);
    }
  );

  // Approve a test image (copy to baseline)
  fastify.post<{
    Params: { id: string };
    Body: { filename: string };
  }>('/projects/:id/approve', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.body;

    if (!filename) {
      reply.code(400);
      return { error: 'Filename is required' };
    }

    try {
      await approveImage(
        project.path,
        filename,
        config as { baselineDir: string; outputDir: string }
      );
      return { success: true, approved: filename };
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.includes('not found')) {
        reply.code(404);
        return { error: 'Test image not found' };
      }
      reply.code(500);
      return { error: 'Failed to approve', details: message };
    }
  });

  // Reject (delete) a test image
  fastify.post<{
    Params: { id: string };
    Body: { filename: string };
  }>('/projects/:id/reject', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.body;

    if (!filename) {
      reply.code(400);
      return { error: 'Filename is required' };
    }

    try {
      await rejectImage(
        project.path,
        filename,
        config as { baselineDir: string; outputDir: string }
      );
      return { success: true, rejected: filename };
    } catch (err) {
      reply.code(500);
      return { error: 'Failed to reject', details: getErrorMessage(err) };
    }
  });

  // Bulk approve multiple test images
  fastify.post<{
    Params: { id: string };
    Body: { filenames: string[] };
  }>('/projects/:id/bulk-approve', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);

    const { filenames } = request.body;

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      reply.code(400);
      return { error: 'Filenames array is required' };
    }

    const result = await bulkApproveImages(
      project.path,
      filenames,
      config as { baselineDir: string; outputDir: string }
    );
    return { success: true, ...result };
  });

  // Revert approval (delete baseline)
  fastify.post<{
    Params: { id: string; filename: string };
  }>('/projects/:id/revert/:filename', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.params;

    try {
      await revertImage(
        project.path,
        filename,
        config as { baselineDir: string; outputDir: string }
      );
      return { success: true, reverted: filename };
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.includes('not found')) {
        reply.code(404);
        return { error: 'Baseline image not found' };
      }
      reply.code(500);
      return { error: 'Failed to revert', details: message };
    }
  });

  // Get last test results (confidence, metrics)
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/results',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const resultsPath = resolve(project.path, '.vrt', 'last-results.json');
      if (!existsSync(resultsPath)) {
        return { results: {} };
      }

      try {
        const data = await readFile(resultsPath, 'utf-8');
        return { results: JSON.parse(data) };
      } catch {
        return { results: {} };
      }
    }
  );
};
