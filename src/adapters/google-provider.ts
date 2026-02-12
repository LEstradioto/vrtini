/**
 * Google Gemini provider implementation.
 * Uses the @google/genai SDK.
 */

import { GoogleGenAI } from '@google/genai';
import type { AIProvider, AnalysisRequest, AnalysisResponse } from './ai-provider.js';
import { imageToBase64 } from './image-utils.js';

export interface GoogleProviderOptions {
  apiKey?: string;
}

export function createGoogleProvider(options: GoogleProviderOptions = {}): AIProvider {
  const apiKey = options.apiKey || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Google API key not provided. Set GOOGLE_API_KEY or pass apiKey option.');
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    name: 'google',

    async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
      const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [];

      const addImage = async (path: string) => {
        const data = await imageToBase64(path);
        parts.push({ inlineData: { mimeType: 'image/png', data } });
      };

      await addImage(request.images.baseline);
      await addImage(request.images.test);

      if (request.images.diff) {
        await addImage(request.images.diff);
      }

      parts.push({ text: request.prompt });

      const response = await ai.models.generateContent({
        model: request.model,
        contents: parts,
        config: { maxOutputTokens: 1024 },
      });

      const text = response.text;
      if (!text) {
        throw new Error('No response from Google Gemini');
      }

      return {
        text,
        tokensUsed: response.usageMetadata?.totalTokenCount,
      };
    },
  };
}
