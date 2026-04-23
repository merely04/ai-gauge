import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/providers/minimax.js';
import { getProvider } from '../lib/providers/index.js';

const happy = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/minimax-happy.json'), 'utf8'));
const apiError = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/minimax-api-error.json'), 'utf8'));

describe('MiniMax Provider Adapter', () => {
  const adapter = getProvider('minimax');

  it('buildRequest builds URL from baseUrl origin', () => {
    const req = adapter.buildRequest({ token: 'TOK123' }, { baseUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2' });
    expect(req.url).toBe('https://api.minimax.chat/v1/api/openplatform/coding_plan/remains');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer TOK123');
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({}, { baseUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2' })).toThrow('minimax: missing token');
  });

  it('buildRequest throws without baseUrl', () => {
    expect(() => adapter.buildRequest({ token: 'TOK123' })).toThrow('minimax: missing baseUrl');
  });

  it('inverts remaining counters into used utilization', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits.five_hour.utilization).toBe(20);
  });

  it('calculates weekly utilization from remaining weekly quota', () => {
    const result = adapter.parseResponse(happy, 200);
    expect(result.rateLimits.seven_day.utilization).toBe(10);
  });

  it('matches model names case-insensitively', () => {
    const result = adapter.parseResponse({
      model_remains: [{
        model_name: 'mInImAx-M2',
        current_interval_total_count: 50,
        current_interval_usage_count: 25,
        current_weekly_total_count: 100,
        current_weekly_usage_count: 75,
      }],
    }, 200);

    expect(result.rateLimits.five_hour.utilization).toBe(50);
    expect(result.rateLimits.seven_day.utilization).toBe(25);
  });

  it('returns api error when base_resp status_code is non-zero', () => {
    const result = adapter.parseResponse(apiError, 200);
    expect(result.error).toEqual({ reason: 'api-error', status: 1008, message: 'quota exceeded' });
    expect(result.rateLimits).toBeNull();
  });

  it('returns no-model-found when no MiniMax-M model exists', () => {
    const result = adapter.parseResponse({ model_remains: [{ model_name: 'abab6.5s-chat' }] }, 200);
    expect(result.error).toEqual({ reason: 'no-model-found' });
    expect(result.rateLimits).toBeNull();
  });

  it('returns http error on non-200 status', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toEqual({ status: 401, reason: 'http' });
    expect(result.rateLimits).toBeNull();
  });
});
