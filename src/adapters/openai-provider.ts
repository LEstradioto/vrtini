/**
 * OpenAI provider implementation.
 */

import type { AIProvider } from './ai-provider.js';
import { createOpenAICompatProvider } from './openai-compat.js';
import { readProviderEnv } from '../core/env.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || readProviderEnv('openai').apiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not provided. Set OPENAI_API_KEY or pass apiKey option.');
  }
  return createOpenAICompatProvider({ name: 'openai', apiKey, label: 'OpenAI' });
}
