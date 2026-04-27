import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function runScript(scriptPath, env = {}) {
  const proc = Bun.spawn(['bash', scriptPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function createFixtureHome(config = null) {
  const tmpDir = `/tmp/aigauge-menu-test-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmpDir, { recursive: true });
  if (config) {
    mkdirSync(join(tmpDir, '.config', 'ai-gauge'), { recursive: true });
    writeFileSync(join(tmpDir, '.config', 'ai-gauge', 'config.json'), JSON.stringify(config));
  }
  return tmpDir;
}

describe('ai-gauge-menu integration', () => {
  let homeDir;

  afterEach(() => {
    if (homeDir) {
      try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
      homeDir = undefined;
    }
  });

  it('shows 🔑 Token source as top-level item (default claude-code)', async () => {
    homeDir = createFixtureHome(null);
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('🔑  Token source: claude-code');
  });

  it('shows 📋 Plan as top-level item (default unknown)', async () => {
    homeDir = createFixtureHome(null);
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('📋  Plan: unknown');
  });

  it('reflects config tokenSource and plan', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'opencode',
      plan: 'max',
      displayMode: 'full',
      autoCheckUpdates: true,
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('🔑  Token source: opencode');
    expect(stdout).toContain('📋  Plan: max');
  });

  it('preserves existing items: Refresh, Copy, Raw, Settings, Display mode (regression)', async () => {
    homeDir = createFixtureHome(null);
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('↻  Refresh Now');
    expect(stdout).toContain('  Copy Usage');
    expect(stdout).toContain('  Raw Data');
    expect(stdout).toContain('⚙  Settings');
    expect(stdout).toContain('🎨  Display mode:');
  });

  it('routes 🔑 Token source selection to token-source-submenu (DRY_RUN)', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      DRY_RUN: '1',
      SELECTED_ITEM: '🔑  Token source: claude-code',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('WOULD_OPEN: token-source-submenu');
  });

  it('routes 📋 Plan selection to plan-submenu (DRY_RUN)', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'max',
      displayMode: 'full',
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      DRY_RUN: '1',
      SELECTED_ITEM: '📋  Plan: max',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('WOULD_OPEN: plan-submenu');
  });

  it('handles corrupt config.json gracefully (does not crash)', async () => {
    homeDir = createFixtureHome(null);
    mkdirSync(join(homeDir, '.config', 'ai-gauge'), { recursive: true });
    writeFileSync(join(homeDir, '.config', 'ai-gauge', 'config.json'), '{ broken json');
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('🔑  Token source: claude-code');
    expect(stdout).toContain('📋  Plan: unknown');
  });

  it('shows ✓ checkmark on currently selected tokenSource in config submenu', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'opencode',
      plan: 'unknown',
      displayMode: 'full',
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-config', {
      HOME: homeDir,
      DRY_RUN: '1',
      SUBMENU_DRY_RUN: '1',
      SELECTED_ITEM: '🔑  Token Source: opencode',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('✓ opencode');
    expect(stdout).toContain('  claude-code');
  });

  it('backward compat: DRY_RUN without SUBMENU_DRY_RUN still prints WOULD_SET', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-config', {
      HOME: homeDir,
      DRY_RUN: '1',
      SELECTED_ITEM: '🔑  Token Source: claude-code',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('WOULD_SET: tokenSource');
    expect(stdout).not.toContain('✓');
  });
});
