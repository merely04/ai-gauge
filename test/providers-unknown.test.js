import { describe, it, expect } from 'bun:test';
import '../lib/providers/unknown.js';
import { getProvider, detectProviderByBaseUrl } from '../lib/providers/index.js';

describe('Unknown Provider Adapter', () => {
  const adapter = getProvider('unknown');

  it('buildRequest throws with correct message', () => {
    expect(() => adapter.buildRequest({ token: 'T' })).toThrow('unknown provider — base URL not recognized');
  });

  it('adapter has stub kind', () => {
    expect(adapter.kind).toBe('stub');
  });

  it('detectProviderByBaseUrl returns unknown for unrecognized URL', () => {
    expect(detectProviderByBaseUrl('https://nekro.ai/anthropic')).toBe('unknown');
  });
});
