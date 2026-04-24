/**
 * OpenRouter provider — reuses the OpenAI-compatible factory with a custom
 * base URL and attribution headers.
 */

import type { AIProvider } from './ai-provider.js';
import { createOpenAICompatProvider } from './openai-compat.js';
import { readProviderEnv } from '../core/env.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_HEADERS = {
  'HTTP-Referer': 'https://vrtini.dev',
  'X-Title': 'VRT AI Analysis',
};

export interface OpenRouterProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || readProviderEnv('openrouter').apiKey;
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key not provided. Set OPENROUTER_API_KEY or pass apiKey option.'
    );
  }
  return createOpenAICompatProvider({
    name: 'openrouter',
    apiKey,
    baseURL: options.baseUrl ?? DEFAULT_BASE_URL,
    defaultHeaders: DEFAULT_HEADERS,
    label: 'OpenRouter',
  });
}
