import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { detectTokenSource } from '../lib/detect-token-source.js';

function createTempDir() {
  const tempDir = `/tmp/detect-token-source-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function pathsFor(tempDir) {
  return {
    creds: join(tempDir, '.claude', '.credentials.json'),
    opencodePrimary: join(tempDir, '.local', 'share', 'opencode', 'auth.json'),
    opencodeMac: join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json'),
    codex: join(tempDir, '.codex', 'auth.json'),
  };
}

function writeClaudeCodeFile(paths, { accessToken = 'cc-token', expiresAt = Date.now() + 3600000 } = {}) {
  ensureDir(join(paths.creds, '..'));
  writeFileSync(paths.creds, JSON.stringify({
    claudeAiOauth: { accessToken, expiresAt, subscriptionType: 'pro' },
  }));
}

function writeOpencodePrimary(paths, { access = 'oc-token', expires } = {}) {
  ensureDir(join(paths.opencodePrimary, '..'));
  const auth = { access };
  if (expires !== undefined) auth.expires = expires;
  writeFileSync(paths.opencodePrimary, JSON.stringify({ anthropic: auth }));
}

function writeOpencodeMac(paths, { access = 'oc-mac-token', expires } = {}) {
  ensureDir(join(paths.opencodeMac, '..'));
  const auth = { access };
  if (expires !== undefined) auth.expires = expires;
  writeFileSync(paths.opencodeMac, JSON.stringify({ anthropic: auth }));
}

function writeCodex(paths, { access_token = 'cx-token', account_id = 'ACC-1' } = {}) {
  ensureDir(join(paths.codex, '..'));
  const tokens = {};
  if (access_token !== undefined) tokens.access_token = access_token;
  if (account_id !== undefined) tokens.account_id = account_id;
  writeFileSync(paths.codex, JSON.stringify({ tokens, auth_mode: 'Chatgpt' }));
}

function setMtime(path, ms) {
  const date = new Date(ms);
  utimesSync(path, date, date);
}

function makeBaseDeps(tempDir, opts = {}) {
  return {
    platform: opts.platform ?? 'linux',
    env: opts.env ?? {},
    paths: opts.paths ?? pathsFor(tempDir),
    spawnImpl: opts.spawnImpl ?? (async () => ({ stdout: '', stderr: 'item not found', exitCode: 44 })),
    fsImpl: opts.fsImpl,
    isTokenValidImpl: opts.isTokenValidImpl,
  };
}

describe('detectTokenSource', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      tempDir = undefined;
    }
  });

  it('1. happy path — only opencode creds present → source=opencode', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeOpencodePrimary(paths);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('opencode');
    expect(result.reason).toBe('only-valid');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].source).toBe('opencode');
  });

  it('2. no credentials anywhere → source=claude-code, reason=no-credentials-found', async () => {
    tempDir = createTempDir();

    const result = await detectTokenSource(makeBaseDeps(tempDir));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('no-credentials-found');
    expect(result.candidates).toEqual([]);
  });

  it('3. multiple valid sources — claude-code newer than opencode → source=claude-code (mtime-latest)', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    writeOpencodePrimary(paths);

    const now = Date.now();
    setMtime(paths.creds, now);
    setMtime(paths.opencodePrimary, now - 3600 * 1000);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('mtime-latest');
    expect(result.candidates).toHaveLength(2);
  });

  it('4. multiple sources, same mtime → fixed priority → source=opencode', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    writeOpencodePrimary(paths);

    const fixed = Date.now() - 60_000;
    setMtime(paths.creds, fixed);
    setMtime(paths.opencodePrimary, fixed);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('opencode');
    expect(result.reason).toBe('priority');
  });

  it('5. expired token in opencode → filtered out → fallback to claude-code', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    writeOpencodePrimary(paths, { expires: Date.now() - 60_000 });

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('only-valid');
    expect(result.candidates.map((c) => c.source)).toEqual(['claude-code']);
  });

  it('6. malformed opencode auth.json (invalid JSON) → silent skip, resolves with claude-code', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    ensureDir(join(paths.opencodePrimary, '..'));
    writeFileSync(paths.opencodePrimary, 'not valid json {]');

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('claude-code');
    expect(result.candidates.map((c) => c.source)).toEqual(['claude-code']);
  });

  it('7. macOS Keychain timeout (spawnImpl hangs) → fallback to file', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);

    const spawnImpl = () => new Promise(() => {});
    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      env: { AIGAUGE_DETECT_TIMEOUT_MS: '50' },
      spawnImpl,
    }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('only-valid');
    expect(result.candidates[0].mtime).toBeGreaterThan(0);
  });

  it('8. AIGAUGE_DETECT_SKIP_KEYCHAIN=1 → file fallback without Keychain spawn', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);

    let spawnCalled = false;
    const spawnImpl = async () => {
      spawnCalled = true;
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      env: { AIGAUGE_DETECT_SKIP_KEYCHAIN: '1' },
      spawnImpl,
    }));

    expect(spawnCalled).toBe(false);
    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('only-valid');
  });

  it('9. codex with only api_key (no tokens.access_token) → codex filtered, fallback claude-code', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    ensureDir(join(paths.codex, '..'));
    writeFileSync(paths.codex, JSON.stringify({ api_key: 'sk-xxx' }));

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('claude-code');
    expect(result.candidates.map((c) => c.source)).toEqual(['claude-code']);
  });

  it('10. detectTokenSource throws internally → graceful error return', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);

    const isTokenValidImpl = () => { throw new Error('synthetic-error'); };

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      isTokenValidImpl,
    }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('detect-error');
    expect(result.error).toContain('synthetic-error');
    expect(result.candidates).toEqual([]);
  });

  it('11. only codex valid → source=codex', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeCodex(paths);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('codex');
    expect(result.reason).toBe('only-valid');
    expect(result.candidates[0].source).toBe('codex');
  });

  it('12. only claude-code file valid (no Keychain) → source=claude-code, reason=only-valid', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      env: { AIGAUGE_DETECT_SKIP_KEYCHAIN: '1' },
    }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('only-valid');
  });

  it('13. all 3 valid, codex newest → source=codex, reason=mtime-latest', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths);
    writeOpencodePrimary(paths);
    writeCodex(paths);

    const now = Date.now();
    setMtime(paths.creds, now - 3 * 3600 * 1000);
    setMtime(paths.opencodePrimary, now - 2 * 3600 * 1000);
    setMtime(paths.codex, now);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('codex');
    expect(result.reason).toBe('mtime-latest');
    expect(result.candidates).toHaveLength(3);
  });

  it('14. opencode primary missing but mac fallback exists → source=opencode', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeOpencodeMac(paths);

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('opencode');
    expect(result.reason).toBe('only-valid');
  });

  it('15. macOS Keychain returns valid creds → source=claude-code with mtime=0', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    const spawnImpl = async () => ({
      stdout: JSON.stringify({
        claudeAiOauth: {
          accessToken: 'kc-token',
          expiresAt: Date.now() + 3600000,
          subscriptionType: 'max',
        },
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      spawnImpl,
    }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('only-valid');
    expect(result.candidates[0].mtime).toBe(0);
  });

  it('16. malformed Keychain payload → fallback to file', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths, { accessToken: 'file-fallback' });

    const spawnImpl = async () => ({
      stdout: 'not valid json {]',
      stderr: '',
      exitCode: 0,
    });

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      spawnImpl,
    }));

    expect(result.source).toBe('claude-code');
    expect(result.candidates[0].mtime).toBeGreaterThan(0);
  });

  it('17. file mtime beats Keychain (mtime=0) when both valid', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeOpencodePrimary(paths);
    setMtime(paths.opencodePrimary, Date.now() - 60_000);

    const spawnImpl = async () => ({
      stdout: JSON.stringify({
        claudeAiOauth: {
          accessToken: 'kc-token',
          expiresAt: Date.now() + 3600000,
          subscriptionType: 'max',
        },
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await detectTokenSource(makeBaseDeps(tempDir, {
      paths,
      platform: 'darwin',
      spawnImpl,
    }));

    expect(result.source).toBe('opencode');
    expect(result.reason).toBe('mtime-latest');
  });

  it('18. opencode without expires field treated as valid (no expiry)', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeOpencodePrimary(paths, { expires: undefined });

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('opencode');
    expect(result.reason).toBe('only-valid');
  });

  it('19. claude-code expired → filtered out → no-credentials-found', async () => {
    tempDir = createTempDir();
    const paths = pathsFor(tempDir);
    writeClaudeCodeFile(paths, { expiresAt: Date.now() - 60_000 });

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('claude-code');
    expect(result.reason).toBe('no-credentials-found');
  });

  it('20. custom paths.codex argument is honored', async () => {
    tempDir = createTempDir();
    const customCodexHome = join(tempDir, 'custom-codex');
    ensureDir(customCodexHome);
    const codexAuth = join(customCodexHome, 'auth.json');
    writeFileSync(codexAuth, JSON.stringify({
      tokens: { access_token: 'custom-codex-token', account_id: 'CUSTOM' },
    }));

    const paths = {
      creds: join(tempDir, '.claude', '.credentials.json'),
      opencodePrimary: join(tempDir, '.local', 'share', 'opencode', 'auth.json'),
      opencodeMac: join(tempDir, 'Library', 'Application Support', 'opencode', 'auth.json'),
      codex: codexAuth,
    };

    const result = await detectTokenSource(makeBaseDeps(tempDir, { paths }));

    expect(result.source).toBe('codex');
    expect(result.reason).toBe('only-valid');
  });

  it('21. CODEX_HOME env var drives path resolution via buildPaths', async () => {
    tempDir = createTempDir();
    const customCodexHome = join(tempDir, 'custom-codex-home');
    ensureDir(customCodexHome);
    writeFileSync(
      join(customCodexHome, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'codex-via-env',
          account_id: 'ACC',
        },
      })
    );

    // No `paths` provided — must rely on buildPaths(env)
    const result = await detectTokenSource({
      env: {
        HOME: tempDir,
        CODEX_HOME: customCodexHome,
        AIGAUGE_DETECT_SKIP_KEYCHAIN: '1',
      },
      platform: 'linux',
      isTokenValidImpl: () => true,
    });

    expect(result.source).toBe('codex');
  });

  it('22. HOME env var drives path resolution for opencode via buildPaths', async () => {
    tempDir = createTempDir();
    ensureDir(join(tempDir, '.local', 'share', 'opencode'));
    writeFileSync(
      join(tempDir, '.local', 'share', 'opencode', 'auth.json'),
      JSON.stringify({ anthropic: { access: 'x', expires: 9999999999000 } })
    );

    const result = await detectTokenSource({
      env: { HOME: tempDir, AIGAUGE_DETECT_SKIP_KEYCHAIN: '1' },
      platform: 'linux',
      isTokenValidImpl: () => true,
    });

    expect(result.source).toBe('opencode');
  });
});
