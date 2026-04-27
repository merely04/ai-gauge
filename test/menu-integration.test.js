import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function runScript(scriptPath, env = {}) {
  const proc = Bun.spawn(['bash', scriptPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
    signal: AbortSignal.timeout(5000),
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

  it('preserves existing items: Refresh, Copy, Raw, Display mode, Auto-check (regression)', async () => {
    homeDir = createFixtureHome(null);
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('↻  Refresh Now');
    expect(stdout).toContain('  Copy Usage');
    expect(stdout).toContain('  Raw Data');
    expect(stdout).toContain('🎨  Display mode:');
    expect(stdout).toContain('🔄  Auto-check updates:');
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

  it('shows ✨ Update to v<X> when update-state.json has version', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: true,
    });
    const xdgRuntime = join(homeDir, 'xdg-runtime');
    const stateDir = join(xdgRuntime, 'ai-gauge');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'update-state.json'),
      JSON.stringify({ version: '2.0.0', installing: false })
    );

    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      XDG_RUNTIME_DIR: xdgRuntime,
      DRY_RUN: '1',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('✨ Update to v2.0.0');
    expect(stdout).not.toContain('⏳ Updating...');
  });

  it('shows ⏳ Updating... when update is in progress (and hides Update to vX)', async () => {
    homeDir = createFixtureHome(null);
    const xdgRuntime = join(homeDir, 'xdg-runtime');
    const stateDir = join(xdgRuntime, 'ai-gauge');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'update-state.json'),
      JSON.stringify({ version: '2.0.0', installing: true })
    );

    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      XDG_RUNTIME_DIR: xdgRuntime,
      DRY_RUN: '1',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('⏳ Updating...');
    expect(stdout).not.toContain('✨ Update to');
  });

  it('omits update items when update-state.json absent', async () => {
    homeDir = createFixtureHome(null);
    const xdgRuntime = join(homeDir, 'xdg-runtime');
    mkdirSync(xdgRuntime, { recursive: true });

    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      XDG_RUNTIME_DIR: xdgRuntime,
      DRY_RUN: '1',
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('✨ Update to');
    expect(stdout).not.toContain('⏳ Updating...');
    expect(stdout).toContain('🔍 Check for updates');
  });

  it('shows ✓ checkmark on currently selected plan in plan submenu', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'pro',
      displayMode: 'full',
    });

    const { stdout, exitCode } = await runScript('bin/ai-gauge-config', {
      HOME: homeDir,
      DRY_RUN: '1',
      SUBMENU_DRY_RUN: '1',
      SELECTED_ITEM: '📋  Plan: pro',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('✓ pro');
    expect(stdout).toContain('  max');
    expect(stdout).toContain('  team');
    expect(stdout).toContain('  enterprise');
  });

  it('shows ✓ checkmark on currently selected display mode in display mode submenu', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'time-to-reset',
    });

    const { stdout, exitCode } = await runScript('bin/ai-gauge-config', {
      HOME: homeDir,
      DRY_RUN: '1',
      SUBMENU_DRY_RUN: '1',
      SELECTED_ITEM: '🎨  Display mode: time-to-reset',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('✓ time-to-reset');
    expect(stdout).toContain('  full');
    expect(stdout).toContain('  bar-dots');
  });

  it('shows 🔄 Auto-check updates: ON when autoCheckUpdates=true in config', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: true,
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('🔄  Auto-check updates: ON');
  });

  it('shows 🔄 Auto-check updates: OFF when autoCheckUpdates=false in config', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: false,
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('🔄  Auto-check updates: OFF');
  });

  it('selecting Auto-check updates triggers toggle (DRY_RUN)', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: true,
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      DRY_RUN: '1',
      SELECTED_ITEM: '🔄  Auto-check updates: ON',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('WOULD_TOGGLE: autoCheckUpdates -> false');
  });

  it('selecting Display mode routes to display-mode-submenu (DRY_RUN)', async () => {
    homeDir = createFixtureHome({
      tokenSource: 'claude-code',
      plan: 'unknown',
      displayMode: 'full',
    });
    const { stdout, exitCode } = await runScript('bin/ai-gauge-menu', {
      HOME: homeDir,
      DRY_RUN: '1',
      SELECTED_ITEM: '🎨  Display mode: full',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('WOULD_OPEN: display-mode-submenu');
  });

  it('does NOT show ⚙ Settings (removed for macOS parity)', async () => {
    homeDir = createFixtureHome(null);
    const { stdout } = await runScript('bin/ai-gauge-menu', { HOME: homeDir, DRY_RUN: '1' });
    expect(stdout).not.toContain('⚙  Settings');
  });
});
