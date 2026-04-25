export const CREDS_FILE = `${process.env.HOME}/.claude/.credentials.json`;
export const OPENCODE_AUTH_FILE_PRIMARY = `${process.env.HOME}/.local/share/opencode/auth.json`;
export const OPENCODE_AUTH_FILE_MAC = `${process.env.HOME}/Library/Application Support/opencode/auth.json`;

export function isTokenValid(expiresAt) {
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

export async function readClaudeCodeCredentials(credsFile = CREDS_FILE) {
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
    } else {
      console.error('no claude-code credentials');
    }
    return null;
  }
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
