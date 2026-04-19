import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SERVER_BIN = join(REPO_ROOT, 'bin', 'ai-gauge-server');
const SEND_WS = join(REPO_ROOT, 'lib', 'send-ws.js');
const PACKAGE_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
const WS_PORT = 19876;

function freePort() {
  return 19000 + Math.floor(Math.random() * 800);
}

function startMockRegistry({ port, latestVersion }) {
  return Bun.serve({
    port,
    fetch() {
      return new Response(JSON.stringify({ 'dist-tags': { latest: latestVersion } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function listenBroadcasts({ limitMs = 2000, filter = null } = {}) {
  return new Promise((resolve) => {
    const messages = [];
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(messages);
    }, limitMs);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (filter && data?.type !== filter) return;
        messages.push(data);
      } catch {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timer);
      resolve(messages);
    };
  });
}

function startServer({ home, registryPort, env = {} }) {
  const child = spawn('bun', [SERVER_BIN], {
    env: {
      HOME: home,
      PATH: process.env.PATH,
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_RUNTIME_DIR: join(home, '.state'),
      TMPDIR: join(home, '.state'),
      AIGAUGE_REGISTRY_URL: `http://localhost:${registryPort}`,
      AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS: '200',
      AIGAUGE_UPDATE_CHECK_INTERVAL_MS: '5000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: REPO_ROOT,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

  return { child, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function stopServer(srv) {
  if (!srv?.child) return;
  try { srv.child.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  try { srv.child.kill('SIGKILL'); } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    try {
      const probe = Bun.listen({
        hostname: '127.0.0.1',
        port,
        socket: { data() {}, open() {}, close() {}, error() {} },
      });
      probe.stop(true);
      resolve(false);
    } catch {
      resolve(true);
    }
  });
}

describe('update flow — end-to-end integration', () => {
  let home;
  let registryPort;
  let registry;
  let server;

  beforeEach(async () => {
    while (await isPortInUse(WS_PORT)) {
      await new Promise((r) => setTimeout(r, 200));
    }

    registryPort = freePort();
    home = `/tmp/ai-gauge-it-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mkdirSync(join(home, '.cache', 'ai-gauge'), { recursive: true });
    mkdirSync(join(home, '.state', 'ai-gauge'), { recursive: true });
    mkdirSync(join(home, '.config', 'ai-gauge'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Caches', 'ai-gauge'), { recursive: true });
  });

  afterEach(async () => {
    await stopServer(server);
    try { registry?.stop(true); } catch {}
    try { rmSync(home, { recursive: true, force: true }); } catch {}
  });

  test('broadcasts updateAvailable when registry has newer version', async () => {
    registry = startMockRegistry({ port: registryPort, latestVersion: '99.0.0' });
    server = startServer({ home, registryPort, env: { CI: '' } });

    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const messages = await listenBroadcasts({ limitMs: 3000, filter: 'updateAvailable' });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].latestVersion).toBe('99.0.0');
    expect(messages[0].type).toBe('updateAvailable');
    expect(messages[0].changelogUrl).toMatch(/github\.com.*releases.*v99\.0\.0/);
  }, 15000);

  test('scheduled check is skipped in CI environment', async () => {
    registry = startMockRegistry({ port: registryPort, latestVersion: '99.0.0' });
    server = startServer({ home, registryPort, env: { CI: 'true' } });

    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const skipped = await waitFor(() => server.stderr.includes('CI detected'), { timeoutMs: 3000 });
    expect(skipped).toBe(true);
  }, 15000);

  test('clears stale notification when registry rolls back', async () => {
    const cacheFile = join(home, 'Library', 'Caches', 'ai-gauge', 'update-check.json');
    writeFileSync(
      cacheFile,
      JSON.stringify({ lastCheckedAt: 100, latestVersion: '99.0.0', currentVersion: PACKAGE_VERSION }),
    );

    registry = startMockRegistry({ port: registryPort, latestVersion: '0.0.1' });
    server = startServer({ home, registryPort, env: { CI: '' } });

    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const stateFile = join(home, '.state', 'ai-gauge', 'update-state.json');
    const rolledBack = await waitFor(() => {
      if (!existsSync(stateFile)) return false;
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        return state.available === false && state.version === null;
      } catch {
        return false;
      }
    }, { timeoutMs: 5000 });

    expect(rolledBack).toBe(true);
  }, 15000);

  test('setConfig autoCheckUpdates=false cancels scheduler', async () => {
    registry = startMockRegistry({ port: registryPort, latestVersion: '99.0.0' });
    server = startServer({
      home,
      registryPort,
      env: { CI: '', AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS: '1000000' },
    });

    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    await new Promise((r) => setTimeout(r, 300));

    const proc = Bun.spawn(['bun', SEND_WS], {
      stdin: 'pipe',
      stdout: 'pipe',
      env: { ...process.env, AIGAUGE_WS_URL: `ws://localhost:${WS_PORT}` },
    });
    proc.stdin.write('{"type":"setConfig","key":"autoCheckUpdates","value":false}');
    proc.stdin.end();
    await proc.exited;

    const cancelled = await waitFor(
      () => server.stderr.includes('scheduler cancelled'),
      { timeoutMs: 3000 },
    );
    expect(cancelled).toBe(true);
  }, 15000);

  test('rehydrates lastNotifiedVersion from cache on restart', async () => {
    const cacheFile = join(home, 'Library', 'Caches', 'ai-gauge', 'update-check.json');
    writeFileSync(
      cacheFile,
      JSON.stringify({ lastCheckedAt: 100, latestVersion: '99.0.0', currentVersion: PACKAGE_VERSION }),
    );

    registry = startMockRegistry({ port: registryPort, latestVersion: '99.0.0' });
    server = startServer({
      home,
      registryPort,
      env: { CI: 'true', AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS: '10000000' },
    });

    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    await new Promise((r) => setTimeout(r, 500));

    const messages = await listenBroadcasts({ limitMs: 1500, filter: 'updateAvailable' });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].latestVersion).toBe('99.0.0');
  }, 15000);
});
