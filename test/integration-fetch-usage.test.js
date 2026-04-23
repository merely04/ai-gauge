import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const zaiFixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-happy.json'), 'utf8'));

let fetchUsage;
let setFetchImpl;

beforeAll(async () => {
  const serverModule = await import('../bin/ai-gauge-server');
  fetchUsage = serverModule.fetchUsage;
  setFetchImpl = serverModule.setFetchImpl;
});

afterEach(() => {
  setFetchImpl(null);
});

describe('fetchUsage integration', () => {
  it('dispatches to z.ai adapter with mock fetch', async () => {
    let captured = null;

    setFetchImpl(async (url, opts) => {
      captured = { url, opts };
      return new Response(JSON.stringify(zaiFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await fetchUsage({
      token: 'FAKE_ZAI_TOKEN',
      expiresAt: null,
      provider: 'zai',
      baseUrl: 'https://api.z.ai/api/anthropic',
      subscriptionType: 'unknown',
    });

    expect(result).toBe(true);
    expect(captured).toBeDefined();
    expect(captured.url).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    expect(captured.opts.method).toBe('GET');
    expect(captured.opts.redirect).toBe('manual');
    expect(captured.opts.headers.Authorization).toBe('FAKE_ZAI_TOKEN');
  });

  it('rejects stub providers without calling fetch', async () => {
    let called = false;

    setFetchImpl(async () => {
      called = true;
      throw new Error('fetch should not be called');
    });

    const result = await fetchUsage({
      token: 'FAKE_TOKEN',
      expiresAt: null,
      provider: 'packy',
      baseUrl: 'https://packyapi.com/v1',
      subscriptionType: 'unknown',
    });

    expect(result).toBe(false);
    expect(called).toBe(false);
  });

  it('rejects redirects instead of following them', async () => {
    let called = false;

    setFetchImpl(async () => {
      called = true;
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.example' },
      });
    });

    const result = await fetchUsage({
      token: 'FAKE_T',
      expiresAt: null,
      provider: 'anthropic',
      baseUrl: null,
      subscriptionType: 'unknown',
    });

    expect(result).toBe(false);
    expect(called).toBe(true);
  });
});
