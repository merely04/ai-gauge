import { describe, expect, test } from 'bun:test';
import { copyToClipboard, resolveClipboardCommand } from './clipboard.js';

function createSpawnMock({ failFor = [], exitCode = 0 } = {}) {
  const calls = [];

  const spawn = (cmd) => {
    calls.push(cmd);
    if (failFor.some((item) => item.length === cmd.length && item.every((part, i) => part === cmd[i]))) {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }

    return {
      stdin: {
        write() {},
        end() {},
      },
      exited: Promise.resolve(exitCode),
    };
  };

  return { calls, spawn };
}

describe('resolveClipboardCommand', () => {
  test('resolves darwin to pbcopy', () => {
    expect(resolveClipboardCommand('darwin')).toEqual(['pbcopy']);
  });

  test('resolves linux to wl-copy', () => {
    expect(resolveClipboardCommand('linux')).toEqual(['wl-copy']);
  });

  test('rejects unsupported platforms', () => {
    expect(resolveClipboardCommand('win32')).toBeNull();
  });
});

describe('copyToClipboard', () => {
  test('copies successfully with the platform command', async () => {
    const { calls, spawn } = createSpawnMock();

    const result = await copyToClipboard('hello clipboard test', { spawn });

    if (process.platform === 'darwin') {
      expect(result).toEqual({ success: true });
      expect(calls).toEqual([['pbcopy']]);
      return;
    }

    if (process.platform === 'linux') {
      expect(result).toEqual({ success: true });
      expect(calls).toEqual([['wl-copy']]);
      return;
    }

    expect(result).toEqual({ success: false, error: 'unsupported-platform' });
    expect(calls).toEqual([]);
  });

  test('returns not-installed when the platform tool is missing', async () => {
    const { spawn } = createSpawnMock({
      failFor: process.platform === 'linux' ? [['wl-copy'], ['xclip', '-selection', 'clipboard']] : [['pbcopy']],
    });

    const result = await copyToClipboard('x', { spawn });

    if (process.platform === 'linux') {
      expect(result).toEqual({ success: false, error: 'no-clipboard-tool' });
    } else if (process.platform === 'darwin') {
      expect(result).toEqual({ success: false, error: 'not-installed' });
    } else {
      expect(result).toEqual({ success: false, error: 'unsupported-platform' });
    }
  });
});
