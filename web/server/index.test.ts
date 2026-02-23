import { describe, expect, it } from 'vitest';
import { assertSecureHostBinding, isLoopbackHost } from './index.js';

describe('server host security', () => {
  it('recognizes loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.9')).toBe(false);
  });

  it('blocks non-loopback binding without auth token unless explicitly overridden', () => {
    expect(() =>
      assertSecureHostBinding({ host: '0.0.0.0', authToken: undefined, allowInsecureRemote: false })
    ).toThrow(/Refusing to bind to non-loopback host/);

    expect(() =>
      assertSecureHostBinding({ host: '0.0.0.0', authToken: 'token', allowInsecureRemote: false })
    ).not.toThrow();

    expect(() =>
      assertSecureHostBinding({ host: '0.0.0.0', authToken: undefined, allowInsecureRemote: true })
    ).not.toThrow();

    expect(() =>
      assertSecureHostBinding({
        host: '127.0.0.1',
        authToken: undefined,
        allowInsecureRemote: false,
      })
    ).not.toThrow();
  });
});
