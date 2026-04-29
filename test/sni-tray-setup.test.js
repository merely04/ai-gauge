import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function runSetup(env = {}) {
  const proc = Bun.spawn(['bash', 'bin/ai-gauge', 'setup'], {
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

async function runUninstall(env = {}) {
  const proc = Bun.spawn(['bash', 'bin/ai-gauge', 'uninstall'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, OSTYPE: 'linux-gnu', ...env },
    signal: AbortSignal.timeout(5000),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function createFixtureHome() {
  const tmpDir = `/tmp/aigauge-tray-setup-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

describe('SNI tray setup wiring', () => {
  let homeDir;

  afterEach(() => {
    if (homeDir) {
      try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
      homeDir = undefined;
    }
  });

  it('dry-run with SNI capable: emits 4 SNI-related skip lines', async () => {
    homeDir = createFixtureHome();
    const { stderr, exitCode } = await runSetup({
      HOME: homeDir,
      AIGAUGE_SETUP_DRY_RUN: '1',
      AIGAUGE_SETUP_PLATFORM: 'linux',
      AIGAUGE_TEST_FORCE_NO_SNI: '',
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain('[setup-dry-run] skip: sni icons install');
    expect(stderr).toContain('[setup-dry-run] skip: sni tray unit install');
    expect(stderr).toContain('[setup-dry-run] skip: systemctl daemon-reload (sni tray)');
    expect(stderr).toContain('[setup-dry-run] skip: sni tray enable');
  });

  it('dry-run with AIGAUGE_TEST_FORCE_NO_SNI=1: shows skip message, no SNI dry-run lines', async () => {
    homeDir = createFixtureHome();
    const { stdout, stderr, exitCode } = await runSetup({
      HOME: homeDir,
      AIGAUGE_SETUP_DRY_RUN: '1',
      AIGAUGE_SETUP_PLATFORM: 'linux',
      AIGAUGE_TEST_FORCE_NO_SNI: '1',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('SNI tray not available');
    expect(stderr).not.toContain('sni icons install');
    expect(stderr).not.toContain('sni tray unit install');
    expect(stderr).not.toContain('systemctl daemon-reload (sni tray)');
    expect(stderr).not.toContain('sni tray enable');
  });

  it('uninstall on bare HOME: exits 0, no Removed messages, idempotent', async () => {
    homeDir = createFixtureHome();
    const { stdout, exitCode } = await runUninstall({ HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Removed ai-gauge-tray.service');
    expect(stdout).not.toContain('Removed SNI tray icons');
  });

  it('uninstall with stub install: removes service unit and icons', async () => {
    homeDir = createFixtureHome();
    const systemdDir = join(homeDir, '.config', 'systemd', 'user');
    const iconDir = join(homeDir, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps');
    mkdirSync(systemdDir, { recursive: true });
    mkdirSync(iconDir, { recursive: true });
    writeFileSync(join(systemdDir, 'ai-gauge-tray.service'), '[Unit]\nDescription=stub\n');
    for (const variant of ['normal', 'waiting', 'warning', 'critical', 'update-available', 'updating']) {
      writeFileSync(join(iconDir, `ai-gauge-${variant}.svg`), '<svg/>');
    }

    const { stdout, exitCode } = await runUninstall({ HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Removed ai-gauge-tray.service');
    expect(stdout).toContain('Removed SNI tray icons');
  });

  it('regression: existing waybar / streamdock dry-run lines still emitted', async () => {
    homeDir = createFixtureHome();
    const { stderr, exitCode } = await runSetup({
      HOME: homeDir,
      AIGAUGE_SETUP_DRY_RUN: '1',
      AIGAUGE_SETUP_PLATFORM: 'linux',
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain('[setup-dry-run] skip: streamdock plugin install');
    expect(stderr).toContain('[setup-dry-run] skip: waybar config patch');
    expect(stderr).toContain('[setup-dry-run] skip: waybar css patch');
    expect(stderr).toContain('[setup-dry-run] skip: waybar restart');
  });
});
