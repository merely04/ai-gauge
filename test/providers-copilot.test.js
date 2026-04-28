import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import copilotModule, { copilot } from '../lib/providers/copilot.js';
import { getProvider } from '../lib/providers/index.js';

const proFixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/providers/copilot-individual-pro-happy.json'), 'utf8'),
);
const freeFixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/providers/copilot-individual-free.json'), 'utf8'),
);
const overageFixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/providers/copilot-individual-overage.json'), 'utf8'),
);

describe('Copilot Provider Adapter', () => {
  const adapter = getProvider('copilot');

  it('buildRequest returns correct URL, method, and headers', () => {
    const req = adapter.buildRequest({ token: 'gho_FAKE' });
    expect(req.url).toBe('https://api.github.com/copilot_internal/v2/token');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer gho_FAKE');
    expect(req.headers['User-Agent']).toMatch(/^GithubCopilot\//);
    expect(req.headers['Editor-Version']).toMatch(/^vscode\//);
    expect(req.headers['Editor-Plugin-Version']).toMatch(/^copilot\//);
    expect(req.headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(req.headers.Accept).toBe('application/json');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({})).toThrow('copilot: missing token');
  });

  it('buildRequest throws when creds is null', () => {
    expect(() => adapter.buildRequest(null)).toThrow('copilot: missing token');
  });

  it('parseResponse(pro fixture, 200) returns plan=pro with correct premium_interactions', () => {
    const result = adapter.parseResponse(proFixture, 200);
    expect(result.copilot.plan).toBe('pro');
    expect(result.copilot.premium_interactions.used).toBe(150);
    expect(result.copilot.premium_interactions.limit).toBe(300);
    expect(result.copilot.premium_interactions.utilization).toBe(50);
    expect(result.copilot.premium_interactions.resets_at).toBe('2026-05-01T00:00:00Z');
    expect(result.copilot.premium_interactions.overage_count).toBe(0);
    expect(result.copilot.premium_interactions.overage_permitted).toBe(false);
  });

  it('parseResponse(free fixture, 200) returns plan=free', () => {
    const result = adapter.parseResponse(freeFixture, 200);
    expect(result.copilot.plan).toBe('free');
    expect(result.copilot.premium_interactions.limit).toBe(50);
    expect(result.copilot.premium_interactions.used).toBe(40);
    expect(result.copilot.premium_interactions.utilization).toBe(80);
  });

  it('parseResponse(overage fixture, 200) returns plan=pro-plus with overage data', () => {
    const result = adapter.parseResponse(overageFixture, 200);
    expect(result.copilot.plan).toBe('pro-plus');
    expect(result.copilot.premium_interactions.limit).toBe(1500);
    expect(result.copilot.premium_interactions.used).toBe(1520);
    expect(result.copilot.premium_interactions.overage_count).toBe(20);
    expect(result.copilot.premium_interactions.overage_permitted).toBe(true);
    expect(result.copilot.premium_interactions.utilization).toBeGreaterThanOrEqual(100);
  });

  it('parseResponse(happy fixture, 200) sets rateLimits and balance to null', () => {
    const result = adapter.parseResponse(proFixture, 200);
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('parseResponse(happy fixture, 200) has no error field', () => {
    const result = adapter.parseResponse(proFixture, 200);
    expect(result.error).toBeUndefined();
  });

  it('parseResponse(null, 401) returns httpError with copilot=null', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(401);
    expect(result.error.reason).toBe('http');
    expect(result.copilot).toBeNull();
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('parseResponse({}, 200) returns no-copilot-subscription error when quota block missing', () => {
    const result = adapter.parseResponse({}, 200);
    expect(result.copilot).toBeNull();
    expect(result.error).toEqual({ reason: 'no-copilot-subscription' });
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('parseResponse caps utilization at 200% for extreme overage', () => {
    const extreme = {
      limited_user_quotas: {
        copilot_premium_interaction: { storage: 99999, limit: 300, reset_date: null },
      },
    };
    const result = adapter.parseResponse(extreme, 200);
    expect(result.copilot.premium_interactions.utilization).toBe(200);
  });

  it('parseResponse handles limit=0 without dividing by zero', () => {
    const zero = {
      limited_user_quotas: {
        copilot_premium_interaction: { storage: 0, limit: 0, reset_date: null },
      },
    };
    const result = adapter.parseResponse(zero, 200);
    expect(result.copilot.premium_interactions.utilization).toBe(0);
    expect(result.copilot.plan).toBe('unknown');
  });

  it('exports named copilot adapter equal to default export', () => {
    expect(copilot).toBe(copilotModule);
    expect(copilot.name).toBe('copilot');
    expect(copilot.kind).toBe('oauth');
  });

  it('getProvider("copilot") returns the registered adapter', () => {
    expect(adapter.name).toBe('copilot');
    expect(adapter).toBe(copilot);
  });
});
