import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SERVER_BIN = join(REPO_ROOT, 'bin', 'ai-gauge-server');

function freePort() {
  return 20000 + Math.floor(Math.random() * 2000);
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function startServer({ home, wsPort }) {
  const child = spawn('bun', [SERVER_BIN], {
    env: {
      HOME: home,
      PATH: process.env.PATH,
      XDG_RUNTIME_DIR: join(home, '.state'),
      TMPDIR: join(home, '.state'),
      AIGAUGE_WS_PORT: String(wsPort),
      NO_UPDATE_NOTIFIER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: REPO_ROOT,
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

  return { child, get stderr() { return stderr; } };
}

async function stopServer(srv) {
  if (!srv?.child) return;
  try { srv.child.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  try { srv.child.kill('SIGKILL'); } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

describe('cache invalidation flow', () => {
  let home;
  let wsPort;
  let server;

  beforeEach(() => {
    wsPort = freePort();
    home = `/tmp/ai-gauge-cache-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mkdirSync(join(home, '.state', 'ai-gauge'), { recursive: true });
    mkdirSync(join(home, '.config', 'ai-gauge'), { recursive: true });
    mkdirSync(join(home, '.claude'), { recursive: true });

    writeFileSync(join(home, '.config', 'ai-gauge', 'config.json'), JSON.stringify({
      tokenSource: 'claude-code',
      plan: 'max',
      autoCheckUpdates: false,
      displayMode: 'full',
    }));

    writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'expired-test-token',
        expiresAt: Date.now() - 60_000,
        subscriptionType: 'max',
      },
    }));

    writeFileSync(join(home, '.state', 'ai-gauge', 'usage.json'), JSON.stringify({
      five_hour: { utilization: 15, resets_at: '2025-04-24T22:40:00.000Z' },
      seven_day: { utilization: 45, resets_at: '2025-04-30T22:40:00.000Z' },
      meta: {
        tokenSource: 'claude-code',
        provider: 'anthropic',
        plan: 'max',
      },
    }));
  });

  afterEach(async () => {
    await stopServer(server);
    try { rmSync(home, { recursive: true, force: true }); } catch {}
  });

  test('does not rebroadcast stale cached usage after tokenSource change and failed refresh', async () => {
    server = startServer({ home, wsPort });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const usageMessages = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data?.type) {
        usageMessages.push(data);
      }
    };

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    const gotInitialCache = await waitFor(() => usageMessages.length >= 1);
    expect(gotInitialCache).toBe(true);
    expect(usageMessages[0].five_hour.utilization).toBe(15);

    usageMessages.length = 0;
    ws.send(JSON.stringify({ type: 'setConfig', key: 'tokenSource', value: 'opencode' }));
    ws.send(JSON.stringify({ type: 'refresh' }));

    await new Promise((resolve) => setTimeout(resolve, 400));

    const staleBroadcasts = usageMessages.filter(
      (m) => m?.five_hour?.utilization === 15
    );
    expect(staleBroadcasts.length).toBe(0);

    for (const msg of usageMessages) {
      if (msg.five_hour !== null && msg.five_hour !== undefined) {
        throw new Error(
          `expected only empty-state or no broadcasts, got: ${JSON.stringify(msg)}`
        );
      }
    }

    try { ws.close(); } catch {}
  }, 15000);
});
