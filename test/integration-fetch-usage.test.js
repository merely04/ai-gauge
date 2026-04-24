import { afterEach, beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const zaiFixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-happy.json'), 'utf8'));
const codexFixturePro = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/codex-wham-usage-pro.json'), 'utf8'));
const codexSessionFixture = readFileSync(join(import.meta.dir, 'fixtures/providers/codex-session-rollout.jsonl'), 'utf8');

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
});
