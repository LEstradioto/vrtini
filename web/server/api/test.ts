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
import { rateLimit } from '../plugins/rate-limit.js';
import { NotFoundError, ValidationError } from '../../../src/core/api-errors.js';

function getJobForProject(jobId: string, projectId: string) {
  const job = getJob(jobId);
  if (!job || job.projectId !== projectId) return null;
  return job;
}

function requireJob(jobId: string, projectId: string) {
  const job = getJobForProject(jobId, projectId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

async function loadConfigOrThrow(projectPath: string, configFile: string) {
  try {
    return await loadProjectConfig(projectPath, configFile);
  } catch (err) {
    throw new ValidationError(`Failed to load config: ${getErrorMessage(err)}`);
  }
}

export const testRoutes: FastifyPluginAsync = async (fastify) => {
  // Start a test run
  fastify.post<{
    Params: { id: string };
    Body: { scenarios?: string[] };
  }>(
    '/projects/:id/test',
    { preHandler: [rateLimit({ max: 3, windowMs: 60_000 }), requireProject] },
    async (request, reply) => {
      const project = request.project;
      const config = await loadConfigOrThrow(project.path, project.configFile);

      const scenarioFilter = request.body.scenarios;
      const scenarios = scenarioFilter
        ? config.scenarios.filter((s) => scenarioFilter.includes(s.name))
        : config.scenarios;

      const totalTests = scenarios.length * config.browsers.length * config.viewports.length;
      const job = createJob(project.id, totalTests);

      startTestRun(job, project.path, config, scenarios);

      reply.code(202);
      return { jobId: job.id, status: 'running', total: totalTests };
    }
  );

  // Rerun specific images (single or bulk)
  fastify.post<{
    Params: { id: string };
    Body: { filename?: string; filenames?: string[] };
  }>(
    '/projects/:id/test/rerun',
    { preHandler: [rateLimit({ max: 5, windowMs: 60_000 }), requireProject] },
    async (request, reply) => {
      const project = request.project;
      const fileList =
        request.body.filenames || (request.body.filename ? [request.body.filename] : []);
      if (fileList.length === 0) {
        throw new ValidationError('filename or filenames is required');
      }

      const config = await loadConfigOrThrow(project.path, project.configFile);

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
        throw new ValidationError('No filenames matched config', { failed });
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
    }
  );

  // Abort a running test
  fastify.post<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/test/:jobId/abort',
    async (request) => {
      const job = requireJob(request.params.jobId, request.params.id);

      if (job.status !== 'running') {
        throw new ValidationError(`Job is not running (status: ${job.status})`);
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
    async (request) => {
      const job = requireJob(request.params.jobId, request.params.id);
      // Returning the snapshot directly preserves all fields (warnings,
      // captureDiagnostics) — the previous re-spread was dropping them.
      return getJobStatus(job);
    }
  );

  // SSE endpoint for live progress
  fastify.get<{ Params: { id: string; jobId: string } }>(
    '/projects/:id/test/:jobId/stream',
    async (request, reply) => {
      const job = requireJob(request.params.jobId, request.params.id);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendEvent = (data: object) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Hard cap so a stalled job or a client that never disconnects can't
      // keep the event loop busy forever. Tests typically finish in minutes;
      // 30 min is the upper bound we're willing to stream for.
      const MAX_STREAM_MS = 30 * 60 * 1000;
      const deadline = Date.now() + MAX_STREAM_MS;

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          reply.raw.end();
        } catch {
          // socket already gone
        }
      };

      const interval = setInterval(() => {
        if (Date.now() > deadline) {
          sendEvent({ status: job.status, timedOut: true });
          cleanup();
          return;
        }

        sendEvent({
          status: job.status,
          progress: job.progress,
          total: job.total,
          latestResult: job.results[job.results.length - 1],
        });

        if (job.status !== 'running') {
          sendEvent({ status: job.status, results: job.results, error: job.error });
          cleanup();
        }
      }, 500);

      reply.raw.on('error', cleanup);
      request.raw.on('close', cleanup);
    }
  );
};
