/**
 * OpenRouter provider implementation.
 * Reuses the OpenAI SDK with a custom base URL.
 */

import OpenAI from 'openai';
import type { AIProvider, AnalysisRequest, AnalysisResponse } from './ai-provider.js';
import { imageToBase64 } from './image-utils.js';

export interface OpenRouterProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key not provided. Set OPENROUTER_API_KEY or pass apiKey option.'
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: options.baseUrl ?? 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://vrtini.dev',
      'X-Title': 'VRT AI Analysis',
    },
  });

  return {
    name: 'openrouter',

    async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
      const images: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];

      const addImage = async (path: string) => {
        const data = await imageToBase64(path);
        images.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${data}`, detail: 'high' },
        });
      };

      await addImage(request.images.baseline);
      await addImage(request.images.test);

      if (request.images.diff) {
        await addImage(request.images.diff);
      }

      const response = await client.chat.completions.create({
        model: request.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [...images, { type: 'text', text: request.prompt }],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenRouter');
      }

      return {
        text: content,
        tokensUsed: response.usage?.total_tokens,
      };
    },
  };
}
