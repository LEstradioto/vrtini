/**
 * Anthropic AI provider implementation.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AnalysisRequest, AnalysisResponse } from './ai-provider.js';
import { imageToBase64 } from './image-utils.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  authToken?: string;
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  const authToken = options.authToken || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !authToken) {
    throw new Error(
      'Anthropic credentials not provided. Set ANTHROPIC_API_KEY (API) or ANTHROPIC_AUTH_TOKEN (Claude Max), or pass apiKey/authToken option.'
    );
  }

  const client = new Anthropic({
    apiKey: apiKey || undefined,
    authToken: authToken || undefined,
  });

  return {
    name: 'anthropic',

    async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
      const images: Anthropic.ImageBlockParam[] = [];

      const addImage = async (path: string) => {
        const data = await imageToBase64(path);
        images.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data },
        });
      };

      await addImage(request.images.baseline);
      await addImage(request.images.test);

      if (request.images.diff) {
        await addImage(request.images.diff);
      }

      const response = await client.messages.create({
        model: request.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [...images, { type: 'text', text: request.prompt }],
          },
        ],
      });

      const textBlock = response.content.find((c) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Anthropic');
      }

      return {
        text: textBlock.text,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    },
  };
}
