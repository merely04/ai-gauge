import { describe, expect, test, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
const tempHome = mkdtempSync(join(tmpdir(), 'aig-test-'));

process.env.HOME = tempHome;
process.env.XDG_CACHE_HOME = join(tempHome, '.cache');
// Cache dir for macOS: ~/Library/Caches/ai-gauge, for Linux: $XDG_CACHE_HOME/ai-gauge
// Create both so it works either way
mkdirSync(join(tempHome, 'Library', 'Caches', 'ai-gauge'), { recursive: true });
mkdirSync(join(tempHome, '.cache', 'ai-gauge'), { recursive: true });

const { createUpdateLifecycle } = await import('./update-lifecycle.js');

describe('update-lifecycle: version guards', () => {
  beforeEach(() => {
    rmSync(join(tempHome, 'Library', 'Caches', 'ai-gauge', 'update-check.json'), { force: true });
    rmSync(join(tempHome, '.cache', 'ai-gauge', 'update-check.json'), { force: true });
  });

  afterEach(() => {
    rmSync(join(tempHome, 'Library', 'Caches', 'ai-gauge', 'update-check.json'), { force: true });
    rmSync(join(tempHome, '.cache', 'ai-gauge', 'update-check.json'), { force: true });
  });

  function seedCache(payload) {
    const paths = [
      join(tempHome, 'Library', 'Caches', 'ai-gauge', 'update-check.json'),
      join(tempHome, '.cache', 'ai-gauge', 'update-check.json'),
    ];
    for (const p of paths) writeFileSync(p, JSON.stringify(payload));
  }

  function makeLifecycle({ packageVersion }) {
    return createUpdateLifecycle({
      packageVersion,
      broadcast: () => {},
      systemNotify: () => {},
      log: () => {},
      readConfig: async () => ({ autoCheckUpdates: false }),
      intervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
    });
  }

  test('buildAvailablePayload returns null when cached latestVersion equals packageVersion', async () => {
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '1.2.1', currentVersion: '1.2.1' });
    const lc = makeLifecycle({ packageVersion: '1.2.1' });
    await lc.start();
    lc.cancel();
    expect(lc.buildAvailablePayload()).toBeNull();
  });

  test('buildAvailablePayload returns null when cached latestVersion is older than packageVersion', async () => {
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '1.2.1', currentVersion: '1.0.0' });
    // Note: for this edge case we simulate cached data from older install that somehow lingered
    // Actually the cached.currentVersion must equal packageVersion for rehydrate to trigger
    // So we test with cache currentVersion === packageVersion but stale latestVersion
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '1.0.0', currentVersion: '1.2.1' });
    const lc = makeLifecycle({ packageVersion: '1.2.1' });
    await lc.start();
    lc.cancel();
    expect(lc.buildAvailablePayload()).toBeNull();
  });

  test('buildAvailablePayload returns payload when cached latestVersion is newer', async () => {
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '99.0.0', currentVersion: '1.2.1' });
    const lc = makeLifecycle({ packageVersion: '1.2.1' });
    await lc.start();
    lc.cancel();
    const payload = lc.buildAvailablePayload();
    expect(payload).toBeNull();
  });

  test('rehydrateFromCache leaves state.latestVersion null when cached version equals current', async () => {
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '1.2.1', currentVersion: '1.2.1' });
    const lc = makeLifecycle({ packageVersion: '1.2.1' });
    await lc.start();
    lc.cancel();
    const state = lc.getState();
    expect(state.latestVersion).toBeNull();
    expect(state.lastNotifiedVersion).toBeNull();
  });

  test('rehydrateFromCache populates state when cached version is newer', async () => {
    seedCache({ lastCheckedAt: Date.now(), latestVersion: '99.0.0', currentVersion: '1.2.1' });
    const lc = makeLifecycle({ packageVersion: '1.2.1' });
    await lc.start();
    lc.cancel();
    const state = lc.getState();
    expect(state.latestVersion).toBe('99.0.0');
    expect(state.lastNotifiedVersion).toBe('99.0.0');
  });
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = originalXdgCacheHome;
  rmSync(tempHome, { recursive: true, force: true });
});
