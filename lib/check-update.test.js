import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkForUpdate,
  compareVersions,
  getCacheFilePath,
  isCiEnvironment,
  isNotifierDisabled,
  readCache,
  parseRegistryResponse,
  shouldSkipUpdateCheck,
  shouldCheck,
  writeCache,
} from './check-update.js';

const fixturePath = join(import.meta.dir, '..', 'test', 'fixtures', 'registry-response-v1.5.0.json');
const fixtureJson = readFileSync(fixturePath, 'utf8');

const semverFixtures = [
  ['1.0.0', '1.0.0', 0],
  ['1.0.0', '1.0.1', -1],
  ['1.0.1', '1.0.0', 1],
  ['1.0.0', '1.1.0', -1],
  ['2.0.0', '1.9.9', 1],
  ['1.0.0-alpha', '1.0.0', -1],
  ['1.0.0-alpha', '1.0.0-beta', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha.2', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha.10', -1],
  ['2.0.0-beta.1', '1.9.9', 1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0+build.1', '1.0.0+build.2', 0],
  ['1.0.0-alpha+sha.1', '1.0.0-alpha+sha.2', 0],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
  ['1.0.0-beta.2', '1.0.0-beta.11', -1],
  ['1.0.0-alpha-beta', '1.0.0-alpha-gamma', -1],
  ['1.0.0-rc-1', '1.0.0-rc-2', -1],
];

const ciVars = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'JENKINS_HOME',
  'BUILDKITE',
  'DRONE',
  'TRAVIS',
];

describe('compareVersions', () => {
  test.each(semverFixtures)('%s vs %s => %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('parseRegistryResponse', () => {
  test('parses fixture JSON string', () => {
    expect(parseRegistryResponse(fixtureJson)).toEqual({ latestVersion: '1.5.0' });
  });

  test('parses already parsed object input', () => {
    expect(parseRegistryResponse({ 'dist-tags': { latest: '1.5.0' } })).toEqual({ latestVersion: '1.5.0' });
  });

  test('returns malformed for invalid JSON string', () => {
    expect(parseRegistryResponse('{')).toEqual({ error: 'malformed' });
  });

  test('returns no-dist-tags when dist-tags missing', () => {
    expect(parseRegistryResponse({})).toEqual({ error: 'no-dist-tags' });
  });

  test('returns no-latest when latest missing', () => {
    expect(parseRegistryResponse({ 'dist-tags': {} })).toEqual({ error: 'no-latest' });
  });
});

describe('shouldCheck', () => {
  test('returns true when never checked', () => {
    expect(shouldCheck({ lastCheckedAt: null, intervalMs: 60_000, now: 1_000_000 })).toBe(true);
  });

  test('returns false for recent checks within interval', () => {
    expect(shouldCheck({ lastCheckedAt: 970_000, intervalMs: 60_000, now: 1_000_000 })).toBe(false);
  });

  test('returns true for stale checks past interval', () => {
    expect(shouldCheck({ lastCheckedAt: 939_999, intervalMs: 60_000, now: 1_000_000 })).toBe(true);
  });
});

describe('isCiEnvironment', () => {
  test.each(ciVars)('detects %s', (name) => {
    expect(isCiEnvironment({ [name]: '1' })).toBe(true);
  });

  test('returns false for empty env', () => {
    expect(isCiEnvironment({})).toBe(false);
  });

  test('ignores undefined CI when another CI var is present', () => {
    expect(isCiEnvironment({ CI: undefined, GITHUB_ACTIONS: '1' })).toBe(true);
  });
});

describe('isNotifierDisabled', () => {
  test('returns true when NO_UPDATE_NOTIFIER is set', () => {
    expect(isNotifierDisabled({ NO_UPDATE_NOTIFIER: '1' })).toBe(true);
  });

  test('returns false when NO_UPDATE_NOTIFIER is unset', () => {
    expect(isNotifierDisabled({})).toBe(false);
  });
});

describe('shouldSkipUpdateCheck', () => {
  test('returns skip:false when all checks pass', () => {
    expect(shouldSkipUpdateCheck({}, { autoCheckUpdates: true })).toEqual({ skip: false });
  });

  test('skips when NO_UPDATE_NOTIFIER is set', () => {
    const r = shouldSkipUpdateCheck({ NO_UPDATE_NOTIFIER: '1' }, { autoCheckUpdates: true });
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/NO_UPDATE_NOTIFIER/);
  });

  test('skips when CI is detected', () => {
    const r = shouldSkipUpdateCheck({ CI: 'true' }, { autoCheckUpdates: true });
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/CI/);
  });

  test('skips when autoCheckUpdates is false', () => {
    const r = shouldSkipUpdateCheck({}, { autoCheckUpdates: false });
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/autoCheckUpdates/);
  });
});

