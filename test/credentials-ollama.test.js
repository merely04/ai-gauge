import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readOllamaCloudCredentials } from '../lib/credentials-ollama.js';

function createTempDir() {
  const tempDir = `/tmp/ollama-cred-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

describe('readOllamaCloudCredentials', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      tempDir = undefined;
    }
  });

  it('reads a valid cookie file and returns { token, source: "file" }', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    writeFileSync(cookiePath, 'aid=abc123; __Secure-session=xyz789');

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result).toEqual({
      token: 'aid=abc123; __Secure-session=xyz789',
      source: 'file',
    });
  });

  it('preserves cookie format verbatim (including semicolons and spaces)', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    const cookieValue = 'aid=x; cf_clearance=y; __Secure-session=z';
    writeFileSync(cookiePath, cookieValue);

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result.token).toBe(cookieValue);
  });

  it('trims leading and trailing whitespace from cookie', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    writeFileSync(cookiePath, '  aid=abc; session=xyz  \n');

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result.token).toBe('aid=abc; session=xyz');
  });

  it('returns null when cookie file does not exist', async () => {
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result).toBeNull();
  });

  it('returns null when cookie file is empty', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    writeFileSync(cookiePath, '');

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result).toBeNull();
  });

  it('returns null when cookie file contains only whitespace', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    writeFileSync(cookiePath, '   \n  \t  ');

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result).toBeNull();
  });

  it('uses default path ~/.config/ai-gauge/ollama-cookie when cookiePath is omitted', async () => {
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = tempDir;
      ensureDir(join(tempDir, '.config', 'ai-gauge'));
      const defaultPath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
      writeFileSync(defaultPath, 'aid=default_test');

      const result = await readOllamaCloudCredentials();
      expect(result).toEqual({
        token: 'aid=default_test',
        source: 'file',
      });
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('handles single-line cookie with multiple semicolon-separated values', async () => {
    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    const cookiePath = join(tempDir, '.config', 'ai-gauge', 'ollama-cookie');
    const complexCookie = 'aid=val1; cf_clearance=val2; __Secure-session=val3; other=val4';
    writeFileSync(cookiePath, complexCookie);

    const result = await readOllamaCloudCredentials(cookiePath);
    expect(result.token).toBe(complexCookie);
  });
});
