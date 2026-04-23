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
  } catch {
    console.error('no claude-code credentials');
    return null;
  }
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
      };
    } catch {
      continue;
    }
  }

  console.error('no opencode credentials');
  return null;
}
