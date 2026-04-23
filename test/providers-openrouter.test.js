import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/providers/openrouter.js';
import { getProvider } from '../lib/providers/index.js';

const happy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/openrouter-happy.json'), 'utf8'));
const unlimited = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/openrouter-unlimited.json'), 'utf8'));

describe('OpenRouter Provider Adapter', () => {
  const adapter = getProvider('openrouter');

  it('buildRequest uses OpenRouter key endpoint', () => {
    const req = adapter.buildRequest({ token: 'TOK123' });
    expect(req.url).toBe('https://openrouter.ai/api/v1/key');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer TOK123');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({})).toThrow('openrouter: missing token');
  });

  it('converts dollar amounts to cents', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.balance.used_cents).toBe(5297);
    expect(result.balance.total_cents).toBe(10000);
    expect(result.balance.remaining_cents).toBe(4703);
  });

  it('supports unlimited keys with null totals and remaining', () => {
    const result = adapter.parseResponse(unlimited, 200);
    expect(result.balance.total_cents).toBeNull();
    expect(result.balance.remaining_cents).toBeNull();
    expect(result.balance.used_cents).toBe(1550);
    expect(result.balance.percentage).toBeNull();
  });

  it('calculates percentage when limit is present', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.balance.percentage).toBeCloseTo(52.97, 10);
  });

  it('converts daily usage to cents', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.balance.usage_daily_cents).toBe(1234);
  });

  it('returns http error on non-200 status', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toEqual({ status: 401, reason: 'http' });
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('keeps rateLimits null for credit-balance provider', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits).toBeNull();
    expect(result.balance.currency).toBe('USD');
  });
});
