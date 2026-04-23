import { describe, it, expect, afterEach } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverSettingsFiles, readSettingsFileForCreds } from '../lib/settings-discovery.js';

let tempDir;

function setup(name) {
  tempDir = `/tmp/settings-discovery-test-${name}-${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(join(tempDir, '.claude'), { recursive: true });
  return join(tempDir, '.claude');
}

afterEach(() => {
  if (!tempDir) return;

  try {
    chmodSync(tempDir, 0o755);
    chmodSync(join(tempDir, '.claude'), 0o755);
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }

  tempDir = undefined;
});

describe('discoverSettingsFiles', () => {
  it('returns empty array for nonexistent dir', () => {
    expect(discoverSettingsFiles('/nonexistent/path/.claude')).toEqual([]);
  });

  it('returns default first, then alphabetical', () => {
    const dir = setup('sort');

    writeFileSync(join(dir, 'settings.z.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));
    writeFileSync(join(dir, 'settings.a.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));

    const results = discoverSettingsFiles(dir);

    expect(results.map((result) => result.name)).toEqual(['default', 'a', 'z']);
  });

  it('excludes settings.local.json', () => {
    const dir = setup('local');

    writeFileSync(join(dir, 'settings.local.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'LOCAL' } }));

    expect(discoverSettingsFiles(dir)).toEqual([]);
  });

  it('ignores filenames that do not match the safe pattern', () => {
    const dir = setup('names');

    writeFileSync(join(dir, 'settings..hidden.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));
    writeFileSync(join(dir, 'settings-.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));
    writeFileSync(join(dir, 'settings.valid.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'T' } }));

    const results = discoverSettingsFiles(dir);

    expect(results.map((result) => result.name)).toEqual(['valid']);
  });

  it('flags symlinks as unsupported', () => {
    const dir = setup('symlink');

    symlinkSync('/etc/passwd', join(dir, 'settings.evil.json'));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'evil',
      provider: 'unknown',
      baseUrl: null,
      hasToken: false,
      hasApiKeyHelper: false,
      supported: false,
      skipReason: 'symlink',
    });
  });

  it('flags files larger than 1MB without reading them', () => {
    const dir = setup('large');

    writeFileSync(join(dir, 'settings.big.json'), 'x'.repeat(1024 * 1024 + 1));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'big',
      provider: 'unknown',
      baseUrl: null,
      hasToken: false,
      hasApiKeyHelper: false,
      supported: false,
      skipReason: 'too-large',
    });
  });

  it('flags apiKeyHelper-only files as unsupported', () => {
    const dir = setup('helper');

    writeFileSync(join(dir, 'settings.evil.json'), JSON.stringify({ apiKeyHelper: 'touch /tmp/pwned-helper' }));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'evil',
      provider: 'anthropic',
      baseUrl: null,
      hasToken: false,
      hasApiKeyHelper: true,
      supported: false,
      skipReason: 'apiKeyHelper-only',
    });
  });

  it('does not execute apiKeyHelper', () => {
    const dir = setup('noexec');
    const pwnedPath = '/tmp/pwned-noexec-test-12345';

    rmSync(pwnedPath, { force: true });
    writeFileSync(join(dir, 'settings.evil.json'), JSON.stringify({ apiKeyHelper: `touch ${pwnedPath}` }));

    discoverSettingsFiles(dir);

    expect(existsSync(pwnedPath)).toBe(false);
  });

  it('flags invalid JSON as invalid-json', () => {
    const dir = setup('badjson');

    writeFileSync(join(dir, 'settings.bad.json'), 'not valid json {]');

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'bad',
      provider: 'unknown',
      baseUrl: null,
      hasToken: false,
      hasApiKeyHelper: false,
      supported: false,
      skipReason: 'invalid-json',
    });
  });

  it('flags directories as not-a-file', () => {
    const dir = setup('dir-as-file');

    mkdirSync(join(dir, 'settings.dir.json'));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'dir',
      provider: 'unknown',
      baseUrl: null,
      hasToken: false,
      hasApiKeyHelper: false,
      supported: false,
      skipReason: 'not-a-file',
    });
  });

  it('flags unreadable files as permission-denied', () => {
    const dir = setup('permission-denied');
    const file = join(dir, 'settings.locked.json');

    writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'LOCKED' } }));
    chmodSync(file, 0o000);

    try {
      expect(discoverSettingsFiles(dir)).toContainEqual({
        name: 'locked',
        provider: 'unknown',
        baseUrl: null,
        hasToken: false,
        hasApiKeyHelper: false,
        supported: false,
        skipReason: 'permission-denied',
      });
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('flags files without token as no-token', () => {
    const dir = setup('notoken');

    writeFileSync(join(dir, 'settings.empty.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.z.ai' } }));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'empty',
      provider: 'zai',
      baseUrl: 'https://api.z.ai',
      hasToken: false,
      hasApiKeyHelper: false,
      supported: false,
      skipReason: 'no-token',
    });
  });

  it('detects provider from baseUrl and marks valid files supported', () => {
    const dir = setup('zai');

    writeFileSync(join(dir, 'settings.z.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'ZTOKEN',
      },
    }));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'z',
      provider: 'zai',
      baseUrl: 'https://api.z.ai/api/anthropic',
      hasToken: true,
      hasApiKeyHelper: false,
      supported: true,
    });
  });

  it('returns unknown provider for unrecognized baseUrl', () => {
    const dir = setup('unknown');

    writeFileSync(join(dir, 'settings.custom.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://custom.ai/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'T',
      },
    }));

    expect(discoverSettingsFiles(dir)[0].provider).toBe('unknown');
  });

  it('keeps apiKeyHelper metadata when direct token also exists', () => {
    const dir = setup('helper-token');

    writeFileSync(join(dir, 'settings.combo.json'), JSON.stringify({
      apiKeyHelper: 'touch /tmp/ignored-helper',
      env: { ANTHROPIC_AUTH_TOKEN: 'T' },
    }));

    expect(discoverSettingsFiles(dir)).toContainEqual({
      name: 'combo',
      provider: 'anthropic',
      baseUrl: null,
      hasToken: true,
      hasApiKeyHelper: true,
      supported: true,
    });
  });

  it('does not include internal path or token fields in discovery output', () => {
    const dir = setup('shape');

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'SECRET' } }));

    const result = discoverSettingsFiles(dir)[0];

    expect(result.path).toBeUndefined();
    expect(result.token).toBeUndefined();
  });
});

describe('readSettingsFileForCreds', () => {
  it('returns token, baseUrl, provider and name for valid file', () => {
    const dir = setup('creds');

    writeFileSync(join(dir, 'settings.z.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai',
        ANTHROPIC_AUTH_TOKEN: 'ZTOKEN',
      },
    }));

    expect(readSettingsFileForCreds(dir, 'z')).toEqual({
      token: 'ZTOKEN',
      baseUrl: 'https://api.z.ai',
      provider: 'zai',
      name: 'z',
    });
  });

  it('returns default settings credentials for name=default', () => {
    const dir = setup('default-creds');

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'DEFAULT' } }));

    expect(readSettingsFileForCreds(dir, 'default')).toEqual({
      token: 'DEFAULT',
      baseUrl: null,
      provider: 'anthropic',
      name: 'default',
    });
  });

  it('returns null for symlink file', () => {
    const dir = setup('cred-symlink');

    symlinkSync('/etc/passwd', join(dir, 'settings.malicious.json'));

    expect(readSettingsFileForCreds(dir, 'malicious')).toBeNull();
  });

  it('returns null for apiKeyHelper-only file', () => {
    const dir = setup('cred-helper');

    writeFileSync(join(dir, 'settings.helper.json'), JSON.stringify({ apiKeyHelper: 'touch /tmp/pwned' }));

    expect(readSettingsFileForCreds(dir, 'helper')).toBeNull();
  });

  it('returns null for path traversal names', () => {
    expect(readSettingsFileForCreds('/any/path', '..')).toBeNull();
    expect(readSettingsFileForCreds('/any/path', '/tmp/evil')).toBeNull();
  });

  it('returns null for missing file', () => {
    const dir = setup('missing');

    expect(readSettingsFileForCreds(dir, 'doesnotexist')).toBeNull();
  });

  it('returns null for oversized file', () => {
    const dir = setup('oversized-creds');

    writeFileSync(join(dir, 'settings.big.json'), 'x'.repeat(1024 * 1024 + 1));

    expect(readSettingsFileForCreds(dir, 'big')).toBeNull();
  });
});
