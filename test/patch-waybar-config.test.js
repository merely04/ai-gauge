import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(import.meta.dir, '..', 'lib', 'patch-waybar-config.py');

const FRESH_CONFIG = `{
  "layer": "top",
  "modules-center": ["clock", "custom/notification-silencing-indicator"],
  "clock": { "format": "{:%H:%M}" }
}
`;

const PATCHED_CONFIG_BARE = `{
  "layer": "top",
  "modules-center": ["clock", "custom/notification-silencing-indicator", "custom/ai-gauge"],
  "clock": { "format": "{:%H:%M}" },
  "custom/ai-gauge": {
    "exec": "ai-gauge-waybar",
    "return-type": "json",
    "format": "{}",
    "tooltip": true,
    "on-click": "ai-gauge-menu",
    "on-click-right": "ai-gauge-menu"
  }
}
`;

const PATCHED_CONFIG_STALE_ABSOLUTE = `{
  "layer": "top",
  "modules-center": ["clock", "custom/notification-silencing-indicator", "custom/ai-gauge"],
  "clock": { "format": "{:%H:%M}" },
  "custom/ai-gauge": {
    "exec": "/old/path/.bun/bin/ai-gauge-waybar",
    "return-type": "json",
    "format": "{}",
    "tooltip": true,
    "on-click": "/old/path/.bun/bin/ai-gauge-menu",
    "on-click-right": "/old/path/.bun/bin/ai-gauge-menu"
  }
}
`;

const NEW_WAYBAR_BIN = '/home/test/.bun/bin/ai-gauge-waybar';
const NEW_MENU_BIN = '/home/test/.bun/bin/ai-gauge-menu';

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ai-gauge-patch-'));
});

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function runPatcher(configPath, env = {}) {
  const proc = Bun.spawn(['python3', SCRIPT_PATH, configPath], {
    env: {
      ...process.env,
      AI_GAUGE_WAYBAR_BIN: NEW_WAYBAR_BIN,
      AI_GAUGE_MENU_BIN: NEW_MENU_BIN,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('patch-waybar-config.py', () => {
  it('inserts module with absolute exec path on fresh config', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    writeFileSync(configPath, FRESH_CONFIG);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('inserted');
    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain(`"exec": "${NEW_WAYBAR_BIN}"`);
    expect(result).toContain(`"on-click": "${NEW_MENU_BIN}"`);
    expect(result).toContain(`"on-click-right": "${NEW_MENU_BIN}"`);
    expect(result).toContain('"custom/notification-silencing-indicator", "custom/ai-gauge"');
  });

  it('migrates legacy bare-name config to absolute paths', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    writeFileSync(configPath, PATCHED_CONFIG_BARE);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('migrated');
    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain(`"exec": "${NEW_WAYBAR_BIN}"`);
    expect(result).toContain(`"on-click": "${NEW_MENU_BIN}"`);
    expect(result).toContain(`"on-click-right": "${NEW_MENU_BIN}"`);
    expect(result).not.toContain('"exec": "ai-gauge-waybar"');
    expect(result).not.toContain('"on-click": "ai-gauge-menu"');
  });

  it('migrates stale absolute paths (e.g., after bun cache move) to current paths', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    writeFileSync(configPath, PATCHED_CONFIG_STALE_ABSOLUTE);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('migrated');
    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain(`"exec": "${NEW_WAYBAR_BIN}"`);
    expect(result).toContain(`"on-click": "${NEW_MENU_BIN}"`);
    expect(result).not.toContain('/old/path/.bun/bin/ai-gauge-waybar');
    expect(result).not.toContain('/old/path/.bun/bin/ai-gauge-menu');
  });

  it('reports noop when paths already match', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    const alreadyCorrect = PATCHED_CONFIG_STALE_ABSOLUTE
      .replaceAll('/old/path/.bun/bin/ai-gauge-waybar', NEW_WAYBAR_BIN)
      .replaceAll('/old/path/.bun/bin/ai-gauge-menu', NEW_MENU_BIN);
    writeFileSync(configPath, alreadyCorrect);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('noop');
    expect(readFileSync(configPath, 'utf8')).toBe(alreadyCorrect);
  });

  it('does NOT touch unrelated module configs', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    const withOtherModules = `{
  "layer": "top",
  "modules-center": ["clock", "custom/notification-silencing-indicator"],
  "custom/foo-waybar": { "exec": "/usr/bin/foo-waybar" },
  "custom/menu-launcher": { "on-click": "/usr/bin/some-menu" }
}
`;
    writeFileSync(configPath, withOtherModules);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('inserted');
    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain('"exec": "/usr/bin/foo-waybar"');
    expect(result).toContain('"on-click": "/usr/bin/some-menu"');
  });

  it('exits 2 when env vars are missing', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    writeFileSync(configPath, FRESH_CONFIG);

    const { stderr, exitCode } = await runPatcher(configPath, {
      AI_GAUGE_WAYBAR_BIN: '',
      AI_GAUGE_MENU_BIN: '',
    });

    expect(exitCode).toBe(2);
    expect(stderr).toContain('AI_GAUGE_WAYBAR_BIN');
    expect(readFileSync(configPath, 'utf8')).toBe(FRESH_CONFIG);
  });

  it('preserves comments and whitespace outside the patched values', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    const withComments = `// Top-level comment
{
  // Layer comment
  "layer": "top",
  "modules-center": ["clock", "custom/notification-silencing-indicator"],
  /* Multi-line
     comment */
  "clock": { "format": "{:%H:%M}" }
}
`;
    writeFileSync(configPath, withComments);

    await runPatcher(configPath);

    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain('// Top-level comment');
    expect(result).toContain('// Layer comment');
    expect(result).toContain('/* Multi-line');
    expect(result).toContain(`"exec": "${NEW_WAYBAR_BIN}"`);
  });

  it('handles config where ai-gauge module exists but values are inconsistent', async () => {
    const configPath = join(tempDir, 'config.jsonc');
    const mixed = `{
  "modules-center": ["clock", "custom/notification-silencing-indicator", "custom/ai-gauge"],
  "custom/ai-gauge": {
    "exec": "ai-gauge-waybar",
    "on-click": "/old/absolute/ai-gauge-menu",
    "on-click-right": "ai-gauge-menu"
  }
}
`;
    writeFileSync(configPath, mixed);

    const { stdout, exitCode } = await runPatcher(configPath);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('migrated');
    const result = readFileSync(configPath, 'utf8');
    expect(result).toContain(`"exec": "${NEW_WAYBAR_BIN}"`);
    expect(result).toContain(`"on-click": "${NEW_MENU_BIN}"`);
    expect(result).toContain(`"on-click-right": "${NEW_MENU_BIN}"`);
    expect(result).not.toMatch(/"exec":\s*"ai-gauge-waybar"/);
    expect(result).not.toContain('/old/absolute/ai-gauge-menu');
  });
});
