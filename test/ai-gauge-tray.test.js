import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRAY_BIN = join(REPO_ROOT, 'bin', 'ai-gauge-tray');
const FAKE_HELPER = join(REPO_ROOT, 'test', 'fixtures', 'sni-tray', 'fake-helper.sh');

const children = [];
const servers = [];
const tempDirs = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 1500, step = 25, label = 'condition' } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(step);
  }
  throw lastError || new Error(`${label} timed out after ${timeout}ms`);
}

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'ai-gauge-tray-'));
  tempDirs.push(dir);
  return dir;
}

async function readJsonLines(file) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function startMockServer() {
  const requests = [];
  const sockets = new Set();
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('upgrade required', { status: 426 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      message(_ws, message) {
        requests.push(JSON.parse(typeof message === 'string' ? message : String(message)));
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
  });
  servers.push(server);
  return {
    url: `ws://127.0.0.1:${server.port}`,
    requests,
    send(payload) {
      const text = JSON.stringify(payload);
      for (const ws of sockets) ws.send(text);
    },
    closeClients() {
      for (const ws of sockets) ws.close();
    },
    connectedCount() {
      return sockets.size;
    },
  };
}

async function startTray(extraEnv = {}) {
  const dir = await makeTempDir();
  const home = join(dir, 'home');
  await mkdir(home, { recursive: true });
  const helperLog = join(dir, 'helper.log');
  const injectFile = join(dir, 'inject.jsonl');
  const stdoutFile = join(dir, 'tray.stdout');
  const stderrFile = join(dir, 'tray.stderr');

  const proc = Bun.spawn(['bun', TRAY_BIN], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      PATH: process.env.PATH,
      AIGAUGE_WS_URL: extraEnv.AIGAUGE_WS_URL,
      AIGAUGE_TRAY_HELPER_CMD: extraEnv.AIGAUGE_TRAY_HELPER_CMD || `${FAKE_HELPER}`,
      AIGAUGE_TRAY_RECONNECT_DELAY_MS: extraEnv.AIGAUGE_TRAY_RECONNECT_DELAY_MS || '200',
      AIGAUGE_TRAY_HELPER_RESTART_INITIAL_DELAY_MS: extraEnv.AIGAUGE_TRAY_HELPER_RESTART_INITIAL_DELAY_MS || '100',
      FAKE_HELPER_LOG_FILE: helperLog,
      FAKE_HELPER_INJECT_FILE: injectFile,
      FAKE_HELPER_EXIT_AFTER_INIT: extraEnv.FAKE_HELPER_EXIT_AFTER_INIT || '0',
    },
    stdin: 'ignore',
    stdout: Bun.file(stdoutFile),
    stderr: Bun.file(stderrFile),
  });
  children.push(proc);

  return {
    proc,
    helperLog,
    injectFile,
    stdoutFile,
    stderrFile,
    async commands() {
      return readJsonLines(helperLog);
    },
    async stdout() {
      return readText(stdoutFile);
    },
    async stderr() {
      return readText(stderrFile);
    },
    async inject(event) {
      await writeFile(injectFile, `${JSON.stringify(event)}\n`, 'utf8');
    },
  };
}

async function waitForConnect(server) {
  await waitFor(() => server.connectedCount() > 0, { timeout: 2000, label: 'websocket connect' });
  await waitFor(() => server.requests.find((req) => req.type === 'listSettingsFiles'), { timeout: 2000, label: 'listSettingsFiles request' });
}

