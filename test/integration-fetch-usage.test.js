import { afterEach, beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const zaiFixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-happy.json'), 'utf8'));
const codexFixturePro = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/codex-wham-usage-pro.json'), 'utf8'));
const codexSessionFixture = readFileSync(join(import.meta.dir, 'fixtures/providers/codex-session-rollout.jsonl'), 'utf8');

let fetchUsage;
let setFetchImpl;
let setReadCredentialsImpl;

beforeAll(async () => {
  const serverModule = await import('../bin/ai-gauge-server');
  fetchUsage = serverModule.fetchUsage;
  setFetchImpl = serverModule.setFetchImpl;
  setReadCredentialsImpl = serverModule.setReadCredentialsImpl;
});

afterEach(() => {
  setFetchImpl(null);
  setReadCredentialsImpl(null);
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

describe('fetchUsage — token rotation retry on 401', () => {
  const anthropicHappy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/anthropic-happy.json'), 'utf8'));

  it('on 401, re-reads credentials and retries with rotated token', async () => {
    const tokensSeen = [];
    setFetchImpl(async (url, opts) => {
      const auth = (opts.headers?.Authorization ?? opts.headers?.authorization ?? '').toString();
      tokensSeen.push(auth);
      if (auth.includes('STALE')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify(anthropicHappy), { status: 200 });
    });

    setReadCredentialsImpl(async () => ({
      token: 'FRESH-TOKEN-FROM-KEYCHAIN',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      subscriptionType: 'pro',
      baseUrl: null,
    }));

    const result = await fetchUsage({
      token: 'STALE-TOKEN',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(true);
    expect(tokensSeen.length).toBe(2);
    expect(tokensSeen[0]).toContain('STALE');
    expect(tokensSeen[1]).toContain('FRESH-TOKEN-FROM-KEYCHAIN');
  });

  it('on 401, does NOT retry when re-read returns the same (still stale) token', async () => {
    let calls = 0;
    setFetchImpl(async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    });

    setReadCredentialsImpl(async () => ({
      token: 'STILL-STALE',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      subscriptionType: 'pro',
      baseUrl: null,
    }));

    const result = await fetchUsage({
      token: 'STILL-STALE',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(false);
    expect(calls).toBe(1);
  });

  it('on 401, retries at most ONCE even if rotated token also returns 401', async () => {
    let calls = 0;
    setFetchImpl(async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    });

    setReadCredentialsImpl(async () => ({
      token: `ROTATED-${Math.random()}`,
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      subscriptionType: 'pro',
      baseUrl: null,
    }));

    const result = await fetchUsage({
      token: 'INITIAL',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'claude-code',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(false);
    expect(calls).toBe(2);
  });

  it('does NOT retry on 401 for custom claude-settings providers (baseUrl set)', async () => {
    let calls = 0;
    setFetchImpl(async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    });

    let rereadCalled = false;
    setReadCredentialsImpl(async () => {
      rereadCalled = true;
      return null;
    });

    const result = await fetchUsage({
      token: 'CUSTOM',
      expiresAt: null,
      provider: 'zai',
      tokenSource: 'claude-settings:zai',
      baseUrl: 'https://api.z.ai/api/anthropic',
      subscriptionType: 'unknown',
    });

    expect(result).toBe(false);
    expect(calls).toBe(1);
    expect(rereadCalled).toBe(false);
  });
});

describe('fetchUsage opencode + secondary codex', () => {
  const anthropicHappy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/anthropic-happy.json'), 'utf8'));

  afterEach(() => {
    setFetchImpl(null);
  });

  it('fetches both anthropic and codex, attaches secondary to broadcast', async () => {
    const calls = [];
    setFetchImpl(async (url) => {
      calls.push(url);
      if (url.includes('api.anthropic.com')) {
        return new Response(JSON.stringify(anthropicHappy), { status: 200 });
      }
      if (url.includes('chatgpt.com')) {
        return new Response(JSON.stringify(codexFixturePro), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchUsage({
      token: 'ANT_TOKEN',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'opencode',
      baseUrl: null,
      subscriptionType: 'unknown',
      secondary: {
        provider: 'codex',
        token: 'CODEX_TOKEN',
        account_id: 'user-x',
        expiresAt: null,
        subscriptionType: 'unknown',
      },
    });

    expect(result).toBe(true);
    expect(calls.some((u) => u.includes('api.anthropic.com'))).toBe(true);
    expect(calls.some((u) => u.includes('chatgpt.com'))).toBe(true);
  });

  it('primary success + secondary fail still returns true (secondary is best-effort)', async () => {
    setFetchImpl(async (url) => {
      if (url.includes('api.anthropic.com')) {
        return new Response(JSON.stringify(anthropicHappy), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    });

    const result = await fetchUsage({
      token: 'ANT_TOKEN',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'opencode',
      baseUrl: null,
      subscriptionType: 'unknown',
      secondary: {
        provider: 'codex',
        token: 'EXPIRED',
        account_id: 'user-x',
        expiresAt: null,
        subscriptionType: 'unknown',
      },
    });

    expect(result).toBe(true);
  });

  it('skips secondary fetch when secondary expires is in the past', async () => {
    let codexCalled = false;
    setFetchImpl(async (url) => {
      if (url.includes('chatgpt.com')) {
        codexCalled = true;
        return new Response('should not be called', { status: 200 });
      }
      return new Response(JSON.stringify(anthropicHappy), { status: 200 });
    });

    const result = await fetchUsage({
      token: 'ANT_TOKEN',
      expiresAt: null,
      provider: 'anthropic',
      tokenSource: 'opencode',
      baseUrl: null,
      subscriptionType: 'unknown',
      secondary: {
        provider: 'codex',
        token: 'X',
        account_id: 'y',
        expiresAt: Date.now() - 60_000,
        subscriptionType: 'unknown',
      },
    });

    expect(result).toBe(true);
    expect(codexCalled).toBe(false);
  });
});

describe('fetchUsage codex integration', () => {
  const codexHomeBase = `/tmp/codex-integ-${Math.random().toString(36).slice(2)}`;

  afterAll(() => {
    delete process.env.CODEX_HOME;
    try { rmSync(codexHomeBase, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    setFetchImpl(null);
    delete process.env.CODEX_HOME;
  });

  it('codex HTTP happy path returns true with meta.provider=codex', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(codexFixturePro), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await fetchUsage({
      token: 'FAKE_CODEX_TOKEN',
      account_id: 'FAKE_ACCOUNT_ID',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(true);
  });

  it('codex HTTP 401 falls back to JSONL when session exists', async () => {
    const sessDir = join(codexHomeBase, 'sessions', '2026', '04', '24');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, 'rollout-test.jsonl'), codexSessionFixture);
    process.env.CODEX_HOME = codexHomeBase;

    setFetchImpl(async () => new Response(JSON.stringify({ error: { code: 'invalid_token' } }), { status: 401 }));

    const result = await fetchUsage({
      token: 'EXPIRED_TOKEN',
      account_id: 'FAKE_ACCOUNT',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(true);
  });

  it('codex network error falls back to JSONL when session exists', async () => {
    process.env.CODEX_HOME = codexHomeBase;

    setFetchImpl(async () => { throw new Error('Network failure'); });

    const result = await fetchUsage({
      token: 'ANY_TOKEN',
      account_id: 'FAKE_ACCOUNT',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'plus',
    });

    expect(result).toBe(true);
  });

  it('codex HTTP 200 with null JSON returns false (no fallback for empty response)', async () => {
    process.env.CODEX_HOME = codexHomeBase;

    setFetchImpl(async () => new Response('', { status: 200 }));

    const result = await fetchUsage({
      token: 'TOKEN',
      account_id: 'ACC',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'plus',
    });

    expect(result).toBe(false);
  });

  it('codex missing JSONL fallback after HTTP failure returns false gracefully', async () => {
    const emptyHome = `${codexHomeBase}-empty`;
    mkdirSync(join(emptyHome, 'sessions'), { recursive: true });
    process.env.CODEX_HOME = emptyHome;

    setFetchImpl(async () => new Response(null, { status: 500 }));

    const result = await fetchUsage({
      token: 'TOKEN',
      account_id: 'ACC',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'unknown',
    });

    expect(result).toBe(false);
    rmSync(emptyHome, { recursive: true, force: true });
  });

  it('codex HTTP 404 does NOT trigger JSONL fallback (only 401/403/5xx)', async () => {
    const sessDir = join(codexHomeBase, 'sessions', '2026', '04', '24');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, 'rollout-test.jsonl'), codexSessionFixture);
    process.env.CODEX_HOME = codexHomeBase;

    let fallbackHit = false;
    setFetchImpl(async () => {
      fallbackHit = true;
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });

    const result = await fetchUsage({
      token: 'TOKEN',
      account_id: 'ACC',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(fallbackHit).toBe(true);
    expect(result).toBe(false);
  });

  it('codex HTTP 429 does NOT trigger JSONL fallback', async () => {
    const sessDir = join(codexHomeBase, 'sessions', '2026', '04', '24');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, 'rollout-test.jsonl'), codexSessionFixture);
    process.env.CODEX_HOME = codexHomeBase;

    setFetchImpl(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }));

    const result = await fetchUsage({
      token: 'TOKEN',
      account_id: 'ACC',
      expiresAt: null,
      provider: 'codex',
      tokenSource: 'codex',
      baseUrl: null,
      subscriptionType: 'pro',
    });

    expect(result).toBe(false);
  });

  it('codex with no creds (auth.json missing) but JSONL sessions present uses fallback', async () => {
    const sessDir = join(codexHomeBase, 'sessions', '2026', '04', '24');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, 'rollout-test.jsonl'), codexSessionFixture);
    process.env.CODEX_HOME = codexHomeBase;

    setFetchImpl(async () => { throw new Error('should not be called'); });

    const result = await fetchUsage(null, {
      tokenSource: 'codex',
      plan: 'pro',
      autoCheckUpdates: false,
      displayMode: 'full',
    });

    expect(result).toBe(true);
  });
});
