import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const HELPER_PATH = join(import.meta.dir, '..', 'lib', 'sni-tray', 'sni-helper.py');
const VALID_ICONS = [
  'ai-gauge-normal',
  'ai-gauge-waiting',
  'ai-gauge-warning',
  'ai-gauge-critical',
  'ai-gauge-update-available',
  'ai-gauge-updating',
];
const VALID_STATUSES = ['Active', 'Passive', 'NeedsAttention'];

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
}

function startHelper() {
  const proc = Bun.spawn(['python3', HELPER_PATH], {
    env: {
      ...process.env,
      AIGAUGE_SNI_TEST_MODE: '1',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  const queue = [];
  const waiters = [];
  let stdoutDone = false;

  const stdoutPump = (async () => {
    const reader = proc.stdout.getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch (error) {
            throw new Error(`helper emitted non-JSON stdout line: ${line}\n${error}`);
          }
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(parsed);
          else queue.push(parsed);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      let parsed;
      try {
        parsed = JSON.parse(tail);
      } catch (error) {
        throw new Error(`helper emitted non-JSON stdout tail: ${tail}\n${error}`);
      }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(parsed);
      else queue.push(parsed);
    }

    stdoutDone = true;
    while (waiters.length) {
      waiters.shift().reject(new Error('helper stdout closed'));
    }
  })();

  const stderrTextPromise = new Response(proc.stderr).text();

  function sendRaw(line) {
    proc.stdin.write(`${line}\n`);
  }

  function send(cmd) {
    sendRaw(JSON.stringify(cmd));
  }

  function nextEvent(ms = 1000) {
    if (queue.length) return Promise.resolve(queue.shift());
    if (stdoutDone) return Promise.reject(new Error('helper stdout already closed'));
    return Promise.race([
      new Promise((resolve, reject) => waiters.push({ resolve, reject })),
      timeoutAfter(ms, 'waiting for helper event'),
    ]);
  }

  async function expectEvent(expected, ms = 1000) {
    const event = await nextEvent(ms);
    expect(event).toEqual(expected);
    return event;
  }

  async function waitForExit(ms = 1000) {
    return Promise.race([proc.exited, timeoutAfter(ms, 'waiting for helper exit')]);
  }

  return {
    proc,
    send,
    sendRaw,
    nextEvent,
    expectEvent,
    waitForExit,
    stdoutPump,
    stderrTextPromise,
  };
}

async function initHelper(helper) {
  const init = {
    cmd: 'init',
    title: 'AI Gauge',
    category: 'ApplicationStatus',
    id: 'ai-gauge',
  };
  helper.send(init);
  await helper.expectEvent({ event: 'test-echo', cmd: init });
}

let helper;

beforeEach(() => {
  helper = startHelper();
});

afterEach(async () => {
  if (!helper) return;
  try {
    const exited = await Promise.race([
      helper.proc.exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    if (!exited) {
      helper.send({ cmd: 'shutdown' });
      await helper.waitForExit(1000);
    }
  } catch {
    helper.proc.kill('SIGKILL');
    await helper.proc.exited;
  }

  await helper.stdoutPump;
  const stderr = (await helper.stderrTextPromise).trim();
  expect(stderr).not.toContain('Traceback');
  helper = null;
});

describe('sni-helper.py test mode', () => {
  it('echoes init', async () => {
    await initHelper(helper);
  });

  it('echoes each valid set-icon command', async () => {
    await initHelper(helper);

    for (const name of VALID_ICONS) {
      const command = { cmd: 'set-icon', name };
      helper.send(command);
      await helper.expectEvent({ event: 'test-echo', cmd: command });
    }
  });

  it('emits helper-error for invalid icon and stays alive', async () => {
    await initHelper(helper);

    helper.send({ cmd: 'set-icon', name: 'banana' });
    await helper.expectEvent({
      event: 'helper-error',
      reason: 'unknown-icon',
      message: 'unknown icon: banana',
    });

    const followUp = { cmd: 'set-tooltip', title: 'AI Gauge', body: 'still alive' };
    helper.send(followUp);
    await helper.expectEvent({ event: 'test-echo', cmd: followUp });
  });

  it('echoes set-tooltip', async () => {
    await initHelper(helper);

    const command = {
      cmd: 'set-tooltip',
      title: 'AI Gauge',
      body: '5-hour: 44%\nWeekly: 15%',
    };
    helper.send(command);
    await helper.expectEvent({ event: 'test-echo', cmd: command });
  });

  it('echoes set-menu with nested structure intact', async () => {
    await initHelper(helper);

    const command = {
      cmd: 'set-menu',
      items: [
        { id: 'info:five-hour', label: '5-hour: 44%', enabled: false },
        { type: 'separator', label: '' },
        {
          id: 'set-token-source',
          label: 'Token source',
          type: 'menu',
          children: [
            {
              id: 'set-token-source:claude-code',
              label: 'Claude Code',
              toggleType: 'radio',
              toggleState: 1,
            },
            {
              id: 'set-token-source:opencode',
              label: 'OpenCode',
              toggleType: 'radio',
              toggleState: 0,
              icon: 'network-workgroup-symbolic',
            },
          ],
        },
        { id: 'refresh-now', label: 'Refresh now', enabled: true },
      ],
    };

    const event = await (helper.send(command), helper.nextEvent());
    expect(event).toEqual({ event: 'test-echo', cmd: command });
    expect(event.cmd.items[2].children[0].toggleType).toBe('radio');
    expect(event.cmd.items[2].children[1].icon).toBe('network-workgroup-symbolic');
  });

  it('echoes each valid set-status command', async () => {
    await initHelper(helper);

    for (const value of VALID_STATUSES) {
      const command = { cmd: 'set-status', value };
      helper.send(command);
      await helper.expectEvent({ event: 'test-echo', cmd: command });
    }
  });

  it('emits helper-error for invalid status', async () => {
    await initHelper(helper);

    helper.send({ cmd: 'set-status', value: 'Banana' });
    await helper.expectEvent({
      event: 'helper-error',
      reason: 'invalid-status',
      message: 'invalid status: Banana',
    });
  });

  it('exits 0 on shutdown command', async () => {
    await initHelper(helper);

    helper.send({ cmd: 'shutdown' });
    expect(await helper.waitForExit(1000)).toBe(0);
  });

  it('reports malformed JSON and stays alive', async () => {
    await initHelper(helper);

    helper.sendRaw('{ broken');
    const event = await helper.nextEvent();
    expect(event.event).toBe('helper-error');
    expect(event.reason).toBe('parse-error');
    expect(event.message).toContain('invalid JSON');

    const followUp = { cmd: 'set-icon', name: 'ai-gauge-normal' };
    helper.send(followUp);
    await helper.expectEvent({ event: 'test-echo', cmd: followUp });
  });

  it('reports unknown command and stays alive', async () => {
    await initHelper(helper);

    helper.send({ cmd: 'banana' });
    await helper.expectEvent({
      event: 'helper-error',
      reason: 'unknown-command',
      message: 'unknown command: banana',
    });

    const followUp = { cmd: 'set-status', value: 'Active' };
    helper.send(followUp);
    await helper.expectEvent({ event: 'test-echo', cmd: followUp });
  });

  it('exits 0 on SIGTERM while idle', async () => {
    await initHelper(helper);

    helper.proc.kill('SIGTERM');
    expect(await helper.waitForExit(1000)).toBe(0);
  });

  it('handles a rapid icon burst in order without drops', async () => {
    await initHelper(helper);

    const burst = Array.from({ length: 10 }, (_, index) => ({
      cmd: 'set-icon',
      name: VALID_ICONS[index % VALID_ICONS.length],
    }));

    for (const command of burst) helper.send(command);

    const events = [];
    for (let index = 0; index < burst.length; index += 1) {
      events.push(await helper.nextEvent());
    }

    expect(events).toEqual(burst.map((command) => ({ event: 'test-echo', cmd: command })));
  });
});
