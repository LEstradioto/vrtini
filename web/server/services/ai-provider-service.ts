/**
 * AI provider credential resolution + validation.
 *
 * Owns:
 *  - the canonical PROVIDERS list
 *  - a data-driven per-provider table (auth header shape, validation URL,
 *    env-var label)
 *  - `getProviderStatuses`: config vs env vs none
 *  - `resolveProviderCredential`: input → env → none precedence
 *  - `validateProviderCredential`: live HTTP probe of the credential
 *
 * Routes in analyze.ts stay thin: parse body, call into here, return.
 */

import type { AIProvider } from '../../../src/ai-analysis.js';
import { hasProviderEnvCredential, readProviderEnv } from '../../../src/core/env.js';
import { loadProjectConfig } from '../../../src/core/config-manager.js';
import { safeOpenRouterBaseUrl } from '../../../src/adapters/openrouter-provider.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LoadedAIConfig {
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

export interface ProviderStatus {
  provider: AIProvider;
  configured: boolean;
  active: boolean;
  source: 'config' | 'env' | 'config+env' | 'none';
  detail: string;
}

export interface ValidateProviderBody {
  provider: AIProvider;
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  model?: string;
}

export interface ProviderValidationResponse {
  provider: AIProvider;
  valid: boolean;
  source: 'input' | 'env' | 'none';
  message: string;
}

interface ResolvedCredential {
  source: 'input' | 'env' | 'none';
  apiKey?: string;
  authToken?: string;
}

// ─── Provider table ─────────────────────────────────────────────────────────

export const PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'openrouter', 'google'];

interface ProviderConfig {
  /** Human description of what env var(s) this provider needs. */
  envDescription: string;
  /** Build the URL + headers for a live-validation probe. */
  buildProbeRequest: (
    credential: ResolvedCredential,
    body: ValidateProviderBody
  ) => { url: string; headers: Record<string, string>; warning?: string };
}

const PROVIDER_CONFIGS: Record<AIProvider, ProviderConfig> = {
  anthropic: {
    envDescription: 'Needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
    buildProbeRequest: (credential) => {
      const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
      if (credential.apiKey) headers['x-api-key'] = credential.apiKey;
      else if (credential.authToken) headers.Authorization = `Bearer ${credential.authToken}`;
      return { url: 'https://api.anthropic.com/v1/models', headers };
    },
  },
  openai: {
    envDescription: 'Needs OPENAI_API_KEY',
    buildProbeRequest: (credential) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${credential.apiKey}` },
    }),
  },
  openrouter: {
    envDescription: 'Needs OPENROUTER_API_KEY',
    buildProbeRequest: (credential, body) => {
      const { baseUrl, warning } = safeOpenRouterBaseUrl(body.baseUrl);
      return {
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${credential.apiKey}` },
        warning,
      };
    },
  },
  google: {
    envDescription: 'Needs GOOGLE_API_KEY',
    buildProbeRequest: (credential) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        credential.apiKey ?? ''
      )}`,
      headers: {},
    }),
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** @deprecated Prefer `safeOpenRouterBaseUrl` from `src/adapters/openrouter-provider.js`. */
export const resolveOpenRouterValidationBaseUrl = safeOpenRouterBaseUrl;

/**
 * Load the project's AI config and return a normalized LoadedAIConfig,
 * or undefined if the project has no AI configured or the config file is
 * unreadable. Never throws — callers just get `undefined` and fall back
 * to env-only status.
 */
export async function loadProjectAIConfig(
  projectPath: string,
  configFile: string,
  opts: { requireEnabled?: boolean } = {}
): Promise<LoadedAIConfig | undefined> {
  try {
    const config = await loadProjectConfig(projectPath, configFile);
    if (!config.ai?.provider) return undefined;
    if (opts.requireEnabled && !config.ai.enabled) return undefined;
    return {
      provider: config.ai.provider,
      apiKey: config.ai.apiKey,
      authToken: config.ai.authToken,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
      visionCompare: config.ai.visionCompare,
    };
  } catch {
    return undefined;
  }
}

function hasConfigCredential(aiConfig: LoadedAIConfig | undefined, provider: AIProvider): boolean {
  if (!aiConfig || aiConfig.provider !== provider) return false;
  if (provider === 'anthropic') return !!(aiConfig.apiKey || aiConfig.authToken);
  return !!aiConfig.apiKey;
}

export function getProviderStatuses(aiConfig?: LoadedAIConfig): ProviderStatus[] {
  return PROVIDERS.map((provider) => {
    const configReady = hasConfigCredential(aiConfig, provider);
    const envReady = hasProviderEnvCredential(provider);
    const configured = configReady || envReady;
    const source: ProviderStatus['source'] = configReady
      ? envReady
        ? 'config+env'
        : 'config'
      : envReady
        ? 'env'
        : 'none';

    let detail = PROVIDER_CONFIGS[provider].envDescription;
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

function resolveProviderCredential(body: ValidateProviderBody): ResolvedCredential {
  const hasInputApiKey = !!body.apiKey?.trim();
  const hasInputAuthToken = !!body.authToken?.trim();
  const env = readProviderEnv(body.provider);

  if (body.provider === 'anthropic') {
    const apiKey = body.apiKey?.trim() || env.apiKey;
    const authToken = body.authToken?.trim() || env.authToken;
    const source: ResolvedCredential['source'] =
      hasInputApiKey || hasInputAuthToken ? 'input' : apiKey || authToken ? 'env' : 'none';
    return { source, apiKey, authToken };
  }

  const apiKey = body.apiKey?.trim() || env.apiKey;
  const source: ResolvedCredential['source'] = hasInputApiKey ? 'input' : apiKey ? 'env' : 'none';
  return { source, apiKey };
}

export async function validateProviderCredential(
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

  const { url, headers, warning } = PROVIDER_CONFIGS[provider].buildProbeRequest(credential, body);
  const providerWarning = warning ? ` ${warning}` : '';
  const requestInit: RequestInit = {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8000),
  };

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
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider,
      valid: false,
      source: credential.source,
      message: `${baseMessage}. ${message}${providerWarning}`,
    };
  }
}
