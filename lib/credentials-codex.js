import { homedir } from 'node:os';
import { join } from 'node:path';
import { logJson } from './log-safe.js';

const VALID_SUBSCRIPTION_TYPES = new Set(['plus', 'pro', 'business', 'enterprise', 'edu']);
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
const MAX_JWT_LENGTH = 16 * 1024;
const MAX_JWT_PAYLOAD_LENGTH = 8 * 1024;

export function parseCodexAccessToken(accessToken) {
  try {
    if (typeof accessToken !== 'string' || accessToken.length > MAX_JWT_LENGTH) {
      throw new Error('jwt_too_large');
    }

    const parts = accessToken.split('.');
    if (parts.length !== 3) throw new Error('invalid_jwt_parts');
    if (parts[1].length > MAX_JWT_PAYLOAD_LENGTH) throw new Error('jwt_payload_too_large');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = typeof payload?.exp === 'number' ? payload.exp : null;

    const claim = payload?.[OPENAI_AUTH_CLAIM];
    const claimPlanType = claim && typeof claim === 'object' && !Array.isArray(claim)
      ? claim.chatgpt_plan_type
      : null;
    const planType = claimPlanType ?? payload?.plan_type ?? 'unknown';

    return {
      exp,
      plan_type: typeof planType === 'string' ? planType : 'unknown',
    };
  } catch {
    return { exp: null, plan_type: 'unknown' };
  }
}

export const parseCodexIdToken = parseCodexAccessToken;

export async function readCodexCredentials() {
  const authPath = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, 'auth.json')
    : join(homedir(), '.codex', 'auth.json');

  try {
    const data = await Bun.file(authPath).json();
    if (!data?.tokens?.access_token || !data?.tokens?.account_id) return null;

    const parsed = parseCodexAccessToken(data.tokens.access_token);
    const subscriptionType = VALID_SUBSCRIPTION_TYPES.has(parsed.plan_type)
      ? parsed.plan_type
      : 'unknown';
    const expiresAt = parsed.exp ? parsed.exp * 1000 : null;

    return {
      token: data.tokens.access_token,
      expiresAt,
      subscriptionType,
      account_id: data.tokens.account_id,
    };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      logJson(console.error, 'codex_keyring_mode_unsupported', {
        hint: 'set cli_auth_credentials_store="file" in ~/.codex/config.toml',
      });
      return null;
    }

    logJson(console.error, 'codex_credentials_read_failed', {
      path: authPath,
      errorCode: err?.code ?? 'unknown',
      errorMessage: err?.message ?? String(err),
    });
    return null;
  }
}
