/**
 * Single boundary for all `process.env` reads.
 *
 * Rule: a new env variable must be added here first. Consumers call a named
 * accessor so the surface is listed in one place and tests can stub easily.
 */

import type { AIProviderName } from '../adapters/ai-provider.js';

export interface ProviderCredential {
  apiKey?: string;
  authToken?: string;
}

/** Read per-provider env credentials. Empty strings are treated as unset. */
export function readProviderEnv(provider: AIProviderName): ProviderCredential {
  const pick = (k: string): string | undefined => process.env[k]?.trim() || undefined;
  switch (provider) {
    case 'anthropic':
      return { apiKey: pick('ANTHROPIC_API_KEY'), authToken: pick('ANTHROPIC_AUTH_TOKEN') };
    case 'openai':
      return { apiKey: pick('OPENAI_API_KEY') };
    case 'openrouter':
      return { apiKey: pick('OPENROUTER_API_KEY') };
    case 'google':
      return { apiKey: pick('GOOGLE_API_KEY') };
  }
}

export function hasProviderEnvCredential(provider: AIProviderName): boolean {
  const creds = readProviderEnv(provider);
  return Boolean(creds.apiKey || creds.authToken);
}

/** Returns the first provider (in preference order) that has a credential in env. */
export function pickProviderFromEnv(): AIProviderName | null {
  const order: AIProviderName[] = ['anthropic', 'openai', 'openrouter', 'google'];
  return order.find(hasProviderEnvCredential) ?? null;
}

// ── Server / CLI env ────────────────────────────────────────────────────────

export const readAuthToken = (): string | undefined => process.env.VRT_AUTH_TOKEN?.trim();
export const readServerHost = (): string | undefined => process.env.VRT_HOST;
export const readIsDev = (): boolean => process.env.NODE_ENV !== 'production';
export const readAllowInsecureRemote = (): boolean => process.env.VRT_ALLOW_INSECURE_REMOTE === '1';
export const readProjectsPath = (): string | undefined => process.env.VRT_PROJECTS_PATH;
export const readOdiffBinaryOverride = (): string | undefined =>
  process.env.VRT_ODIFF_BINARY?.trim() || undefined;
