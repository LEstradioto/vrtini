import { describe, expect, it } from 'vitest';
import { resolveOpenRouterValidationBaseUrl } from './analyze.js';

describe('resolveOpenRouterValidationBaseUrl', () => {
  it('uses official OpenRouter endpoint by default', () => {
    const result = resolveOpenRouterValidationBaseUrl();
    expect(result.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(result.warning).toBeUndefined();
  });

  it('accepts only official OpenRouter hosts with https', () => {
    const allowed = resolveOpenRouterValidationBaseUrl('https://openrouter.ai/api/v1/');
    expect(allowed.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(allowed.warning).toBeUndefined();

    const blockedProtocol = resolveOpenRouterValidationBaseUrl('http://openrouter.ai/api/v1');
    expect(blockedProtocol.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(blockedProtocol.warning).toContain('ignored');

    const blockedHost = resolveOpenRouterValidationBaseUrl('https://127.0.0.1:8080/api/v1');
    expect(blockedHost.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(blockedHost.warning).toContain('ignored');
  });
});
