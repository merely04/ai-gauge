import { describe, it, expect } from 'bun:test';
import ollamaCloudModule, { ollamaCloud } from '../lib/providers/ollama-cloud.js';
import { getProvider } from '../lib/providers/index.js';

const SESSION_RESET = '2026-07-01T10:00:00Z';
const WEEKLY_RESET = '2026-07-05T00:00:00Z';

const cloudUsageHeading = (plan) => `
  <h2 class="text-xl font-medium flex items-center space-x-2">
    <span>Cloud usage</span>
    <span
      class="text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 capitalize"
      >${plan}</span
    >
  </h2>`;

const sessionBlock = (pct, reset) => `
  <div>
    <div class="flex justify-between mb-2">
      <span class="text-sm ">Session usage</span>
      <span class="text-sm ">${pct}% used</span>
    </div>
    <div class="relative group" data-usage-meter>
      <div
        class="relative h-3 overflow-hidden rounded-full bg-neutral-200"
        data-usage-track
        aria-label="Session usage ${pct}% used"
      ></div>
    </div>
    <div class="text-xs text-neutral-500 mt-1 local-time" data-time="${reset}">
      Resets soon.
    </div>
  </div>`;

const weeklyBlock = (pct, reset) => `
  <div>
    <div class="flex justify-between mb-2">
      <span class="text-sm">Weekly usage</span>
      <span class="text-sm ">${pct}% used</span>
    </div>
    <div class="relative group" data-usage-meter>
      <div
        class="relative h-3 overflow-hidden rounded-full bg-neutral-200"
        data-usage-track
        aria-label="Weekly usage ${pct}% used"
      ></div>
    </div>
    <div class="text-xs text-neutral-500 mt-1 local-time" data-time="${reset}">
      Resets soon.
    </div>
  </div>`;

const faithfulFixture = `<!doctype html><html><body>
  ${cloudUsageHeading('pro')}
  ${sessionBlock('12.5', SESSION_RESET)}
  ${weeklyBlock('47', WEEKLY_RESET)}
</body></html>`;

const sessionOnlyFixture = `<!doctype html><html><body>
  ${cloudUsageHeading('pro')}
  ${sessionBlock('12.5', SESSION_RESET)}
</body></html>`;

const loginFixture = `<!doctype html><html><body>
  <form action="/signin" method="post">
    <input type="email" name="email" />
    <input type="password" name="password" />
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

describe('ollama-cloud provider adapter', () => {
  const adapter = getProvider('ollama-cloud');

  it('parses a faithful settings page into five_hour and seven_day', () => {
    const result = adapter.parseResponse(faithfulFixture, 200);
    expect(result.error).toBeUndefined();
    expect(result.balance).toBeNull();
    expect(result.rateLimits.five_hour).toEqual({ utilization: 12.5, resets_at: SESSION_RESET });
    expect(result.rateLimits.seven_day).toEqual({ utilization: 47, resets_at: WEEKLY_RESET });
    expect(result.plan).toBe('pro');
  });

  it('returns http error for non-200 status', () => {
    const result = adapter.parseResponse('<html></html>', 500);
    expect(result.error.reason).toBe('http');
    expect(result.error.status).toBe(500);
    expect(result.rateLimits).toBeNull();
  });

  it('returns no-usage-data when the page has no usage meters', () => {
    const result = adapter.parseResponse(loginFixture, 200);
    expect(result.error).toEqual({ reason: 'no-usage-data' });
    expect(result.rateLimits).toBeNull();
    expect(result.balance).toBeNull();
  });

  it('handles a session-only page gracefully when weekly is missing', () => {
    const result = adapter.parseResponse(sessionOnlyFixture, 200);
    expect(result.error).toBeUndefined();
    expect(result.rateLimits.five_hour).toEqual({ utilization: 12.5, resets_at: SESSION_RESET });
    expect(result.rateLimits.seven_day).toBeNull();
  });

  it('returns empty-response error for a non-string body', () => {
    const result = adapter.parseResponse(null, 200);
    expect(result.error).toEqual({ reason: 'empty-response' });
    expect(result.rateLimits).toBeNull();
  });

  it('buildRequest throws without a cookie', () => {
    expect(() => adapter.buildRequest({})).toThrow('ollama-cloud: missing cookie');
  });

  it('buildRequest sets the Cookie header and settings URL', () => {
    const req = adapter.buildRequest({ token: 'session=abc123; collab=1' });
    expect(req.url).toBe('https://ollama.com/settings');
    expect(req.method).toBe('GET');
    expect(req.headers.Cookie).toBe('session=abc123; collab=1');
    expect(req.headers['User-Agent']).toContain('Mozilla/5.0');
    expect(req.headers.Referer).toBe('https://ollama.com/');
  });

  it('declares text responseType, scrape kind, and no token retry', () => {
    expect(adapter.responseType).toBe('text');
    expect(adapter.kind).toBe('scrape');
    expect(adapter.supportsTokenRetry).toBeUndefined();
  });

  it('exports the named ollama-cloud adapter', () => {
    expect(ollamaCloud).toBe(ollamaCloudModule);
    expect(ollamaCloud.name).toBe('ollama-cloud');
  });
});