function usage(utilization, extra = {}) {
  return {
    five_hour: { utilization, resets_at: '2030-01-01T01:00:00.000Z' },
    seven_day: { utilization: 15, resets_at: '2030-01-03T01:00:00.000Z' },
    seven_day_sonnet: { utilization: 4, resets_at: '2030-01-03T01:00:00.000Z' },
    extra_usage: null,
    balance: null,
    meta: { plan: 'max', tokenSource: 'claude-code', displayMode: 'full', autoCheckUpdates: true, provider: 'anthropic' },
    ...extra,
  };
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    try { child.kill('SIGTERM'); } catch {}
    try { await Promise.race([child.exited, delay(500)]); } catch {}
    try { child.kill('SIGKILL'); } catch {}
    try { await child.exited; } catch {}
  }
  for (const server of servers.splice(0)) {
    try { server.stop(true); } catch {}
  }
  for (const dir of tempDirs.splice(0)) {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('ai-gauge-tray', () => {
  it('spawns helper at startup and sends init + waiting icon', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    const cmds = await waitFor(async () => (await tray.commands()).length >= 2 && tray.commands(), { label: 'startup commands' });
    expect((await cmds).slice(0, 2)).toEqual([
      { cmd: 'init', title: 'AI Gauge', category: 'ApplicationStatus', id: 'ai-gauge' },
      { cmd: 'set-icon', name: 'ai-gauge-waiting' },
    ]);
  });

  it('maps normal broadcast to active icon, status, tooltip, and menu', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(30));
    const cmds = await waitFor(async () => {
      const list = await tray.commands();
      return list.find((cmd) => cmd.cmd === 'set-icon' && cmd.name === 'ai-gauge-normal') ? list : null;
    }, { label: 'normal flush' });
    expect(cmds).toEqual(expect.arrayContaining([
      { cmd: 'set-icon', name: 'ai-gauge-normal' },
      { cmd: 'set-status', value: 'Active' },
      expect.objectContaining({ cmd: 'set-tooltip', title: 'AI Gauge', body: expect.stringContaining('5-hour:') }),
      expect.objectContaining({ cmd: 'set-menu', items: expect.any(Array) }),
    ]));
  });

  it('maps critical broadcast to critical icon and NeedsAttention status', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(85));
    const cmds = await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-status' && cmd.value === 'NeedsAttention') && list), { label: 'critical flush' });
    expect(cmds).toEqual(expect.arrayContaining([{ cmd: 'set-icon', name: 'ai-gauge-critical' }]));
  });

  it('shows update-available icon for normal usage with update available', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(30));
    await waitFor(() => tray.commands().then((list) => list.find((entry) => entry.cmd === 'set-icon' && entry.name === 'ai-gauge-normal')), { label: 'normal icon first' });
    server.send({ type: 'updateAvailable', latestVersion: '9.9.9', changelogUrl: 'https://example.com/changelog' });
    const cmds = await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-icon' && cmd.name === 'ai-gauge-update-available')), { label: 'update icon' });
    expect(cmds).toEqual({ cmd: 'set-icon', name: 'ai-gauge-update-available' });
  });

  it('keeps critical icon when update is available but urgency is higher', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(85));
    await waitFor(() => tray.commands().then((list) => list.find((entry) => entry.cmd === 'set-icon' && entry.name === 'ai-gauge-critical')), { label: 'critical icon first' });
    server.send({ type: 'updateAvailable', latestVersion: '9.9.9', changelogUrl: 'https://example.com/changelog' });
    const cmds = await waitFor(() => tray.commands().then((list) => list.filter((cmd) => cmd.cmd === 'set-icon')), { label: 'icon history' });
    expect(cmds.at(-1)).toEqual({ cmd: 'set-icon', name: 'ai-gauge-critical' });
  });

  it('shows updating icon for updateInstalling typed message', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(30));
    await waitFor(() => tray.commands().then((list) => list.find((entry) => entry.cmd === 'set-icon' && entry.name === 'ai-gauge-normal')), { label: 'normal icon first' });
    server.send({ type: 'updateInstalling', latestVersion: '9.9.9' });
    const cmd = await waitFor(() => tray.commands().then((list) => list.find((entry) => entry.cmd === 'set-icon' && entry.name === 'ai-gauge-updating')), { label: 'updating icon' });
    expect(cmd).toEqual({ cmd: 'set-icon', name: 'ai-gauge-updating' });
  });

  it('returns to waiting/passive on websocket close and reconnects', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url, AIGAUGE_TRAY_RECONNECT_DELAY_MS: '200' });
    await waitForConnect(server);
    server.send(usage(30));
    await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-icon' && cmd.name === 'ai-gauge-normal')), { label: 'connected state' });
    server.closeClients();
    const cmds = await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-status' && cmd.value === 'Passive') && list), { timeout: 2000, label: 'passive state' });
    expect(await cmds).toEqual(expect.arrayContaining([{ cmd: 'set-icon', name: 'ai-gauge-waiting' }, { cmd: 'set-status', value: 'Passive' }]));
    await waitFor(() => server.connectedCount() > 0, { timeout: 2000, label: 'reconnect' });
  });

  it('sends refresh command over websocket on Refresh click', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(30));
    await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-menu')), { label: 'menu ready' });
    await tray.inject({ event: 'menu-click', id: 'refresh-now' });
    await waitFor(() => server.requests.find((req) => req.type === 'refresh'), { label: 'refresh request' });
  });

  it('sends setConfig tokenSource over websocket on token source click', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(30));
    await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-menu')), { label: 'menu ready' });
    await tray.inject({ event: 'menu-click', id: 'set-token-source:opencode' });
    await waitFor(() => server.requests.find((req) => req.type === 'setConfig' && req.key === 'tokenSource'), { label: 'tokenSource setConfig' });
    expect(server.requests.at(-1)).toEqual({ type: 'setConfig', key: 'tokenSource', value: 'opencode' });
  });

  it('restarts helper after crash with backoff', async () => {
    const server = await startMockServer();
    const tray = await startTray({
      AIGAUGE_WS_URL: server.url,
      AIGAUGE_TRAY_HELPER_RESTART_INITIAL_DELAY_MS: '100',
      FAKE_HELPER_EXIT_AFTER_INIT: '1',
    });
    await waitForConnect(server);
    await waitFor(async () => (await tray.commands()).filter((cmd) => cmd.cmd === 'init').length >= 2, { timeout: 3000, label: 'helper restart' });
  });

  it('exits 0 after five watcher-unavailable events', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    for (let i = 0; i < 5; i += 1) {
      await tray.inject({ event: 'watcher-unavailable', reason: 'missing watcher' });
      await delay(120);
    }
    const result = await waitFor(() => tray.proc.exited.then((code) => ({ code })), { timeout: 1500, label: 'clean exit' });
    expect(result.code).toBe(0);
  });

  it('exits 3 on dbus-import-failed helper error', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    await tray.inject({ event: 'helper-error', reason: 'dbus-import-failed', message: 'missing dbus' });
    const result = await waitFor(() => tray.proc.exited.then((code) => ({ code })), { timeout: 1500, label: 'fatal exit' });
    expect(result.code).toBe(3);
  });

  it('does not resend unchanged helper commands for identical broadcasts', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    const payload = usage(30);
    server.send(payload);
    await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-icon' && cmd.name === 'ai-gauge-normal')), { label: 'first flush' });
    const before = await tray.commands();
    server.send(payload);
    await delay(300);
    const after = await tray.commands();
    expect(after.length).toBe(before.length);
  });

  it('renders tri-mode tooltip and menu sections', async () => {
    const server = await startMockServer();
    const tray = await startTray({ AIGAUGE_WS_URL: server.url });
    await waitForConnect(server);
    server.send(usage(31, {
      secondary: {
        provider: 'codex',
        five_hour: { utilization: 24, resets_at: '2030-01-01T02:00:00.000Z' },
        seven_day: { utilization: 15, resets_at: '2030-01-03T02:00:00.000Z' },
        balance: null,
      },
      copilot: {
        plan: 'pro',
        premium_interactions: { utilization: 50, used: 150, limit: 300, resets_at: '2030-01-03T03:00:00.000Z' },
      },
    }));
    const menu = await waitFor(() => tray.commands().then((list) => list.find((cmd) => cmd.cmd === 'set-menu' && cmd.items.some((item) => item.id === 'info:secondary'))), { label: 'tri-mode menu' });
    const tooltip = await waitFor(() => tray.commands().then((list) => [...list].reverse().find((cmd) => cmd.cmd === 'set-tooltip' && cmd.body.includes('Codex'))), { label: 'tri-mode tooltip' });
    expect(tooltip.body).toContain('Codex');
    expect(tooltip.body).toContain('GitHub Copilot');
    expect(menu.items.some((item) => item.id === 'info:secondary')).toBe(true);
    expect(menu.items.some((item) => item.id === 'info:copilot')).toBe(true);
  });
});

