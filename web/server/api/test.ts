import type { FastifyPluginAsync } from 'fastify';
import {
  createJob,
  getJob,
  getJobStatus,
  abortJob,
  startTestRun,
} from '../services/test-service.js';
import { loadProjectConfig } from '../../../src/core/config-manager.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { parseScreenshotFilename } from '../../../src/core/paths.js';
import { requireProject } from '../plugins/project.js';

function getJobForProject(jobId: string, projectId: string) {
  const job = getJob(jobId);
  if (!job || job.projectId !== projectId) {
    return null;
  }
  return job;
}

export const testRoutes: FastifyPluginAsync = async (fastify) => {
  // Start a test run
  fastify.post<{
    Params: { id: string };
    Body: { scenarios?: string[] };
  }>('/projects/:id/test', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    let config;
    try {
      config = await loadProjectConfig(project.path, project.configFile);
    } catch (err) {
      reply.code(400);
      return { error: 'Failed to load config', details: getErrorMessage(err) };
    }

    const scenarioFilter = request.body.scenarios;
    const scenarios = scenarioFilter
      ? config.scenarios.filter((s) => scenarioFilter.includes(s.name))
      : config.scenarios;

    const totalTests = scenarios.length * config.browsers.length * config.viewports.length;
    const job = createJob(project.id, totalTests);

    // Run tests in background
    startTestRun(job, project.path, config, scenarios);

    reply.code(202);
    return { jobId: job.id, status: 'running', total: totalTests };
  });

  // Rerun specific images (single or bulk)
  fastify.post<{
    Params: { id: string };
    Body: { filename?: string; filenames?: string[] };
  }>('/projects/:id/test/rerun', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    const fileList =
      request.body.filenames || (request.body.filename ? [request.body.filename] : []);
    if (fileList.length === 0) {
      reply.code(400);
      return { error: 'filename or filenames is required' };
    }

    let config;
    try {
      config = await loadProjectConfig(project.path, project.configFile);
    } catch (err) {
      reply.code(400);
      return { error: 'Failed to load config', details: getErrorMessage(err) };
    }

    // Parse all filenames and collect unique scenarios/browsers/viewports
    const scenarioNames = new Set<string>();
    const browserKeys = new Set<string>();
    const viewportNames = new Set<string>();
    const failed: string[] = [];

    type BrowserEntry = 'chromium' | 'webkit' | { name: 'chromium' | 'webkit'; version: string };

    const browserMap = new Map<string, BrowserEntry>();

    for (const fname of fileList) {
      const parsed = parseScreenshotFilename(
        fname,
        config.scenarios,
        config.browsers,
        config.viewports
      );
      if (!parsed) {
        failed.push(fname);
        continue;
      }
      scenarioNames.add(parsed.scenario);
      viewportNames.add(parsed.viewport);
      const bKey = parsed.version ? `${parsed.browser}-v${parsed.version}` : parsed.browser;
      browserKeys.add(bKey);
      if (!browserMap.has(bKey)) {
        browserMap.set(
          bKey,
          parsed.version
            ? { name: parsed.browser as 'chromium' | 'webkit', version: parsed.version }
            : (parsed.browser as BrowserEntry)
        );
      }
    }

    if (scenarioNames.size === 0) {
      reply.code(400);
      return { error: 'No filenames matched config', failed };
    }

    const scenarios = config.scenarios.filter((s) => scenarioNames.has(s.name));
    const viewports = config.viewports.filter((v) => viewportNames.has(v.name));
    const browsers = [...browserMap.values()];

    const totalTests = scenarios.length * browsers.length * viewports.length;
    const filteredConfig = { ...config, browsers, viewports };

    const job = createJob(project.id, totalTests);
    startTestRun(job, project.path, filteredConfig, scenarios);

    reply.code(202);
    return { jobId: job.id, status: 'running', total: totalTests, failed };
  });

  // Abort a running test
  fastify.post<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/test/:jobId/abort',
    async (request, reply) => {
      const job = getJobForProject(request.params.jobId, request.params.id);
      if (!job) {
        reply.code(404);
        return { error: 'Job not found' };
      }

      if (job.status !== 'running') {
        reply.code(400);
        return { error: 'Job is not running', status: job.status };
      }

      await abortJob(job);

      return {
        status: 'aborted',
        progress: job.progress,
        total: job.total,
        results: job.results,
      };
    }
  );

  // Get test job status
  fastify.get<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/test/:jobId',
    async (request, reply) => {
      const job = getJobForProject(request.params.jobId, request.params.id);
      if (!job) {
        reply.code(404);
        return { error: 'Job not found' };
      }

      const status = getJobStatus(job);
      return {
        id: status.id,
        status: status.status,
        progress: status.progress,
        total: status.total,
        phase: status.phase,
        results: status.results,
        error: status.error,
        startedAt: status.startedAt,
        completedAt: status.completedAt,
        timing: status.timing,
      };
    }
  );

  // SSE endpoint for live progress
  fastify.get<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/test/:jobId/stream',
    async (request, reply) => {
      const job = getJobForProject(request.params.jobId, request.params.id);
      if (!job) {
        reply.code(404);
        return { error: 'Job not found' };
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendEvent = (data: object) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const interval = setInterval(() => {
        sendEvent({
          status: job.status,
          progress: job.progress,
          total: job.total,
          latestResult: job.results[job.results.length - 1],
        });

        if (job.status !== 'running') {
          sendEvent({ status: job.status, results: job.results, error: job.error });
          clearInterval(interval);
          reply.raw.end();
        }
      }, 500);

      request.raw.on('close', () => {
        clearInterval(interval);
      });
    }
  );
};
