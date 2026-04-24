/**
 * OpenRouter provider — reuses the OpenAI-compatible factory with a custom
 * base URL and attribution headers.
 *
 * `baseUrl` is enforced to the official host or a subpath thereof; any
 * user-supplied value pointing elsewhere is silently ignored (with a log
 * warning) so a compromised config can't exfil API keys + images to a
 * third-party endpoint.
 */

import type { AIProvider } from './ai-provider.js';
import { createOpenAICompatProvider } from './openai-compat.js';
import { readProviderEnv } from '../core/env.js';
import { log } from '../core/logger.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_HEADERS = {
  'HTTP-Referer': 'https://vrtini.dev',
  'X-Title': 'VRT AI Analysis',
};
const ALLOWED_HOSTS = new Set(['openrouter.ai', 'www.openrouter.ai']);

export interface OpenRouterProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Returns the official base URL for any input that doesn't resolve to an
 * allowed host + https scheme. Exported for reuse by the live-credential
 * validation path (which surfaces a user-facing warning).
 */
export function safeOpenRouterBaseUrl(input?: string): { baseUrl: string; warning?: string } {
  const trimmed = input?.trim();
  if (!trimmed) return { baseUrl: DEFAULT_BASE_URL };

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(hostname)) {
      return {
        baseUrl: DEFAULT_BASE_URL,
        warning: 'Custom baseUrl ignored for security; using official OpenRouter endpoint.',
      };
    }
    const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    return { baseUrl: normalized || DEFAULT_BASE_URL };
  } catch {
    return {
      baseUrl: DEFAULT_BASE_URL,
      warning: 'Invalid baseUrl ignored; using official OpenRouter endpoint.',
    };
  }
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || readProviderEnv('openrouter').apiKey;
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key not provided. Set OPENROUTER_API_KEY or pass apiKey option.'
    );
  }
  const { baseUrl, warning } = safeOpenRouterBaseUrl(options.baseUrl);
  if (warning) log.warn(`[openrouter] ${warning}`);
  return createOpenAICompatProvider({
    name: 'openrouter',
    apiKey,
    baseURL: baseUrl,
    defaultHeaders: DEFAULT_HEADERS,
    label: 'OpenRouter',
  });
}
