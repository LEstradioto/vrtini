import type { FastifyPluginAsync } from 'fastify';
import { existsSync } from 'fs';
import {
  analyzeWithAI,
  analyzeMultiple,
  type AIAnalysisResult,
  type AIProvider,
} from '../../../src/core/ai-analysis.js';
import { getImagePath, type ImageType } from '../../../src/core/paths.js';
import { loadProjectConfig } from '../../../src/core/config-manager.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { requireProject } from '../plugins/project.js';
import { rateLimit } from '../plugins/rate-limit.js';

interface AnalyzeItem {
  baseline: { type: 'baseline' | 'test'; filename: string };
  test: { type: 'baseline' | 'test'; filename: string };
  diff?: { type: 'diff' | 'custom-diff'; filename: string };
  name?: string;
}

interface AnalyzeRequest {
  items: AnalyzeItem[];
}

interface AnalyzeResultItem {
  filename: string;
  analysis?: AIAnalysisResult;
  error?: string;
}

interface LoadedAIConfig {
  provider: AIProvider;
  apiKey?: string;
  authToken?: string;
  model?: string;
  baseUrl?: string;
  visionCompare?: {
    enabled?: boolean;
    chunks?: number;
    minImageHeight?: number;
    maxVerticalAlignShift?: number;
    includeDiffImage?: boolean;
  };
}

interface ProviderStatus {
  provider: AIProvider;
  configured: boolean;
  active: boolean;
  source: 'config' | 'env' | 'config+env' | 'none';
  detail: string;
}

interface ValidateProviderBody {
  provider: AIProvider;
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  model?: string;
}

interface ProviderValidationResponse {
  provider: AIProvider;
  valid: boolean;
  source: 'input' | 'env' | 'none';
  message: string;
}

const PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'openrouter', 'google'];
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_ALLOWED_HOSTS = new Set(['openrouter.ai', 'www.openrouter.ai']);

export function resolveOpenRouterValidationBaseUrl(input?: string): {
  baseUrl: string;
  warning?: string;
} {
  const trimmed = input?.trim();
  if (!trimmed) return { baseUrl: OPENROUTER_DEFAULT_BASE_URL };

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !OPENROUTER_ALLOWED_HOSTS.has(hostname)) {
      return {
        baseUrl: OPENROUTER_DEFAULT_BASE_URL,
        warning: 'Custom baseUrl ignored for security; using official OpenRouter endpoint.',
      };
    }
    const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    return { baseUrl: normalized || OPENROUTER_DEFAULT_BASE_URL };
  } catch {
    return {
      baseUrl: OPENROUTER_DEFAULT_BASE_URL,
      warning: 'Invalid baseUrl ignored; using official OpenRouter endpoint.',
    };
  }
}

function hasEnvCredential(provider: AIProvider): boolean {
  switch (provider) {
    case 'anthropic':
      return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY;
    case 'google':
      return !!process.env.GOOGLE_API_KEY;
    default:
      return false;
  }
}

function hasConfigCredential(aiConfig: LoadedAIConfig | undefined, provider: AIProvider): boolean {
  if (!aiConfig || aiConfig.provider !== provider) return false;
  if (provider === 'anthropic') return !!(aiConfig.apiKey || aiConfig.authToken);
  return !!aiConfig.apiKey;
}

function providerDetail(provider: AIProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'Needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN';
    case 'openai':
      return 'Needs OPENAI_API_KEY';
    case 'openrouter':
      return 'Needs OPENROUTER_API_KEY';
    case 'google':
      return 'Needs GOOGLE_API_KEY';
    default:
      return 'Not configured';
  }
}

function getProviderStatuses(aiConfig?: LoadedAIConfig): ProviderStatus[] {
  return PROVIDERS.map((provider) => {
    const configReady = hasConfigCredential(aiConfig, provider);
    const envReady = hasEnvCredential(provider);
    const configured = configReady || envReady;
    const source: ProviderStatus['source'] = configReady
      ? envReady
        ? 'config+env'
        : 'config'
      : envReady
        ? 'env'
        : 'none';

    let detail = providerDetail(provider);
    if (source === 'config+env') detail = 'Configured via project + environment';
    else if (source === 'config') detail = 'Configured in project settings';
    else if (source === 'env') detail = 'Configured via environment variable';

    return {
      provider,
      configured,
      active: aiConfig?.provider === provider,
      source,
      detail,
    };
  });
}

