import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalTmpdir = process.env.TMPDIR;
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
const originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;

function importFreshPaths() {
  return import(`./paths.js?ts=${Date.now()}-${Math.random()}`);
}

function setEnvVar(key, value) {
  if (value === undefined) {
    delete process.env[key];
    delete Bun.env[key];
  } else {
    process.env[key] = value;
    Bun.env[key] = value;
  }
}

function withTestEnv(env, fn) {
  return async () => {
    setEnvVar('HOME', env.HOME);
    setEnvVar('TMPDIR', env.TMPDIR);
    setEnvVar('XDG_CACHE_HOME', env.XDG_CACHE_HOME);
    setEnvVar('XDG_RUNTIME_DIR', env.XDG_RUNTIME_DIR);
    try {
      await fn();
    } finally {
      setEnvVar('HOME', originalHome);
      setEnvVar('TMPDIR', originalTmpdir);
      setEnvVar('XDG_CACHE_HOME', originalXdgCacheHome);
      setEnvVar('XDG_RUNTIME_DIR', originalXdgRuntimeDir);
    }
  };
}

describe('paths helpers', () => {
  afterEach(() => {
    const home = process.env.HOME;
    if (home && home.startsWith('/tmp/ai-gauge-paths-test-')) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('module import does not create directories', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
    TMPDIR: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
  }, async () => {
    const { getCacheDir, getConfigDir } = await importFreshPaths();
    expect(existsSync(join(process.env.HOME, 'Library', 'Caches', 'ai-gauge'))).toBe(false);
    expect(existsSync(join(process.env.HOME, '.config', 'ai-gauge'))).toBe(false);
    expect(typeof getCacheDir).toBe('function');
    expect(typeof getConfigDir).toBe('function');
  }));

  test('getCacheDir() returns the macOS cache directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
    TMPDIR: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
  }, async () => {
    const { getCacheDir } = await importFreshPaths();
    expect(getCacheDir()).toBe(join(process.env.HOME, 'Library', 'Caches', 'ai-gauge'));
  }));

  test('getCacheDir() creates the directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
    TMPDIR: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
  }, async () => {
    const { getCacheDir } = await importFreshPaths();
    const dir = getCacheDir();
    expect(existsSync(dir)).toBe(true);
  }));

  test('getStateDir() returns the macOS state directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
    TMPDIR: join('/tmp', `ai-gauge-paths-test-${Date.now()}/`),
  }, async () => {
    const { getStateDir } = await importFreshPaths();
    expect(getStateDir()).toBe(join(process.env.TMPDIR.replace(/\/$/, ''), 'ai-gauge'));
  }));

  test('getStateDir() creates the directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
    TMPDIR: join('/tmp', `ai-gauge-paths-test-${Date.now()}/`),
  }, async () => {
    const { getStateDir } = await importFreshPaths();
    const dir = getStateDir();
    expect(existsSync(dir)).toBe(true);
  }));

  test('getConfigDir() returns the config directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
  }, async () => {
    const { getConfigDir } = await importFreshPaths();
    expect(getConfigDir()).toBe(join(process.env.HOME, '.config', 'ai-gauge'));
  }));

  test('getConfigDir() creates the directory', withTestEnv({
    HOME: join('/tmp', `ai-gauge-paths-test-${Date.now()}`),
  }, async () => {
    const { getConfigDir } = await importFreshPaths();
    const dir = getConfigDir();
    expect(existsSync(dir)).toBe(true);
  }));
});
