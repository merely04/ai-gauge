import { describe, it, expect, afterEach, mock } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadCachedUsage } from '../lib/cache-loader.js';

function createTempDir() {
  const tempDir = `/tmp/ai-gauge-cache-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function writeCache(dir, data) {
  const path = join(dir, 'usage.json');
  writeFileSync(path, JSON.stringify(data));
  return path;
}

describe('loadCachedUsage', () => {
  let tempDir;

  const baseConfig = { tokenSource: 'claude-code', plan: 'unknown', displayMode: 'full', autoCheckUpdates: true };
  const baseOpts = {
    expectedTokenSource: 'claude-code',
    expectedProvider: 'anthropic',
    config: baseConfig,
    fallbackPlan: 'pro',
  };

  afterEach(() => {
    mock.restore();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('returns null for missing file', async () => {
    const result = await loadCachedUsage('/nonexistent/path/usage.json', baseOpts);
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    tempDir = createTempDir();
    const path = join(tempDir, 'usage.json');
    writeFileSync(path, 'not valid json {]');

    const result = await loadCachedUsage(path, baseOpts);
    expect(result).toBeNull();
  });

  it('returns null when neither five_hour nor balance nor copilot present', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, { meta: { tokenSource: 'claude-code', provider: 'anthropic' } });

    const result = await loadCachedUsage(path, baseOpts);
    expect(result).toBeNull();
  });

  it('loads cache when only copilot field is present', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      copilot: {
        plan: 'pro',
        premium_interactions: { utilization: 50, used: 150, limit: 300, resets_at: '2099-05-01T00:00:00Z' },
      },
      meta: { tokenSource: 'github', provider: 'copilot' },
    });

    const result = await loadCachedUsage(path, {
      expectedTokenSource: 'github',
      expectedProvider: 'copilot',
      config: { ...baseConfig, tokenSource: 'github' },
      fallbackPlan: 'unknown',
    });

    expect(result).not.toBeNull();
    expect(result.copilot.plan).toBe('pro');
    expect(result.meta.provider).toBe('copilot');
    expect(result.meta.tokenSource).toBe('github');
  });

  it('returns null and logs when tokenSource mismatches', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'opencode', provider: 'anthropic' },
    });
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;

    const result = await loadCachedUsage(path, baseOpts);

    console.warn = originalWarn;
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warn.mock.calls[0][0]);
    expect(payload.event).toBe('cache_invalidated');
    expect(payload.reason).toBe('tokenSource_mismatch');
    expect(payload.cached).toBe('opencode');
    expect(payload.expected).toBe('claude-code');
  });

  it('returns null and logs when provider mismatches', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'zai' },
    });
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;

    const result = await loadCachedUsage(path, baseOpts);

    console.warn = originalWarn;
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warn.mock.calls[0][0]);
    expect(payload.event).toBe('cache_invalidated');
    expect(payload.reason).toBe('provider_mismatch');
    expect(payload.cached).toBe('zai');
    expect(payload.expected).toBe('anthropic');
  });

  it('returns data when everything matches', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'anthropic', plan: 'pro' },
    });

    const result = await loadCachedUsage(path, baseOpts);

    expect(result).not.toBeNull();
    expect(result.five_hour.utilization).toBe(50);
    expect(result.meta.provider).toBe('anthropic');
    expect(result.meta.tokenSource).toBe('claude-code');
    expect(result.meta.plan).toBe('pro');
  });

  it('returns data for credit-based cache without five_hour', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      balance: { currency: 'USD', total_cents: 10000, used_cents: 5000 },
      meta: { tokenSource: 'claude-settings:openrouter', provider: 'openrouter' },
    });

    const result = await loadCachedUsage(path, {
      expectedTokenSource: 'claude-settings:openrouter',
      expectedProvider: 'openrouter',
      config: { ...baseConfig, tokenSource: 'claude-settings:openrouter' },
    });

    expect(result).not.toBeNull();
    expect(result.balance.total_cents).toBe(10000);
    expect(result.meta.provider).toBe('openrouter');
  });

  it('preserves original fetchedAt when present', async () => {
    tempDir = createTempDir();
    const originalFetchedAt = '2025-01-15T10:00:00.000Z';
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'anthropic', fetchedAt: originalFetchedAt },
    });

    const result = await loadCachedUsage(path, baseOpts);
    expect(result.meta.fetchedAt).toBe(originalFetchedAt);
  });

  it('loads legacy cache when provider field is missing', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code' },
    });

    const result = await loadCachedUsage(path, baseOpts);
    expect(result).not.toBeNull();
    expect(result.meta.provider).toBe('anthropic');
  });

  it('loads legacy cache when tokenSource field is missing', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { provider: 'anthropic' },
    });

    const result = await loadCachedUsage(path, baseOpts);
    expect(result).not.toBeNull();
    expect(result.meta.tokenSource).toBe('claude-code');
  });

  it('skips provider mismatch check when expectedProvider is missing', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'zai' },
    });

    const result = await loadCachedUsage(path, {
      expectedTokenSource: 'claude-code',
      config: baseConfig,
    });

    expect(result).not.toBeNull();
    expect(result.meta.provider).toBe('zai');
  });

  it('uses fallbackPlan when config plan is unknown and cache has no plan', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      five_hour: { utilization: 50, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'anthropic' },
    });

    const result = await loadCachedUsage(path, baseOpts);
    expect(result).not.toBeNull();
    expect(result.meta.plan).toBe('pro');
  });

  it('strips typed and unknown top-level fields from cached payload', async () => {
    tempDir = createTempDir();
    const path = writeCache(tempDir, {
      type: 'updateAvailable',
      evil: { injected: true },
      five_hour: { utilization: 50, resets_at: null },
      seven_day: { utilization: 12, resets_at: null },
      meta: { tokenSource: 'claude-code', provider: 'anthropic' },
    });

    const result = await loadCachedUsage(path, baseOpts);

    expect(result).not.toBeNull();
    expect(result.type).toBeUndefined();
    expect(result.evil).toBeUndefined();
    expect(result.five_hour.utilization).toBe(50);
    expect(result.seven_day.utilization).toBe(12);
  });
});