function resolveProvider(): AIProvider | null {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.GOOGLE_API_KEY) return 'google';
  return null;
}

function resolveProviderCredential(body: ValidateProviderBody): {
  source: 'input' | 'env' | 'none';
  apiKey?: string;
  authToken?: string;
} {
  const hasInputApiKey = !!body.apiKey?.trim();
  const hasInputAuthToken = !!body.authToken?.trim();

  if (body.provider === 'anthropic') {
    const apiKey = body.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;
    const authToken = body.authToken?.trim() || process.env.ANTHROPIC_AUTH_TOKEN;
    const source: 'input' | 'env' | 'none' =
      hasInputApiKey || hasInputAuthToken ? 'input' : apiKey || authToken ? 'env' : 'none';
    return { source, apiKey, authToken };
  }

  const envKey =
    body.provider === 'openai'
      ? process.env.OPENAI_API_KEY
      : body.provider === 'openrouter'
        ? process.env.OPENROUTER_API_KEY
        : process.env.GOOGLE_API_KEY;

  const apiKey = body.apiKey?.trim() || envKey;
  const source: 'input' | 'env' | 'none' = hasInputApiKey ? 'input' : apiKey ? 'env' : 'none';
  return { source, apiKey };
}

async function validateProviderCredential(
  body: ValidateProviderBody
): Promise<ProviderValidationResponse> {
  const provider = body.provider;
  const credential = resolveProviderCredential(body);
  const baseMessage = `Unable to validate ${provider} credentials`;

  if (credential.source === 'none') {
    return {
      provider,
      valid: false,
      source: 'none',
      message: 'No credential provided. Enter a key/token or set the provider env variable.',
    };
  }

  const requestInit: RequestInit = {
    method: 'GET',
    headers: {},
    signal: AbortSignal.timeout(8000),
  };
  let url = '';
  let providerWarning = '';

  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/models';
    requestInit.headers = {
      'anthropic-version': '2023-06-01',
    };
    if (credential.apiKey) {
      (requestInit.headers as Record<string, string>)['x-api-key'] = credential.apiKey;
    } else if (credential.authToken) {
      (requestInit.headers as Record<string, string>).Authorization =
        `Bearer ${credential.authToken}`;
    }
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/models';
    requestInit.headers = {
      Authorization: `Bearer ${credential.apiKey}`,
    };
  } else if (provider === 'openrouter') {
    const { baseUrl, warning } = resolveOpenRouterValidationBaseUrl(body.baseUrl);
    if (warning) providerWarning = ` ${warning}`;
    url = `${baseUrl}/models`;
    requestInit.headers = {
      Authorization: `Bearer ${credential.apiKey}`,
    };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      credential.apiKey ?? ''
    )}`;
  }

  try {
    const response = await fetch(url, requestInit);

    if (response.ok) {
      return {
        provider,
        valid: true,
        source: credential.source,
        message: `Credential is valid and reachable.${providerWarning}`,
      };
    }

    if (response.status === 429) {
      return {
        provider,
        valid: true,
        source: credential.source,
        message: `Credential appears valid (rate limited).${providerWarning}`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        provider,
        valid: false,
        source: credential.source,
        message: `Credential was rejected by provider (401/403).${providerWarning}`,
      };
    }

    return {
      provider,
      valid: false,
      source: credential.source,
      message: `${baseMessage}. Provider returned ${response.status}.${providerWarning}`,
    };
  } catch (err) {
    const message = getErrorMessage(err);
    return {
      provider,
      valid: false,
      source: credential.source,
      message: `${baseMessage}. ${message}${providerWarning}`,
    };
  }
}

export const analyzeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { id: string };
  }>('/projects/:id/analyze/providers', { preHandler: requireProject }, async (request, reply) => {
    const project = request.project;
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    let aiConfig: LoadedAIConfig | undefined;
    try {
      const config = await loadProjectConfig(project.path, project.configFile);
      if (config.ai?.provider) {
        aiConfig = {
          provider: config.ai.provider,
          apiKey: config.ai.apiKey,
          authToken: config.ai.authToken,
          model: config.ai.model,
          baseUrl: config.ai.baseUrl,
          visionCompare: config.ai.visionCompare,
        };
      }
    } catch {
      // Ignore config errors and only surface environment status.
    }

    return {
      activeProvider: aiConfig?.provider ?? null,
      providers: getProviderStatuses(aiConfig),
    };
  });

  fastify.post<{
    Params: { id: string };
    Body: ValidateProviderBody;
  }>(
    '/projects/:id/analyze/validate-provider',
    { preHandler: requireProject },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const provider = request.body?.provider;
      if (!provider || !PROVIDERS.includes(provider)) {
        reply.code(400);
        return { error: `provider must be one of: ${PROVIDERS.join(', ')}` };
      }

      const result = await validateProviderCredential(request.body);
      return reply.send(result);
    }
  );

  // Analyze images using AI
  fastify.post<{
    Params: { id: string };
    Body: AnalyzeRequest;
  }>(
    '/projects/:id/analyze',
    { preHandler: [rateLimit({ max: 5, windowMs: 60_000 }), requireProject] },
    async (request, reply) => {
      const project = request.project;
      if (!project) {
        reply.code(404);
        return { error: 'Project not found' };
      }

      const { items } = request.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        reply.code(400);
        return { error: 'items array is required and must not be empty' };
      }

      // Load project config to get AI settings
      let aiConfig: LoadedAIConfig | undefined;

      try {
        const config = await loadProjectConfig(project.path, project.configFile);
        if (config.ai?.enabled && config.ai?.provider) {
          aiConfig = {
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            authToken: config.ai.authToken,
            model: config.ai.model,
            baseUrl: config.ai.baseUrl,
            visionCompare: config.ai.visionCompare,
          };
        }
      } catch {
        // Ignore config errors, will check for API keys in env
      }

      // Check if AI is configured
      const provider = aiConfig?.provider || resolveProvider();

      if (!provider) {
        reply.code(400);
        return {
          error:
            'AI not configured. Set ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, OPENROUTER_API_KEY, or GOOGLE_API_KEY, or configure AI in project settings.',
        };
      }

      // Helper to resolve paths using the project path
      const resolvePath = (type: string, filename: string): string =>
        getImagePath(project.path, type as ImageType, filename);

      const results: AnalyzeResultItem[] = [];

      // Single item analysis
      if (items.length === 1) {
        const item = items[0];
        try {
          const baselinePath = resolvePath(item.baseline.type, item.baseline.filename);
          const testPath = resolvePath(item.test.type, item.test.filename);
          const diffPath = item.diff ? resolvePath(item.diff.type, item.diff.filename) : undefined;

          if (!existsSync(baselinePath)) {
            throw new Error(`Baseline image not found: ${item.baseline.filename}`);
          }
          if (!existsSync(testPath)) {
            throw new Error(`Test image not found: ${item.test.filename}`);
          }

          const analysis = await analyzeWithAI(baselinePath, testPath, diffPath, {
            provider: provider as AIProvider,
            apiKey: aiConfig?.apiKey,
            authToken: aiConfig?.authToken,
            model: aiConfig?.model,
            baseUrl: aiConfig?.baseUrl,
            visionCompare: aiConfig?.visionCompare,
            scenarioName: item.name || item.test.filename,
          });

          results.push({
            filename: item.test.filename,
            analysis,
          });
        } catch (err) {
          results.push({
            filename: item.test.filename,
            error: getErrorMessage(err),
          });
        }

        return { results };
      }

      // Batch analysis with concurrency
      const comparisons = items.map((item) => ({
        baseline: resolvePath(item.baseline.type, item.baseline.filename),
        test: resolvePath(item.test.type, item.test.filename),
        diff: item.diff ? resolvePath(item.diff.type, item.diff.filename) : undefined,
        name: item.name || item.test.filename,
      }));

      try {
        const batchResults = await analyzeMultiple(
          comparisons,
          {
            provider: provider as AIProvider,
            apiKey: aiConfig?.apiKey,
            authToken: aiConfig?.authToken,
            model: aiConfig?.model,
            baseUrl: aiConfig?.baseUrl,
            visionCompare: aiConfig?.visionCompare,
          },
          3 // concurrency
        );

        for (const [name, result] of batchResults) {
          if (result instanceof Error) {
            results.push({
              filename: name,
              error: result.message,
            });
          } else {
            results.push({
              filename: name,
              analysis: result,
            });
          }
        }
      } catch (err) {
        reply.code(500);
        return { error: 'Batch analysis failed', details: getErrorMessage(err) };
      }

      return { results };
    }
  );
};