describe('getCacheFilePath', () => {
  test('returns a path ending with update-check.json', () => {
    const p = getCacheFilePath();
    expect(p).toMatch(/update-check\.json$/);
    expect(p.length).toBeGreaterThan(10);
  });
});

describe('readCache / writeCache', () => {
  test('round-trips data through cache file', () => {
    const tmpFile = '/tmp/test-ai-gauge-cache-' + Date.now() + '.json';
    const data = { lastCheckedAt: 12345, latestVersion: '1.0.0', currentVersion: '0.9.0' };
    writeCache(tmpFile, data);
    const result = readCache(tmpFile);
    expect(result).toEqual(data);
    // Cleanup
    try { Bun.file(tmpFile).unlink?.(); } catch {}
  });

  test('readCache returns null for missing file', () => {
    expect(readCache('/tmp/nonexistent-ai-gauge-cache.json')).toBeNull();
  });

  test('writeCache uses atomic temp file (write is idempotent)', () => {
    const tmpFile = '/tmp/test-ai-gauge-atomic-' + Date.now() + '.json';
    const data = { lastCheckedAt: 1, latestVersion: '2.0.0', currentVersion: '1.0.0' };
    writeCache(tmpFile, data);
    writeCache(tmpFile, { ...data, lastCheckedAt: 2 });
    const result = readCache(tmpFile);
    expect(result.lastCheckedAt).toBe(2);
  });
});

describe('checkForUpdate', () => {
  test('returns updateAvailable when newer version exists', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ 'dist-tags': { latest: '1.5.0' } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    try {
      const result = await checkForUpdate({
        currentVersion: '1.0.0',
        registryUrl: `http://localhost:${server.port}`,
        packageName: 'ai-gauge',
      });

      expect(result).toEqual({
        updateAvailable: true,
        latestVersion: '1.5.0',
        currentVersion: '1.0.0',
      });
    } finally {
      server.stop();
    }
  });

  test('returns no update when current version is newer prerelease/build equivalent', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ 'dist-tags': { latest: '1.5.0+build.9' } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    try {
      const result = await checkForUpdate({
        currentVersion: '1.5.0+build.1',
        registryUrl: `http://localhost:${server.port}`,
        packageName: 'ai-gauge',
      });

      expect(result).toEqual({
        updateAvailable: false,
        latestVersion: '1.5.0+build.9',
        currentVersion: '1.5.0+build.1',
      });
    } finally {
      server.stop();
    }
  });

  test('returns HTTP errors with status code', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchFn: async () => new Response('nope', { status: 503 }),
    });

    expect(result).toEqual({ error: 'http-503', currentVersion: '1.0.0' });
  });

  test('returns parse error when registry payload has no latest tag', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchFn: async () => new Response(JSON.stringify({ 'dist-tags': {} }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(result).toEqual({ error: 'no-latest', currentVersion: '1.0.0' });
  });

  test('returns malformed when registry returns invalid JSON', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchFn: async () => new Response('{', {
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(result).toEqual({ error: 'malformed', currentVersion: '1.0.0' });
  });

  test('returns timeout when fetch aborts', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      timeoutMs: 20,
      fetchFn: (_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }),
    });

    expect(result).toEqual({ error: 'timeout', currentVersion: '1.0.0' });
  });

  test('returns network for non-timeout fetch failures', async () => {
    const result = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchFn: async () => {
        throw new Error('socket hang up');
      },
    });

    expect(result).toEqual({ error: 'network', currentVersion: '1.0.0' });
  });

  test('sends ai-gauge user agent header', async () => {
    let requestHeaders;

    const result = await checkForUpdate({
      currentVersion: '1.2.3',
      fetchFn: async (_, options) => {
        requestHeaders = options.headers;
        return new Response(JSON.stringify({ 'dist-tags': { latest: '1.2.3' } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(result).toEqual({
      updateAvailable: false,
      latestVersion: '1.2.3',
      currentVersion: '1.2.3',
    });
    expect(requestHeaders['User-Agent']).toBe('ai-gauge/1.2.3');
    expect(requestHeaders.Accept).toBe('application/json');
  });
});
