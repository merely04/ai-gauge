import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/providers/codex.js';
import { getProvider } from '../lib/providers/index.js';
import { parseCodexJsonlFallback } from '../lib/providers/codex.js';

const fixturePlus = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/codex-wham-usage-plus.json'), 'utf8'));
const fixturePro = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/codex-wham-usage-pro.json'), 'utf8'));

describe('Codex Provider Adapter', () => {
  const adapter = getProvider('codex');

  it('adapter name is codex and kind is oauth', () => {
    expect(adapter.name).toBe('codex');
    expect(adapter.kind).toBe('oauth');
  });

  it('buildRequest returns correct URL and headers', () => {
    const req = adapter.buildRequest({ token: 'FAKE_T', account_id: 'FAKE_A' });
    expect(req.url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer FAKE_T');
    expect(req.headers['ChatGPT-Account-Id']).toBe('FAKE_A');
    expect(req.headers['User-Agent']).toContain('codex_cli_rs/');
    expect(req.headers.Accept).toBe('application/json');
  });

  it('buildRequest uses custom codexVersion', () => {
    const req = adapter.buildRequest({ token: 'T', account_id: 'A', codexVersion: '1.2.3' });
    expect(req.headers['User-Agent']).toBe('codex_cli_rs/1.2.3');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({})).toThrow(/codex: missing token/);
  });

  it('buildRequest throws without account_id', () => {
    expect(() => adapter.buildRequest({ token: 'T' })).toThrow(/codex: missing account_id/);
  });

  it('parseResponse(fixturePlus, 200) returns rateLimits for Plus (no code_review, no balance)', () => {
    const result = adapter.parseResponse(fixturePlus, 200);
    expect(result.error).toBeUndefined();
    expect(result.rateLimits.five_hour.utilization).toBe(42);
    expect(result.rateLimits.code_review).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('parseResponse(fixturePro, 200) returns code_review and balance when has_credits=true', () => {
    const result = adapter.parseResponse(fixturePro, 200);
    expect(result.error).toBeUndefined();
    expect(result.rateLimits.code_review).not.toBeNull();
    expect(result.rateLimits.code_review.utilization).toBe(30);
    expect(result.balance).not.toBeNull();
    expect(result.balance.total_cents).toBe(539);
  });

  it('parseResponse(fixturePro, 200).rateLimits.five_hour.resets_at is ISO-8601 string', () => {
    const result = adapter.parseResponse(fixturePro, 200);
    const resets = result.rateLimits.five_hour.resets_at;
    expect(typeof resets).toBe('string');
    expect(resets).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('parseResponse null json at 200 returns empty-response error', () => {
    const result = adapter.parseResponse(null, 200);
    expect(result.error).toEqual({ reason: 'empty-response' });
    expect(result.balance).toBeNull();
    expect(result.rateLimits).toBeNull();
  });

  it('parseResponse null at 401 returns http error', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(401);
    expect(result.rateLimits).toBeNull();
  });

  it('parseResponse with error object at 200 returns empty-response (HTML body guard)', () => {
    const result = adapter.parseResponse('<html>Login required</html>', 200);
    expect(result.error).toBeDefined();
  });

  it('all Anthropic-specific fields are null for codex', () => {
    const result = adapter.parseResponse(fixturePlus, 200);
    expect(result.rateLimits.seven_day_sonnet).toBeNull();
    expect(result.rateLimits.seven_day_opus).toBeNull();
    expect(result.rateLimits.extra_usage).toBeNull();
    expect(result.rateLimits.seven_day_oauth_apps).toBeNull();
    expect(result.rateLimits.seven_day_cowork).toBeNull();
    expect(result.rateLimits.seven_day_omelette).toBeNull();
  });
});

describe('parseCodexJsonlFallback', () => {
  const tmpBase = `/tmp/codex-test-fallback-${Math.random().toString(36).slice(2)}`;

  it('finds token_count event and returns rateLimits with ISO resets_at', async () => {
    const sessDir = join(tmpBase, 'sessions', '2026', '04', '24');
    mkdirSync(sessDir, { recursive: true });
    const fixture = readFileSync(join(import.meta.dir, 'fixtures/providers/codex-session-rollout.jsonl'), 'utf8');
    writeFileSync(join(sessDir, 'rollout-test.jsonl'), fixture);

    const result = await parseCodexJsonlFallback({ codexHome: tmpBase });
    expect(result).not.toBeNull();
    expect(typeof result.rateLimits.five_hour.resets_at).toBe('string');
    expect(result.rateLimits.five_hour.resets_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.balance).toBeNull();

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('returns null for empty sessions dir', async () => {
    const emptyHome = `${tmpBase}-empty`;
    mkdirSync(join(emptyHome, 'sessions'), { recursive: true });
    const result = await parseCodexJsonlFallback({ codexHome: emptyHome });
    expect(result).toBeNull();
    rmSync(emptyHome, { recursive: true, force: true });
  });

  it('returns null for non-existent codexHome', async () => {
    const result = await parseCodexJsonlFallback({ codexHome: '/tmp/codex-does-not-exist-99999' });
    expect(result).toBeNull();
  });
});
