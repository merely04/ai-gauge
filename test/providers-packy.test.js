import { describe, it, expect } from 'bun:test';
import '../lib/providers/packy.js';
import { getProvider } from '../lib/providers/index.js';

describe('Packy Provider Adapter', () => {
  const adapter = getProvider('packy');

  it('buildRequest throws with correct message', () => {
    expect(() => adapter.buildRequest({ token: 'T' })).toThrow('packy provider has no public API');
  });

  it('adapter has stub kind', () => {
    expect(adapter.kind).toBe('stub');
  });

  it('adapter name is packy', () => {
    expect(adapter.name).toBe('packy');
  });
});
