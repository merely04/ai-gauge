import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/providers/komilion.js';
import { getProvider } from '../lib/providers/index.js';

const happy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/komilion-happy.json'), 'utf8'));
const lowBalance = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/komilion-low-balance.json'), 'utf8'));

describe('Komilion Provider Adapter', () => {
  const adapter = getProvider('komilion');

  it('buildRequest uses wallet balance endpoint', () => {
    const req = adapter.buildRequest({ token: 'TOK123' });
    expect(req.url).toBe('https://www.komilion.com/api/wallet/balance');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer TOK123');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({})).toThrow('komilion: missing token');
  });

  it('parses happy path balances into cents', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits).toBeNull();
    expect(result.balance.total_cents).toBe(5297);
    expect(result.balance.remaining_cents).toBe(5000);
  });

  it('propagates low balance flag into extras', () => {
    const result = adapter.parseResponse(lowBalance, 200);
    expect(result.balance.extras.is_low_balance).toBe(true);
    expect(result.balance.remaining_cents).toBe(150);
  });

  it('converts trial credits to cents', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.balance.extras.trial_credits_cents).toBe(297);
  });

  it('returns http error on non-200 status', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toEqual({ status: 401, reason: 'http' });
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });
});
