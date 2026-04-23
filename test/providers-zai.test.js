import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/providers/zai.js';
import { getProvider } from '../lib/providers/index.js';

const happy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-happy.json'), 'utf8'));
const legacyNoWeekly = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-legacy-no-weekly.json'), 'utf8'));
const fallback = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-fallback.json'), 'utf8'));
const malformed = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/zai-malformed.json'), 'utf8'));

describe('Z.ai Provider Adapter', () => {
  const adapter = getProvider('zai');

  it('buildRequest has no Bearer prefix (Z.ai quirk)', () => {
    const req = adapter.buildRequest({ token: 'TOK123' }, { baseUrl: 'https://api.z.ai/api/anthropic' });
    expect(req.headers.Authorization).toBe('TOK123');
    expect(req.headers.Authorization).not.toContain('Bearer');
  });

  it('buildRequest builds correct URL from baseUrl origin', () => {
    const req = adapter.buildRequest({ token: 'T' }, { baseUrl: 'https://api.z.ai/api/anthropic' });
    expect(req.url).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    expect(req.method).toBe('GET');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({}, { baseUrl: 'https://api.z.ai/api/anthropic' })).toThrow('zai: missing token');
  });

  it('buildRequest throws without baseUrl', () => {
    expect(() => adapter.buildRequest({ token: 'TOK123' })).toThrow('zai: missing baseUrl');
  });

  it('parseResponse maps unit=3 → five_hour, unit=6 → seven_day', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits.five_hour).not.toBeNull();
    expect(result.rateLimits.five_hour.utilization).toBe(15);
    expect(result.rateLimits.seven_day).not.toBeNull();
    expect(result.rateLimits.seven_day.utilization).toBe(45);
  });

  it('parseResponse ignores TIME_LIMIT when weekly TOKENS_LIMIT exists', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits.seven_day.utilization).toBe(45);
    expect(result.rateLimits.seven_day.resets_at).toBe(new Date(1746052800000).toISOString());
  });

  it('parseResponse promotes TIME_LIMIT to seven_day when weekly token bucket is absent', () => {
    const result = adapter.parseResponse(legacyNoWeekly, 200);
    expect(result.rateLimits.five_hour.utilization).toBe(80);
    expect(result.rateLimits.seven_day.utilization).toBe(60);
  });

  it('parseResponse uses nextResetTime sorting fallback when unit field is absent', () => {
    const result = adapter.parseResponse(fallback, 200);
    expect(result.rateLimits.five_hour.utilization).toBe(20);
    expect(result.rateLimits.seven_day.utilization).toBe(50);
  });

  it('parseResponse clamps malformed percentages and preserves null reset', () => {
    const result = adapter.parseResponse({
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, percentage: -5, nextResetTime: null },
          { type: 'TOKENS_LIMIT', unit: 6, percentage: 140, nextResetTime: null },
        ],
      },
    }, 200);

    expect(result.rateLimits.five_hour).toEqual({ utilization: 0, resets_at: null });
    expect(result.rateLimits.seven_day).toEqual({ utilization: 100, resets_at: null });
  });

  it('parseResponse returns malformed error when limits array is absent', () => {
    const result = adapter.parseResponse(malformed, 200);
    expect(result.error).toEqual({ reason: 'malformed' });
  });

  it('parseResponse returns http error on non-200 status', () => {
    const result = adapter.parseResponse(null, 429);
    expect(result.error).toEqual({ status: 429, reason: 'http' });
    expect(result.rateLimits).toBeNull();
  });

  it('parseResponse leaves unsupported rate limit fields as null', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits.seven_day_sonnet).toBeNull();
    expect(result.rateLimits.seven_day_opus).toBeNull();
    expect(result.rateLimits.extra_usage).toBeNull();
    expect(result.balance).toBeNull();
  });
});
