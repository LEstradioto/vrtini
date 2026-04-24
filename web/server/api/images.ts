import type { FastifyPluginAsync } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
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
  setImageFlag,
  revokeImageFlag,
  loadConfig,
} from '../services/project-service.js';
import { resizeImageData } from '../../../src/domain/image-diff.js';
import { requireProject } from '../plugins/project.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/core/api-errors.js';
import { createSemaphore } from '../../../src/core/semaphore.js';

// Bound the parallel PNG decode+resize work. pngjs's `PNG.sync.read` blocks
// the event loop, so many concurrent thumb requests for large images would
// otherwise tie up the server. 4 is well below the point where latency for
// small images suffers.
const thumbnailGate = createSemaphore(4);

export const imagesRoutes: FastifyPluginAsync = async (fastify) => {
  // List images for a project
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/images',
    { preHandler: requireProject },
    async (request) => {
      const project = request.project;
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
    const { config } = await loadConfig(project.path, project.configFile);
    const configData = config as { baselineDir?: string; outputDir?: string };
    const filePath = request.query.path;

    if (!filePath) throw new ValidationError('path query param is required');
    if (filePath.includes('\0')) throw new ValidationError('path contains null byte');

    const baselineRoot = resolve(project.path, configData.baselineDir ?? '.vrtini/baselines');
    const outputRoot = resolve(project.path, configData.outputDir ?? '.vrtini/output');
    const requested = isAbsolute(filePath) ? resolve(filePath) : resolve(project.path, filePath);

    if (!existsSync(requested)) throw new NotFoundError('File not found');

    // Resolve symlinks for both the requested path and the sandbox roots before
    // the prefix check, otherwise a symlink inside baselines/output could escape
    // the sandbox (e.g. baselines/leak → /etc).
    let resolved: string;
    let baselineReal: string;
    let outputReal: string;
    try {
      [resolved, baselineReal, outputReal] = await Promise.all([
        realpath(requested),
        realpath(baselineRoot).catch(() => baselineRoot),
        realpath(outputRoot).catch(() => outputRoot),
      ]);
    } catch {
      throw new NotFoundError('File not found');
    }

    const allowed =
      resolved === baselineReal ||
      resolved.startsWith(baselineReal + sep) ||
      resolved === outputReal ||
      resolved.startsWith(outputReal + sep);

    if (!allowed) throw new ForbiddenError('Path not allowed');

    const thumb = request.query.thumb === '1' || request.query.thumb === 'true';
    const maxDimension = request.query.max ? Number(request.query.max) : 0;

    if (!thumb || !Number.isFinite(maxDimension) || maxDimension <= 0) {
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      reply.type('image/png');
      return reply.send(createReadStream(resolved));
    }

    try {
      const thumbDir = resolve(project.path, '.vrtini', 'thumbs');
      const key = createHash('sha1').update(`${resolved}:${maxDimension}`).digest('hex');
      const thumbPath = resolve(thumbDir, `${key}.png`);

      if (existsSync(thumbPath)) {
        reply.header('Cache-Control', 'no-cache, must-revalidate');
        reply.type('image/png');
        return reply.send(createReadStream(thumbPath));
      }

      // Cache miss: gate decode+resize so we can't exhaust the event loop
      // if many parallel thumb requests land at once.
      const outBuffer = await thumbnailGate(async () => {
        const buffer = await readFile(resolved);
        const png = PNG.sync.read(buffer);
        const { width, height } = png;
        const scale = Math.min(maxDimension / width, maxDimension / height, 1);

        if (scale >= 1) return buffer;

        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const resizedData = resizeImageData(png.data, width, height, targetWidth, targetHeight);
        const resized = new PNG({ width: targetWidth, height: targetHeight });
        resized.data = resizedData;
        const encoded = PNG.sync.write(resized);

        await mkdir(thumbDir, { recursive: true });
        await writeFile(thumbPath, encoded);
        return encoded;
      });

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
      const { config } = await loadConfig(project.path, project.configFile);
      const dir = getImageDirectory(
        project.path,
        type,
        config as { baselineDir: string; outputDir: string }
      );

      if (!dir) throw new ValidationError('Invalid type. Use: baseline, test, diff');

      const filepath = resolve(dir, filename);

      if (!existsSync(filepath)) throw new NotFoundError('Image not found');

      reply.header('Cache-Control', 'no-cache, must-revalidate');
      return reply.sendFile(filename, dir);
    }
  );

  // Approve a test image (copy to baseline)
  fastify.post<{
    Params: { id: string };
    Body: { filename: string };
  }>('/projects/:id/approve', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.body;
    if (!filename) throw new ValidationError('Filename is required');

    await approveImage(
      project.path,
      filename,
      config as { baselineDir: string; outputDir: string }
    );
    return { success: true, approved: filename };
  });

  // Reject (delete) a test image
  fastify.post<{
    Params: { id: string };
    Body: { filename: string };
  }>('/projects/:id/reject', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.body;
    if (!filename) throw new ValidationError('Filename is required');

    await rejectImage(project.path, filename, config as { baselineDir: string; outputDir: string });
    await revokeImageFlag(project.path, filename);
    return { success: true, rejected: filename };
  });

  // Flag an image for later review
  fastify.post<{
    Params: { id: string };
    Body: { filename: string; reason?: string };
  }>('/projects/:id/flag', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { filename, reason } = request.body;
    if (!filename) throw new ValidationError('Filename is required');

    const flag = await setImageFlag(project.path, { filename, reason });
    return { success: true, flag };
  });

  // Remove image flag
  fastify.delete<{
    Params: { id: string; filename: string };
  }>('/projects/:id/flag/:filename', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const filename = decodeURIComponent(request.params.filename);
    const revoked = await revokeImageFlag(project.path, filename);
    if (!revoked) throw new NotFoundError('Flag not found');

    return { success: true, revoked: filename };
  });

  // Bulk approve multiple test images
  fastify.post<{
    Params: { id: string };
    Body: { filenames: string[] };
  }>('/projects/:id/bulk-approve', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { config } = await loadConfig(project.path, project.configFile);

    const { filenames } = request.body;

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      throw new ValidationError('Filenames array is required');
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
  }>('/projects/:id/revert/:filename', { preHandler: requireProject }, async (request) => {
    const project = request.project;
    const { config } = await loadConfig(project.path, project.configFile);

    const { filename } = request.params;

    await revertImage(project.path, filename, config as { baselineDir: string; outputDir: string });
    return { success: true, reverted: filename };
  });

  // Get last test results (confidence, metrics)
  fastify.get<{ Params: { id: string } }>(
    '/projects/:id/results',
    { preHandler: requireProject },
    async (request) => {
      const project = request.project;
      const resultsPath = resolve(project.path, '.vrtini', 'last-results.json');
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
