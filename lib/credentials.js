import { createHash } from 'node:crypto';

export const CREDS_FILE = `${process.env.HOME}/.claude/.credentials.json`;
export const OPENCODE_AUTH_FILE_PRIMARY = `${process.env.HOME}/.local/share/opencode/auth.json`;
export const OPENCODE_AUTH_FILE_MAC = `${process.env.HOME}/Library/Application Support/opencode/auth.json`;

export const KEYCHAIN_TIMEOUT_MS = 3000;

export function isTokenValid(expiresAt) {
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

export function getKeychainServiceName(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir) {
    const hash = createHash('sha256').update(configDir).digest('hex').slice(0, 8);
    return `Claude Code-credentials-${hash}`;
  }
  return 'Claude Code-credentials';
}

async function defaultSpawnSecurity(serviceName, { timeoutMs = KEYCHAIN_TIMEOUT_MS } = {}) {
  const proc = Bun.spawn(['/usr/bin/security', 'find-generic-password', '-s', serviceName, '-w'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timer = setTimeout(() => {
    try { proc.kill(); } catch {}
  }, timeoutMs);

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

function normalizeKeychainPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const oauth = parsed?.claudeAiOauth ?? parsed;
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    return null;
  }
  return {
    token: oauth.accessToken,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    subscriptionType: oauth.subscriptionType,
  };
}

async function readClaudeCodeFromKeychain({ spawnImpl = defaultSpawnSecurity, env = process.env } = {}) {
  const serviceName = getKeychainServiceName(env);
  let result;
  try {
    result = await spawnImpl(serviceName);
  } catch (err) {
    console.error(`claude-code keychain: spawn failed: ${err?.message ?? err}`);
    return null;
  }

  if (result.exitCode !== 0 || !result.stdout) {
    if (result.exitCode === 44 || /could not be found/i.test(result.stderr)) {
      return null;
    }
    if (/User interaction is not allowed/i.test(result.stderr)) {
      console.error('claude-code keychain: access denied (likely SSH/headless session); falling back to file');
      return null;
    }
    console.error(`claude-code keychain: security exited with code ${result.exitCode}: ${result.stderr || '(no stderr)'}`);
    return null;
  }

  const creds = normalizeKeychainPayload(result.stdout);
  if (!creds) {
    console.error('claude-code keychain: payload missing accessToken');
    return null;
  }
  return creds;
}

async function readClaudeCodeFromFile(credsFile) {
  try {
    const data = await Bun.file(credsFile).json();
    const oauth = data?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      token: oauth.accessToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: oauth.subscriptionType,
    };
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`claude-code creds: failed to read ${credsFile}: ${err?.code ?? err?.message ?? 'unknown'}`);
    }
    return null;
  }
}

export async function readClaudeCodeCredentials(opts = {}) {
  const {
    credsFile = CREDS_FILE,
    platform = process.platform,
    spawnImpl,
    env = process.env,
  } = typeof opts === 'string' ? { credsFile: opts } : opts;

  if (platform === 'darwin') {
    const fromKeychain = await readClaudeCodeFromKeychain({ spawnImpl, env });
    if (fromKeychain) return fromKeychain;
  }

  const fromFile = await readClaudeCodeFromFile(credsFile);
  if (fromFile) return fromFile;

  if (platform !== 'darwin') {
    console.error('no claude-code credentials');
  } else {
    console.error('no claude-code credentials (checked Keychain and ~/.claude/.credentials.json)');
  }
  return null;
}

function extractOpenCodeSecondary(data) {
  const openai = data?.openai;
  if (openai?.type !== 'oauth' || !openai?.access || !openai?.accountId) return null;

  return {
    provider: 'codex',
    token: openai.access,
    account_id: openai.accountId,
    expiresAt: openai.expires ?? Infinity,
    subscriptionType: 'unknown',
  };
}

export async function readOpenCodeCredentials(primaryPath = OPENCODE_AUTH_FILE_PRIMARY, macPath = OPENCODE_AUTH_FILE_MAC) {
  for (const path of [primaryPath, macPath]) {
    try {
      const data = await Bun.file(path).json();
      const auth = data?.anthropic;
      if (!auth?.access) continue;
      return {
        token: auth.access,
        expiresAt: auth.expires ?? Infinity,
        subscriptionType: 'unknown',
        secondary: extractOpenCodeSecondary(data),
      };
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.error(`opencode auth: failed at ${path}: ${err?.code ?? err?.message ?? 'unknown'}`);
      }
      continue;
    }
  }

  console.error('no opencode credentials');
  return null;
}
