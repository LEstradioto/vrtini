/**
 * Shared factory for OpenAI-compatible chat-completion providers (OpenAI,
 * OpenRouter, or any drop-in that speaks the OpenAI v1 chat/completions API).
 */

import OpenAI from 'openai';
import type {
  AIProvider,
  AIProviderName,
  AnalysisRequest,
  AnalysisResponse,
} from './ai-provider.js';
import { imageToBase64 } from './image-utils.js';

const MAX_TOKENS = 1024;

interface OpenAICompatOptions {
  name: AIProviderName;
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  /** Human label used in error messages. */
  label: string;
}

export function createOpenAICompatProvider(options: OpenAICompatOptions): AIProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultHeaders: options.defaultHeaders,
  });

  return {
    name: options.name,

    async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
      const images: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];

      const addImage = async (path: string): Promise<void> => {
        const data = await imageToBase64(path);
        images.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${data}`, detail: 'high' },
        });
      };

      await addImage(request.images.baseline);
      await addImage(request.images.test);
      if (request.images.diff) await addImage(request.images.diff);

      const response = await client.chat.completions.create({
        model: request.model,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [...images, { type: 'text', text: request.prompt }],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`No response from ${options.label}`);
      }

      return {
        text: content,
        tokensUsed: response.usage?.total_tokens,
      };
    },
  };
}
