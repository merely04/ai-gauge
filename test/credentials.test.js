import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Helper to create temp directory for test fixtures
function createTempDir() {
  const tempDir = `/tmp/credential-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// Helper to create nested directories
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

// Replicate credential reading logic with configurable paths
async function readClaudeCodeCredentials(credsFile) {
  try {
    const data = await Bun.file(credsFile).json();
    const oauth = data?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      token: oauth.accessToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: oauth.subscriptionType,
    };
  } catch {
    return null;
  }
}

async function readOpenCodeCredentials(primaryPath, macPath) {
  for (const path of [primaryPath, macPath]) {
    try {
      const data = await Bun.file(path).json();
      const auth = data?.anthropic;
      if (!auth?.access) continue;
      return {
        token: auth.access,
        expiresAt: auth.expires ?? Infinity,
        subscriptionType: 'unknown',
      };
    } catch {
      continue;
    }
  }
  return null;
}

describe('Credential Reading', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should read Claude Code credentials from fixture', async () => {
    tempDir = createTempDir();
    const credsPath = join(tempDir, '.claude', '.credentials.json');
    ensureDir(join(tempDir, '.claude'));

    const credsData = {
      claudeAiOauth: {
        accessToken: 'test-token-claude-12345',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        subscriptionType: 'pro',
      },
    };

    writeFileSync(credsPath, JSON.stringify(credsData));

    const result = await readClaudeCodeCredentials(credsPath);

    expect(result).not.toBeNull();
    expect(result.token).toBe('test-token-claude-12345');
    expect(result.subscriptionType).toBe('pro');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should read OpenCode credentials from Linux primary path', async () => {
    tempDir = createTempDir();
    const primaryPath = join(tempDir, '.local', 'share', 'opencode', 'auth.json');
    const macPath = join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json');
    ensureDir(join(tempDir, '.local', 'share', 'opencode'));

    const authData = {
      anthropic: {
        access: 'test-token-opencode-67890',
        expires: Date.now() + 7200000, // 2 hours from now
      },
    };

    writeFileSync(primaryPath, JSON.stringify(authData));

    const result = await readOpenCodeCredentials(primaryPath, macPath);

    expect(result).not.toBeNull();
    expect(result.token).toBe('test-token-opencode-67890');
    expect(result.subscriptionType).toBe('unknown');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should fallback to macOS path when Linux path is absent', async () => {
    tempDir = createTempDir();
    const primaryPath = join(tempDir, '.local', 'share', 'opencode', 'auth.json');
    const macPath = join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json');
    ensureDir(join(tempDir, 'Library', 'Application Support', 'opencode'));

    const authData = {
      anthropic: {
        access: 'test-token-macos-fallback',
        expires: Date.now() + 5400000, // 1.5 hours from now
      },
    };

    writeFileSync(macPath, JSON.stringify(authData));
    // primaryPath is NOT created, so it will fail and fallback to macPath

    const result = await readOpenCodeCredentials(primaryPath, macPath);

    expect(result).not.toBeNull();
    expect(result.token).toBe('test-token-macos-fallback');
  });

  it('should return null when both credential paths are missing', async () => {
    tempDir = createTempDir();
    const primaryPath = join(tempDir, '.local', 'share', 'opencode', 'auth.json');
    const macPath = join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json');
    // Neither path is created

    const result = await readOpenCodeCredentials(primaryPath, macPath);

    expect(result).toBeNull();
  });

  it('should return credentials even when token is expired (expiry validated by isTokenValid caller)', async () => {
    tempDir = createTempDir();
    const credsPath = join(tempDir, '.claude', '.credentials.json');
    ensureDir(join(tempDir, '.claude'));

    const credsData = {
      claudeAiOauth: {
        accessToken: 'test-token-expired',
        expiresAt: Date.now() - 3600000, // 1 hour ago (expired)
        subscriptionType: 'pro',
      },
    };

    writeFileSync(credsPath, JSON.stringify(credsData));

    const result = await readClaudeCodeCredentials(credsPath);

    // The function returns the data regardless of expiration
    // Expiration check is done elsewhere (isTokenValid)
    expect(result).not.toBeNull();
    expect(result.expiresAt).toBeLessThan(Date.now());
  });

  it('should return null when accessToken is missing in Claude Code credentials', async () => {
    tempDir = createTempDir();
    const credsPath = join(tempDir, '.claude', '.credentials.json');
    ensureDir(join(tempDir, '.claude'));

    const credsData = {
      claudeAiOauth: {
        // accessToken is missing
        expiresAt: Date.now() + 3600000,
        subscriptionType: 'pro',
      },
    };

    writeFileSync(credsPath, JSON.stringify(credsData));

    const result = await readClaudeCodeCredentials(credsPath);

    expect(result).toBeNull();
  });

  it('should return null when anthropic.access is missing in OpenCode credentials', async () => {
    tempDir = createTempDir();
    const primaryPath = join(tempDir, '.local', 'share', 'opencode', 'auth.json');
    const macPath = join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json');
    ensureDir(join(tempDir, '.local', 'share', 'opencode'));

    const authData = {
      anthropic: {
        // access is missing
        expires: Date.now() + 7200000,
      },
    };

    writeFileSync(primaryPath, JSON.stringify(authData));

    const result = await readOpenCodeCredentials(primaryPath, macPath);

    expect(result).toBeNull();
  });

  it('should handle malformed JSON gracefully', async () => {
    tempDir = createTempDir();
    const credsPath = join(tempDir, '.claude', '.credentials.json');
    ensureDir(join(tempDir, '.claude'));

    writeFileSync(credsPath, 'not valid json {]');

    const result = await readClaudeCodeCredentials(credsPath);

    expect(result).toBeNull();
  });

  it('should use Infinity as default expiresAt for OpenCode when expires is missing', async () => {
    tempDir = createTempDir();
    const primaryPath = join(tempDir, '.local', 'share', 'opencode', 'auth.json');
    const macPath = join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json');
    ensureDir(join(tempDir, '.local', 'share', 'opencode'));

    const authData = {
      anthropic: {
        access: 'test-token-no-expiry',
        // expires is missing, should default to Infinity
      },
    };

    writeFileSync(primaryPath, JSON.stringify(authData));

    const result = await readOpenCodeCredentials(primaryPath, macPath);

    expect(result).not.toBeNull();
    expect(result.expiresAt).toBe(Infinity);
  });
});
