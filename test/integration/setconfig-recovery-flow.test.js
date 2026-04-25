import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SERVER_BIN = join(REPO_ROOT, 'bin', 'ai-gauge-server');

function freePort() {
  return 22000 + Math.floor(Math.random() * 2000);
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function startServer({ home, wsPort, withCache = false }) {
  if (withCache) {
    writeFileSync(join(home, '.state', 'ai-gauge', 'usage.json'), JSON.stringify({
      five_hour: { utilization: 22, resets_at: '2099-04-30T22:40:00.000Z' },
      seven_day: { utilization: 33, resets_at: '2099-04-30T22:40:00.000Z' },
      meta: {
        tokenSource: 'claude-code',
        provider: 'anthropic',
        plan: 'max',
      },
    }));
  }

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

function setupHome() {
  const home = `/tmp/ai-gauge-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  return home;
}

describe('setConfig recovery flow', () => {
  let home;
  let wsPort;
  let server;

  beforeEach(() => {
    wsPort = freePort();
    home = setupHome();
  });

  afterEach(async () => {
    await stopServer(server);
    try { rmSync(home, { recursive: true, force: true }); } catch {}
  });

  test('sends configError to requester when tokenSource value is malformed', async () => {
    server = startServer({ home, wsPort, withCache: true });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const messages = [];
    ws.onmessage = (event) => {
      try { messages.push(JSON.parse(event.data)); } catch {}
    };

    await new Promise((resolve) => { ws.onopen = resolve; });

    ws.send(JSON.stringify({ type: 'setConfig', key: 'tokenSource', value: 'not a valid token source' }));

    const gotError = await waitFor(
      () => messages.some((m) => m?.type === 'configError' && m?.key === 'tokenSource'),
      { timeoutMs: 2000 }
    );
    expect(gotError).toBe(true);

    const errorMsg = messages.find((m) => m?.type === 'configError');
    expect(errorMsg.key).toBe('tokenSource');
    expect(typeof errorMsg.reason).toBe('string');
    expect(errorMsg.reason.length).toBeGreaterThan(0);

    try { ws.close(); } catch {}
  }, 15000);

  test('sends configError to requester when plan value is invalid', async () => {
    server = startServer({ home, wsPort, withCache: true });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const messages = [];
    ws.onmessage = (event) => {
      try { messages.push(JSON.parse(event.data)); } catch {}
    };

    await new Promise((resolve) => { ws.onopen = resolve; });

    ws.send(JSON.stringify({ type: 'setConfig', key: 'plan', value: 'definitely-not-a-plan' }));

    const gotError = await waitFor(
      () => messages.some((m) => m?.type === 'configError' && m?.key === 'plan'),
      { timeoutMs: 2000 }
    );
    expect(gotError).toBe(true);

    try { ws.close(); } catch {}
  }, 15000);

  test('configError targets only the requester, not other connected clients', async () => {
    server = startServer({ home, wsPort, withCache: true });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    function openWs() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${wsPort}`);
        const timer = setTimeout(() => reject(new Error('open timeout')), 2000);
        ws.onopen = () => { clearTimeout(timer); resolve(ws); };
        ws.onerror = (e) => { clearTimeout(timer); reject(e); };
      });
    }

    const listener = await openWs();
    const requester = await openWs();

    const listenerMsgs = [];
    const requesterMsgs = [];

    listener.onmessage = (event) => {
      try { listenerMsgs.push(JSON.parse(event.data)); } catch {}
    };
    requester.onmessage = (event) => {
      try { requesterMsgs.push(JSON.parse(event.data)); } catch {}
    };

    requester.send(JSON.stringify({ type: 'setConfig', key: 'plan', value: 'invalid' }));

    await new Promise((r) => setTimeout(r, 400));

    const requesterGotError = requesterMsgs.some((m) => m?.type === 'configError');
    const listenerGotError = listenerMsgs.some((m) => m?.type === 'configError');
    expect(requesterGotError).toBe(true);
    expect(listenerGotError).toBe(false);

    try { listener.close(); } catch {}
    try { requester.close(); } catch {}
  }, 15000);

  test('open() sends an empty broadcast when no cached data exists yet', async () => {
    server = startServer({ home, wsPort, withCache: false });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const usageMessages = [];
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.type && data?.meta) {
          usageMessages.push(data);
        }
      } catch {}
    };

    await new Promise((resolve) => { ws.onopen = resolve; });

    const gotBroadcast = await waitFor(() => usageMessages.length >= 1, { timeoutMs: 2000 });
    expect(gotBroadcast).toBe(true);

    const first = usageMessages[0];
    expect(first.meta).toBeDefined();
    expect(first.meta.tokenSource).toBe('claude-code');
    expect(first.five_hour === null || first.five_hour === undefined).toBe(true);

    try { ws.close(); } catch {}
  }, 15000);

  test('after tokenSource setConfig, a reconnecting client also receives a non-stale broadcast', async () => {
    server = startServer({ home, wsPort, withCache: true });
    const ready = await waitFor(() => server.stderr.includes('listening on ws://'));
    expect(ready).toBe(true);

    const wsA = new WebSocket(`ws://localhost:${wsPort}`);
    await new Promise((resolve) => { wsA.onopen = resolve; });
    wsA.send(JSON.stringify({ type: 'setConfig', key: 'tokenSource', value: 'opencode' }));
    await new Promise((r) => setTimeout(r, 400));
    try { wsA.close(); } catch {}

    await new Promise((r) => setTimeout(r, 200));

    const wsB = new WebSocket(`ws://localhost:${wsPort}`);
    const messages = [];
    wsB.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.type && data?.meta) messages.push(data);
      } catch {}
    };

    await new Promise((resolve) => { wsB.onopen = resolve; });

    const gotBroadcast = await waitFor(() => messages.length >= 1, { timeoutMs: 2000 });
    expect(gotBroadcast).toBe(true);

    const first = messages[0];
    expect(first.meta.tokenSource).toBe('opencode');
    expect(first.five_hour?.utilization === undefined || first.five_hour === null).toBe(true);

    try { wsB.close(); } catch {}
  }, 15000);
});
