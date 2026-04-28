import { homedir } from 'node:os';
import { join } from 'node:path';
import { logJson } from './log-safe.js';

const GHO_PREFIX = 'gho_';
const GHP_PREFIX = 'ghp_';
const GITHUB_PAT_PREFIX = 'github_pat_';
const SPAWN_TIMEOUT_MS = 3000;

export function parseGhHostsYaml(text) {
  if (typeof text !== 'string') return { token: null, mode: 'unknown' };

  const lines = text.split('\n');
  let inGithubBlock = false;
  let blockEntered = false;
  let hasUserInBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\S/.test(line)) {
      if (inGithubBlock) {
        inGithubBlock = false;
        break;
      }
      if (/^github\.com:\s*(?:#.*)?$/.test(line)) {
        inGithubBlock = true;
        blockEntered = true;
      }
      continue;
    }

    if (!inGithubBlock) continue;

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const tokenMatch = line.match(/^\s+oauth_token:\s*(.*?)\s*(?:#.*)?$/);
    if (tokenMatch) {
      let value = tokenMatch[1].trim();
      value = value.replace(/^["']|["']$/g, '');

      if (value === '' || value === 'keyring') {
        return { token: null, mode: 'keychain' };
      }

      if (!value.startsWith(GHO_PREFIX)) {
        return { token: null, mode: 'unknown' };
      }

      return { token: value, mode: 'plaintext' };
    }

    if (/^\s+user:/.test(line)) {
      hasUserInBlock = true;
    }
  }

  if (blockEntered && hasUserInBlock) {
    return { token: null, mode: 'keychain' };
  }

  return { token: null, mode: 'unknown' };
}

export async function readGhAuthTokenViaSpawn(hostname = 'github.com') {
  let proc;
  try {
    proc = Bun.spawn(['gh', 'auth', 'token', '--hostname', hostname], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    const isMissing = err?.code === 'ENOENT';
    logJson(console.error, 'gh_auth_token_spawn_failed', {
      reason: isMissing ? 'binary_not_found' : 'error',
      errorMessage: String(err?.message ?? err),
    });
    return null;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), SPAWN_TIMEOUT_MS);
  });

  try {
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);
    clearTimeout(timer);

    if (exitCode !== 0) {
      logJson(console.error, 'gh_auth_token_nonzero', { exitCode, hostname });
      return null;
    }

    const stdout = await new Response(proc.stdout).text();
    const token = stdout.trim();

    if (!token.startsWith(GHO_PREFIX)) {
      logJson(console.error, 'gh_auth_token_invalid_prefix', {
        prefix: token.slice(0, 4),
      });
      return null;
    }

    return token;
  } catch (err) {
    clearTimeout(timer);
    try {
      proc.kill();
    } catch {}

    const isTimeout = err?.message === 'timeout';
    logJson(console.error, 'gh_auth_token_spawn_failed', {
      reason: isTimeout ? 'timeout' : 'error',
      errorMessage: String(err?.message ?? err),
    });
    return null;
  }
}

async function readFromHostsYml() {
  const hostsYmlPath = join(process.env.HOME ?? homedir(), '.config', 'gh', 'hosts.yml');
  let text;
  try {
    text = await Bun.file(hostsYmlPath).text();
  } catch {
    return null;
  }

  const { token, mode } = parseGhHostsYaml(text);

  if (mode === 'keychain') {
    logJson(console.error, 'gh_keychain_mode_no_binary', {
      hint: 'gh CLI in keychain mode but `gh auth token` failed — likely missing gh binary or non-interactive shell. See README for headless-mode workarounds.',
    });
    return null;
  }

  if (token) {
    return { token, source: 'gh-cli-file' };
  }
  return null;
}

async function readFromPatFile() {
  const patPath = join(process.env.HOME ?? homedir(), '.config', 'ai-gauge', 'copilot-token');
  let text;
  try {
    text = await Bun.file(patPath).text();
  } catch {
    return null;
  }

  const token = text.trim();
  if (token === '') return null;

  if (token.startsWith(GHP_PREFIX) || token.startsWith(GITHUB_PAT_PREFIX)) {
    logJson(console.error, 'copilot_classic_pat_rejected', {
      hint: 'classic PAT detected — Copilot internal API requires gho_* OAuth token. See README PAT fallback section.',
      prefix: token.slice(0, 4),
    });
    return null;
  }

  if (!token.startsWith(GHO_PREFIX)) {
    logJson(console.error, 'copilot_pat_invalid_prefix', {
      hint: 'copilot-token file must contain a gho_* OAuth token',
      prefix: token.slice(0, 4),
    });
    return null;
  }

  return { token, source: 'pat' };
}

export async function readCopilotCredentials() {
  const spawnToken = await readGhAuthTokenViaSpawn();
  if (spawnToken) {
    return { token: spawnToken, source: 'gh-cli-spawn' };
  }

  const fileResult = await readFromHostsYml();
  if (fileResult) {
    return fileResult;
  }

  const patResult = await readFromPatFile();
  if (patResult) {
    return patResult;
  }

  return null;
}

export default readCopilotCredentials;
