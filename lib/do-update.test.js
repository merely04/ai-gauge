import { describe, expect, test } from 'bun:test';
import { runUpdate } from './do-update.js';

function createMockSpawn({ exitCode = 0, stderrText = '', exited = Promise.resolve(exitCode) } = {}) {
  const calls = [];

  const spawn = (cmd, opts) => {
    calls.push({ cmd, env: opts?.env });
    return {
      exited,
      stderr: new ReadableStream({
        start(controller) {
          if (stderrText) controller.enqueue(new TextEncoder().encode(stderrText));
          controller.close();
        },
      }),
      kill() {},
    };
  };

  return { calls, spawn };
}

function createMockClipboard(success = true) {
  const calls = [];
  const fn = async (text) => {
    calls.push(text);
    return { success };
  };
  return { calls, fn };
}

describe('runUpdate', () => {
  test('returns completed without clipboard on successful spawn', async () => {
    const { calls, spawn } = createMockSpawn({ exitCode: 0 });
    const clipboard = createMockClipboard();

    const result = await runUpdate({
      installSource: 'npm',
      spawnFn: spawn,
      clipboardFn: clipboard.fn,
    });

    expect(result).toEqual({ success: true, reason: 'completed' });
    expect(calls).toHaveLength(1);
    expect(clipboard.calls).toEqual([]);
  });

  test('classifies EACCES failures and copies fallback command', async () => {
    const { spawn } = createMockSpawn({ exitCode: 1, stderrText: 'npm ERR! code EACCES' });
    const clipboard = createMockClipboard(true);

    const result = await runUpdate({
      installSource: 'npm',
      spawnFn: spawn,
      clipboardFn: clipboard.fn,
    });

    expect(result).toEqual({
      success: false,
      reason: 'permission',
      command: 'npm install -g ai-gauge',
      clipboardCopied: true,
      stderr: 'npm ERR! code EACCES',
    });
    expect(clipboard.calls).toEqual(['npm install -g ai-gauge']);
  });

  test('returns timeout and kills hung process', async () => {
    let killed = false;
    const spawn = () => ({
      exited: new Promise(() => {}),
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      kill() {
        killed = true;
      },
    });
    const clipboard = createMockClipboard();
    const startedAt = Date.now();

    const result = await runUpdate({
      installSource: 'npm',
      spawnFn: spawn,
      clipboardFn: clipboard.fn,
      timeoutMs: 100,
    });

    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(killed).toBe(true);
    expect(result).toEqual({
      success: false,
      reason: 'timeout',
      command: 'npm install -g ai-gauge',
      clipboardCopied: true,
    });
  });

  test('bypasses spawn for brew and uses clipboard fallback', async () => {
    const { calls, spawn } = createMockSpawn({ exitCode: 0 });
    const clipboard = createMockClipboard(true);

    const result = await runUpdate({
      installSource: 'brew',
      spawnFn: spawn,
      clipboardFn: clipboard.fn,
    });

    expect(calls).toEqual([]);
    expect(clipboard.calls).toEqual(['brew upgrade ai-gauge']);
    expect(result).toEqual({
      success: false,
      reason: 'manual-required',
      command: 'brew upgrade ai-gauge',
      clipboardCopied: true,
    });
  });

  test('passes AIGAUGE_UPDATING flag into child env', async () => {
    const { calls, spawn } = createMockSpawn({ exitCode: 0 });

    await runUpdate({
      installSource: 'npm',
      spawnFn: spawn,
      clipboardFn: async () => ({ success: true }),
      env: { TEST_ENV: '1' },
    });

    expect(calls[0].env).toEqual({ TEST_ENV: '1', AIGAUGE_UPDATING: '1' });
  });
});