describe('ai-gauge-tray regression — spawns real Python helper without override', () => {
  afterEach(async () => {
    while (children.length) {
      const child = children.pop();
      try { child.kill(); } catch { /* swallow */ }
    }
    while (servers.length) {
      const server = servers.pop();
      try { server.stop(true); } catch { /* swallow */ }
    }
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      try { await rm(dir, { recursive: true, force: true }); } catch { /* swallow */ }
    }
  });

  it('spawns python3 sni-helper.py (not direct .py — would EACCES on POSIX)', async () => {
    const proc = Bun.spawn(['bun', TRAY_BIN], {
      env: {
        ...process.env,
        AIGAUGE_WS_URL: 'ws://127.0.0.1:1',
        AIGAUGE_TRAY_HELPER_RESTART_INITIAL_DELAY_MS: '50',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(proc);

    const stderrReader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let stderrBuf = '';
    const readPromise = (async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        stderrBuf += decoder.decode(value, { stream: true });
        if (stderrBuf.includes('EACCES')) return 'eacces';
        if (stderrBuf.includes('tray-helper-fatal') || stderrBuf.includes('tray-helper-error') || stderrBuf.includes('tray-helper-exited')) return 'ok';
      }
      return 'eof';
    })();

    const result = await Promise.race([
      readPromise,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);

    if (result === 'eacces') {
      throw new Error('REGRESSION: tray spawned .py directly without python3 prefix (EACCES)');
    }
    expect(result).toBe('ok');
  });
});
