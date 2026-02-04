/**
 * OpenAI provider implementation.
 */

import OpenAI from 'openai';
import type { AIProvider, AnalysisRequest, AnalysisResponse } from './ai-provider.js';
import { imageToBase64 } from './image-utils.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not provided. Set OPENAI_API_KEY or pass apiKey option.');
  }

  const client = new OpenAI({ apiKey });

  return {
    name: 'openai',

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
        throw new Error('No response from OpenAI');
      }

      return {
        text: content,
        tokensUsed: response.usage?.total_tokens,
      };
    },
  };
}
