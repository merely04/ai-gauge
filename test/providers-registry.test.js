import { describe, it, expect } from 'bun:test';
import '../lib/providers/anthropic.js';
import { getProvider, detectProviderByBaseUrl, PROVIDER_NAMES, registerProvider } from '../lib/providers/index.js';

describe('Provider Registry', () => {
  it('PROVIDER_NAMES includes all 9 providers', () => {
    expect(PROVIDER_NAMES).toContain('anthropic');
    expect(PROVIDER_NAMES).toContain('zai');
    expect(PROVIDER_NAMES).toContain('codex');
    expect(PROVIDER_NAMES).toContain('copilot');
    expect(PROVIDER_NAMES).toContain('unknown');
    expect(PROVIDER_NAMES).toHaveLength(9);
  });

  it('includes codex', () => {
    expect(PROVIDER_NAMES).toContain('codex');
  });

  it('includes copilot', () => {
    expect(PROVIDER_NAMES).toContain('copilot');
  });

  it('detects chatgpt.com as codex', () => {
    expect(detectProviderByBaseUrl('https://chatgpt.com')).toBe('codex');
  });

  it('getProvider("anthropic") returns adapter', () => {
    const provider = getProvider('anthropic');
    expect(provider.name).toBe('anthropic');
    expect(provider.kind).toBe('oauth');
  });

  it('getProvider("doesnotexist") throws', () => {
    expect(() => getProvider('doesnotexist')).toThrow('Unknown provider: doesnotexist');
  });

  it('detectProviderByBaseUrl(null) returns anthropic', () => {
    expect(detectProviderByBaseUrl(null)).toBe('anthropic');
  });

  it('detectProviderByBaseUrl(undefined) returns anthropic', () => {
    expect(detectProviderByBaseUrl(undefined)).toBe('anthropic');
  });

  it('detectProviderByBaseUrl("https://api.z.ai") returns zai', () => {
    expect(detectProviderByBaseUrl('https://api.z.ai/api/anthropic')).toBe('zai');
  });

  it('detectProviderByBaseUrl("https://api.anthropic.com") returns anthropic', () => {
    expect(detectProviderByBaseUrl('https://api.anthropic.com/api/oauth/usage')).toBe('anthropic');
  });

  it('detectProviderByBaseUrl("https://nekro.ai") returns unknown', () => {
    expect(detectProviderByBaseUrl('https://nekro.ai/anthropic')).toBe('unknown');
  });

  it('registerProvider stores custom adapters', () => {
    const customAdapter = {
      name: 'test-stub',
      kind: 'stub',
      buildRequest() {
        return { url: 'https://example.com', method: 'GET', headers: {} };
      },
      parseResponse() {
        return { rateLimits: null, balance: null };
      },
    };

    registerProvider(customAdapter);

    expect(getProvider('test-stub')).toBe(customAdapter);
  });

  it('registerProvider throws for duplicate names', () => {
    expect(() => registerProvider({
      name: 'anthropic',
      kind: 'oauth',
      buildRequest() {
        return { url: 'https://example.com', method: 'GET', headers: {} };
      },
      parseResponse() {
        return { rateLimits: null, balance: null };
      },
    })).toThrow('Provider already registered: anthropic');
  });

  it('registerProvider throws for invalid adapters', () => {
    expect(() => registerProvider(null)).toThrow('Invalid provider adapter');
  });
});
