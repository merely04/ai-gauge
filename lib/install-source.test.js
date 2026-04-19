import { describe, expect, test } from 'bun:test';
import { buildUpdateCommand, detectInstallSource } from './install-source.js';

describe('detectInstallSource', () => {
  test('detects npm from standard Linux path', () => {
    expect(detectInstallSource('/usr/lib/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('npm');
  });

  test('detects bun from ~/.bun/ path', () => {
    expect(detectInstallSource('/Users/alice/.bun/install/global/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('bun');
  });

  test('detects pnpm from ~/.local/share/pnpm/ path', () => {
    expect(detectInstallSource('/Users/alice/.local/share/pnpm/global/5/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('pnpm');
  });

  test('detects brew from /opt/homebrew/ (Apple Silicon)', () => {
    expect(detectInstallSource('/opt/homebrew/lib/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('brew');
  });

  test('detects yarn from /.yarn/ path', () => {
    expect(detectInstallSource('/Users/alice/.yarn/global/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('yarn');
  });

  test('unknown path defaults to npm', () => {
    expect(detectInstallSource('/random/custom/path/bin/ai-gauge-server')).toBe('npm');
  });

  test('honors AIGAUGE_INSTALL_SOURCE env override', () => {
    const previous = Bun.env.AIGAUGE_INSTALL_SOURCE;
    Bun.env.AIGAUGE_INSTALL_SOURCE = 'bun';

    try {
      expect(detectInstallSource('/usr/lib/node_modules/ai-gauge/bin/ai-gauge-server')).toBe('bun');
    } finally {
      if (previous === undefined) {
        delete Bun.env.AIGAUGE_INSTALL_SOURCE;
      } else {
        Bun.env.AIGAUGE_INSTALL_SOURCE = previous;
      }
    }
  });
});

describe('buildUpdateCommand', () => {
  test('bun returns bun add -g', () => {
    expect(buildUpdateCommand('bun', 'ai-gauge')).toEqual({
      cmd: ['bun', 'add', '-g', 'ai-gauge'],
      displayString: 'bun add -g ai-gauge',
    });
  });

  test('npm returns npm install -g', () => {
    expect(buildUpdateCommand('npm', 'ai-gauge')).toEqual({
      cmd: ['npm', 'install', '-g', 'ai-gauge'],
      displayString: 'npm install -g ai-gauge',
    });
  });

  test('pnpm returns pnpm add -g', () => {
    expect(buildUpdateCommand('pnpm', 'ai-gauge')).toEqual({
      cmd: ['pnpm', 'add', '-g', 'ai-gauge'],
      displayString: 'pnpm add -g ai-gauge',
    });
  });

  test('brew returns brew upgrade', () => {
    expect(buildUpdateCommand('brew', 'ai-gauge')).toEqual({
      cmd: ['brew', 'upgrade', 'ai-gauge'],
      displayString: 'brew upgrade ai-gauge',
    });
  });

  test('yarn returns yarn global add', () => {
    expect(buildUpdateCommand('yarn', 'ai-gauge')).toEqual({
      cmd: ['yarn', 'global', 'add', 'ai-gauge'],
      displayString: 'yarn global add ai-gauge',
    });
  });

  test('unknown falls back to npm command', () => {
    const previous = Bun.env.AIGAUGE_NPM_COMMAND;
    Bun.env.AIGAUGE_NPM_COMMAND = 'fake-npm';

    try {
      expect(buildUpdateCommand('unknown', 'ai-gauge')).toEqual({
        cmd: ['fake-npm', 'install', '-g', 'ai-gauge'],
        displayString: 'npm install -g ai-gauge',
      });
    } finally {
      if (previous === undefined) {
        delete Bun.env.AIGAUGE_NPM_COMMAND;
      } else {
        Bun.env.AIGAUGE_NPM_COMMAND = previous;
      }
    }
  });
});
