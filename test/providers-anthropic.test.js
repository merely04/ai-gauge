import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import anthropicModule, { anthropic } from '../lib/providers/anthropic.js';
import { getProvider } from '../lib/providers/index.js';

const fixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/anthropic-happy.json'), 'utf8'));

describe('Anthropic Provider Adapter', () => {
  const adapter = getProvider('anthropic');

  it('buildRequest returns correct URL and headers', () => {
    const req = adapter.buildRequest({ token: 'FAKE_T', claudeVersion: '2.1.100' });
    expect(req.url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer FAKE_T');
    expect(req.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(req.headers['User-Agent']).toBe('claude-code/2.1.100');
  });

  it('buildRequest falls back to default claude version', () => {
    const req = adapter.buildRequest({ token: 'FAKE_T' });
    expect(req.headers['User-Agent']).toBe('claude-code/2.1.100');
  });

  it('parseResponse(fixture, 200) returns rateLimits with correct fields', () => {
    const result = adapter.parseResponse(fixture, 200);
    expect(result.balance).toBeNull();
    expect(result.rateLimits.five_hour).toEqual(fixture.five_hour);
    expect(result.rateLimits.seven_day).toEqual(fixture.seven_day);
    expect(result.rateLimits.extra_usage).toEqual(fixture.extra_usage);
  });

  it('parseResponse(fixture, 200) has no error field', () => {
    const result = adapter.parseResponse(fixture, 200);
    expect(result.error).toBeUndefined();
  });

  it('parseResponse(null, 401) returns error with status', () => {
    const result = adapter.parseResponse(null, 401);
    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(401);
    expect(result.rateLimits).toBeNull();
  });

  it('parseResponse(null, 200) returns empty-response error', () => {
    const result = adapter.parseResponse(null, 200);
    expect(result.error).toEqual({ reason: 'empty-response' });
    expect(result.balance).toBeNull();
  });

  it('buildRequest throws without token', () => {
    expect(() => adapter.buildRequest({})).toThrow('anthropic: missing token');
  });

  it('exports named anthropic adapter', () => {
    expect(anthropic).toBe(anthropicModule);
    expect(anthropic.name).toBe('anthropic');
  });
});
