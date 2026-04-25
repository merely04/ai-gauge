import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readClaudeCodeCredentials, readOpenCodeCredentials } from '../lib/credentials.js';
import { readCodexCredentials, parseCodexIdToken } from '../lib/credentials-codex.js';

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

describe('readCodexCredentials', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      tempDir = undefined;
    }
  });

  function makeJwt(payload) {
    const header = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9';
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${p}.fake_sig`;
  }

  function makeCodexAccessToken({ exp, planType }) {
    const payload = { exp };
    if (planType !== undefined) {
      payload['https://api.openai.com/auth'] = { chatgpt_plan_type: planType };
    }
    return makeJwt(payload);
  }

  function createAuthJson(dir, tokens) {
    const authData = { auth_mode: 'Chatgpt', tokens, last_refresh: new Date().toISOString() };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auth.json'), JSON.stringify(authData));
  }

  it('happy path — returns token, expiresAt, subscriptionType, account_id', async () => {
    tempDir = `/tmp/codex-cred-test-${Math.random().toString(36).slice(2)}`;
    const accessJwt = makeCodexAccessToken({ exp: 9999999999, planType: 'pro' });
    createAuthJson(tempDir, {
      access_token: accessJwt,
      account_id: 'FAKE_ACCOUNT',
      id_token: makeJwt({ exp: 9999999999 }),
      refresh_token: 'FAKE_REFRESH',
    });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;

    expect(r).not.toBeNull();
    expect(r.token).toBe(accessJwt);
    expect(r.account_id).toBe('FAKE_ACCOUNT');
    expect(r.subscriptionType).toBe('pro');
    expect(r.expiresAt).toBe(9999999999000);
  });

  it('malformed access_token returns expiresAt=null, subscriptionType=unknown, no throw', async () => {
    tempDir = `/tmp/codex-cred-malformed-${Math.random().toString(36).slice(2)}`;
    createAuthJson(tempDir, {
      access_token: 'not.a.valid.jwt!!!',
      account_id: 'FAKE_ACCOUNT',
      id_token: 'also.malformed.jwt',
      refresh_token: 'X',
    });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;

    expect(r).not.toBeNull();
    expect(r.expiresAt).toBeNull();
    expect(r.subscriptionType).toBe('unknown');
    expect(r.token).toBe('not.a.valid.jwt!!!');
  });

  it('missing auth.json returns null', async () => {
    process.env.CODEX_HOME = '/nonexistent/codex-home-' + Math.random();
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;
    expect(r).toBeNull();
  });

  it('missing access_token returns null', async () => {
    tempDir = `/tmp/codex-cred-notok-${Math.random().toString(36).slice(2)}`;
    createAuthJson(tempDir, { account_id: 'FAKE_ACCOUNT', id_token: makeJwt({ exp: 9999 }) });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;
    expect(r).toBeNull();
  });

  it('missing account_id returns null', async () => {
    tempDir = `/tmp/codex-cred-noacc-${Math.random().toString(36).slice(2)}`;
    createAuthJson(tempDir, { access_token: makeCodexAccessToken({ exp: 9999, planType: 'pro' }) });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;
    expect(r).toBeNull();
  });

  it('access_token without chatgpt_plan_type returns subscriptionType=unknown', async () => {
    tempDir = `/tmp/codex-cred-noplan-${Math.random().toString(36).slice(2)}`;
    createAuthJson(tempDir, {
      access_token: makeJwt({ exp: 9999999999, sub: 'user-x' }),
      account_id: 'AA',
    });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;
    expect(r.subscriptionType).toBe('unknown');
  });

  it('access_token with legacy plan_type claim still works', async () => {
    tempDir = `/tmp/codex-cred-legacy-${Math.random().toString(36).slice(2)}`;
    createAuthJson(tempDir, {
      access_token: makeJwt({ exp: 9999999999, plan_type: 'business' }),
      account_id: 'AA',
    });
    process.env.CODEX_HOME = tempDir;
    const r = await readCodexCredentials();
    delete process.env.CODEX_HOME;
    expect(r.subscriptionType).toBe('business');
  });
});

describe('parseCodexIdToken', () => {
  it('extracts plan_type from OpenAI auth claim (real Codex shape)', () => {
    const jwt = (() => {
      const payload = { exp: 9999999999, 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } };
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `eyJhbGciOiJSUzI1NiJ9.${p}.sig`;
    })();
    const result = parseCodexIdToken(jwt);
    expect(result.exp).toBe(9999999999);
    expect(result.plan_type).toBe('plus');
  });

  it('extracts legacy top-level plan_type', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 9999999999, plan_type: 'pro' })).toString('base64url');
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    const result = parseCodexIdToken(jwt);
    expect(result.exp).toBe(9999999999);
    expect(result.plan_type).toBe('pro');
  });

  it('malformed JWT returns nulls without throwing', () => {
    const result = parseCodexIdToken('not.a.valid.jwt!!!');
    expect(result.exp).toBeNull();
    expect(result.plan_type).toBe('unknown');
  });

  it('rejects JWT larger than 16KB (DoS guard)', () => {
    const huge = 'a'.repeat(17 * 1024);
    const result = parseCodexIdToken(`${huge}.${huge}.${huge}`);
    expect(result.exp).toBeNull();
    expect(result.plan_type).toBe('unknown');
  });

  it('rejects JWT with payload segment larger than 8KB', () => {
    const header = 'eyJhbGciOiJSUzI1NiJ9';
    const huge = Buffer.from(JSON.stringify({ data: 'x'.repeat(9 * 1024) })).toString('base64url');
    const result = parseCodexIdToken(`${header}.${huge}.sig`);
    expect(result.exp).toBeNull();
    expect(result.plan_type).toBe('unknown');
  });

  it('handles malicious OPENAI_AUTH_CLAIM as array (not object)', () => {
    const payload = Buffer.from(JSON.stringify({
      exp: 9999999999,
      'https://api.openai.com/auth': ['plus'],
    })).toString('base64url');
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    const result = parseCodexIdToken(jwt);
    expect(result.exp).toBe(9999999999);
    expect(result.plan_type).toBe('unknown');
  });
});
