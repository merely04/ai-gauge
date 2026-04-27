import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isTokenValid,
  KEYCHAIN_TIMEOUT_MS,
  getKeychainServiceName,
} from './credentials.js';

const PRIORITY = { opencode: 0, codex: 1, 'claude-code': 2 };

async function defaultSpawnSecurity(serviceName, { timeoutMs = KEYCHAIN_TIMEOUT_MS } = {}) {
  const proc = Bun.spawn(['/usr/bin/security', 'find-generic-password', '-s', serviceName, '-w'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs);
  try {
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: stdoutText.trim(), stderr: stderrText.trim(), exitCode };
  } finally {
    clearTimeout(timer);
  }
}

function defaultStatMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function getMtime(path, fsImpl) {
  try {
    if (fsImpl?.statMtime) return fsImpl.statMtime(path);
    return defaultStatMtime(path);
  } catch {
    return 0;
  }
}

async function readJsonFile(path, fsImpl) {
  if (fsImpl?.readJson) return fsImpl.readJson(path);
  return Bun.file(path).json();
}

function parseTimeoutMs(env) {
  const raw = env?.AIGAUGE_DETECT_TIMEOUT_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return KEYCHAIN_TIMEOUT_MS;
}

async function probeClaudeCodeKeychain({ spawnImpl, env, timeoutMs, isTokenValidImpl }) {
  const serviceName = getKeychainServiceName(env);
  let result;
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('keychain-timeout')), timeoutMs);
    });
    try {
      result = await Promise.race([
        spawnImpl(serviceName, { timeoutMs }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
  if (!result || result.exitCode !== 0 || !result.stdout) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const oauth = parsed?.claudeAiOauth ?? parsed;
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
  const valid = expiresAt === null || isTokenValidImpl(expiresAt);
  if (!valid) return null;
  return { mtime: 0 };
}

async function probeClaudeCodeFile(credsFile, isTokenValidImpl, fsImpl) {
  let data;
  try {
    data = await readJsonFile(credsFile, fsImpl);
  } catch {
    return { exists: false, valid: false, mtime: 0 };
  }
  const oauth = data?.claudeAiOauth ?? data;
  const accessToken = oauth?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    return { exists: true, valid: false, mtime: getMtime(credsFile, fsImpl) };
  }
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
  const valid = expiresAt === null || isTokenValidImpl(expiresAt);
  return { exists: true, valid, mtime: getMtime(credsFile, fsImpl) };
}

async function probeClaudeCode(deps) {
  const { platform, env, paths, spawnImpl, fsImpl, isTokenValidImpl } = deps;

  if (platform === 'darwin' && env?.AIGAUGE_DETECT_SKIP_KEYCHAIN !== '1') {
    const timeoutMs = parseTimeoutMs(env);
    const fromKeychain = await probeClaudeCodeKeychain({
      spawnImpl,
      env,
      timeoutMs,
      isTokenValidImpl,
    });
    if (fromKeychain) {
      return { source: 'claude-code', exists: true, valid: true, mtime: fromKeychain.mtime };
    }
  }

  const fileResult = await probeClaudeCodeFile(paths.creds, isTokenValidImpl, fsImpl);
  return { source: 'claude-code', ...fileResult };
}

async function probeOpencodeOnePath(path, isTokenValidImpl, fsImpl) {
  let data;
  try {
    data = await readJsonFile(path, fsImpl);
  } catch {
    return null;
  }
  const auth = data?.anthropic;
  if (!auth || typeof auth.access !== 'string' || !auth.access) {
    return { exists: true, valid: false, mtime: getMtime(path, fsImpl) };
  }
  const expires = auth.expires;
  let valid;
  if (expires === undefined || expires === null) {
    valid = true;
  } else {
    valid = isTokenValidImpl(expires);
  }
  return { exists: true, valid, mtime: getMtime(path, fsImpl) };
}

async function probeOpencode(deps) {
  const { paths, isTokenValidImpl, fsImpl } = deps;
  for (const p of [paths.opencodePrimary, paths.opencodeMac]) {
    const result = await probeOpencodeOnePath(p, isTokenValidImpl, fsImpl);
    if (result !== null) {
      return { source: 'opencode', ...result };
    }
  }
  return { source: 'opencode', exists: false, valid: false, mtime: 0 };
}

async function probeCodex(deps) {
  const { paths, fsImpl } = deps;
  let data;
  try {
    data = await readJsonFile(paths.codex, fsImpl);
  } catch {
    return { source: 'codex', exists: false, valid: false, mtime: 0 };
  }
  const tokens = data?.tokens;
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token || !tokens.account_id) {
    return { source: 'codex', exists: true, valid: false, mtime: getMtime(paths.codex, fsImpl) };
  }
  return { source: 'codex', exists: true, valid: true, mtime: getMtime(paths.codex, fsImpl) };
}

function buildPaths(env) {
  const home = env?.HOME ?? homedir();
  const codex = env?.CODEX_HOME
    ? join(env.CODEX_HOME, 'auth.json')
    : join(home, '.codex', 'auth.json');
  return {
    creds: join(home, '.claude', '.credentials.json'),
    opencodePrimary: join(home, '.local', 'share', 'opencode', 'auth.json'),
    opencodeMac: join(home, 'Library', 'Application Support', 'opencode', 'auth.json'),
    codex,
  };
}

export async function detectTokenSource(deps = {}) {
  try {
    const platform = deps.platform ?? process.platform;
    const env = deps.env ?? process.env;
    const paths = deps.paths ?? buildPaths(env);
    const spawnImpl = deps.spawnImpl ?? defaultSpawnSecurity;
    const fsImpl = deps.fsImpl ?? null;
    const isTokenValidImpl = deps.isTokenValidImpl ?? isTokenValid;

    const fullDeps = { platform, env, paths, spawnImpl, fsImpl, isTokenValidImpl };

    const tuples = await Promise.all([
      probeClaudeCode(fullDeps),
      probeOpencode(fullDeps),
      probeCodex(fullDeps),
    ]);

    const candidates = tuples.filter((t) => t.exists && t.valid);

    if (candidates.length === 0) {
      return { source: 'claude-code', reason: 'no-credentials-found', candidates: [] };
    }

    if (candidates.length === 1) {
      return { source: candidates[0].source, reason: 'only-valid', candidates };
    }

    const sorted = [...candidates].sort((a, b) => {
      if (b.mtime !== a.mtime) return b.mtime - a.mtime;
      return PRIORITY[a.source] - PRIORITY[b.source];
    });

    const winner = sorted[0];
    const reason = sorted[0].mtime === sorted[1].mtime ? 'priority' : 'mtime-latest';

    return { source: winner.source, reason, candidates };
  } catch (err) {
    return {
      source: 'claude-code',
      reason: 'detect-error',
      error: err?.message ?? String(err),
      candidates: [],
    };
  }
}

if (import.meta.main) {
  try {
    const result = await detectTokenSource();
    if (result.candidates.length > 1) {
      const others = result.candidates
        .filter((c) => c.source !== result.source)
        .map((c) => c.source);
      console.error(
        `Auto-detected: ${result.source} (also available: ${others.join(', ')}). Run 'ai-gauge-config' to switch.`,
      );
    }
    process.stdout.write(result.source + '\n');
    process.exit(0);
  } catch {
    process.stdout.write('claude-code\n');
    process.exit(0);
  }
}
