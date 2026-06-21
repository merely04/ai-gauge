import { homedir } from 'node:os';
import { join } from 'node:path';
import { isTokenValid } from './credentials.js';

const PI_AUTH_FILE = join(homedir(), '.pi', 'agent', 'auth.json');
const PI_SETTINGS_FILE = join(homedir(), '.pi', 'agent', 'settings.json');

// Rate/balance providers, in fixed selection priority. Copilot is intentionally
// excluded — it is only ever a secondary slot (or the primary of last resort
// when no rate/balance block is usable).
const RATE_BALANCE_PRIORITY = ['anthropic', 'codex', 'zai', 'openrouter'];

const ZAI_BASE_URL = 'https://api.z.ai';

function piKeyToProvider(key) {
  if (key === 'openai-codex') return 'codex';
  if (key === 'github-copilot') return 'copilot';
  return key;
}

// Usability predicate — must stay identical to lib/detect-token-source.js:
//   oauth  → non-empty `access` AND (`expires` absent/null OR isTokenValid(expires))
//   api_key→ non-empty `key`
function oauthUsable(raw) {
  if (typeof raw?.access !== 'string' || raw.access === '') return false;
  const expires = raw.expires;
  if (expires === undefined || expires === null) return true;
  return isTokenValid(expires);
}

function apiKeyUsable(raw) {
  return typeof raw?.key === 'string' && raw.key !== '';
}

function extractAnthropic(raw) {
  if (raw?.type !== 'oauth' || !oauthUsable(raw)) return null;
  return {
    provider: 'anthropic',
    token: raw.access,
    expiresAt: raw.expires ?? null,
    baseUrl: null,
  };
}

function extractCodex(raw) {
  if (raw?.type !== 'oauth' || !oauthUsable(raw)) return null;
  return {
    provider: 'codex',
    token: raw.access,
    account_id: raw.accountId,
    expiresAt: raw.expires ?? Infinity,
    baseUrl: null,
  };
}

function extractZai(raw) {
  if (raw?.type !== 'api_key' || !apiKeyUsable(raw)) return null;
  return {
    provider: 'zai',
    token: raw.key,
    expiresAt: null,
    baseUrl: ZAI_BASE_URL,
  };
}

function extractOpenrouter(raw) {
  if (raw?.type !== 'api_key' || !apiKeyUsable(raw)) return null;
  return {
    provider: 'openrouter',
    token: raw.key,
    expiresAt: null,
    baseUrl: null,
  };
}

function extractCopilot(raw) {
  if (raw?.type !== 'oauth') return null;
  // Enterprise Copilot has no public quota endpoint — skip it everywhere.
  if (typeof raw.enterpriseUrl === 'string' && raw.enterpriseUrl !== '') return null;
  if (!oauthUsable(raw)) return null;
  return {
    provider: 'copilot',
    token: raw.access,
    expiresAt: raw.expires ?? null,
  };
}

function buildSecondary(block) {
  const out = {
    provider: block.provider,
    token: block.token,
    expiresAt: block.expiresAt,
  };
  if (block.provider === 'codex') out.account_id = block.account_id;
  if (block.provider === 'zai') out.baseUrl = ZAI_BASE_URL;
  return out;
}

async function readDefaultProvider(settingsPath) {
  try {
    const settings = await Bun.file(settingsPath).json();
    const dp = settings?.defaultProvider;
    return typeof dp === 'string' && dp !== '' ? dp : null;
  } catch {
    // Missing or malformed settings.json → no default; priority fallback applies.
    return null;
  }
}

export async function readPiCredentials(authPath = PI_AUTH_FILE, settingsPath = PI_SETTINGS_FILE) {
  let auth;
  try {
    auth = await Bun.file(authPath).json();
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`pi auth: failed to read ${authPath}: ${err?.code ?? err?.message ?? 'unknown'}`);
    }
    return null;
  }

  if (!auth || typeof auth !== 'object') return null;

  const blocks = {};
  const anthropic = extractAnthropic(auth.anthropic);
  if (anthropic) blocks.anthropic = anthropic;
  const codex = extractCodex(auth['openai-codex']);
  if (codex) blocks.codex = codex;
  const zai = extractZai(auth.zai);
  if (zai) blocks.zai = zai;
  const openrouter = extractOpenrouter(auth.openrouter);
  if (openrouter) blocks.openrouter = openrouter;

  const copilot = extractCopilot(auth['github-copilot']);

  const rateBalanceOrder = RATE_BALANCE_PRIORITY.filter((name) => blocks[name]);

  // PRIMARY selection (hybrid): defaultProvider override → priority fallback →
  // copilot-of-last-resort. Copilot is NEVER primary while any rate/balance
  // block is usable.
  const defaultProvider = await readDefaultProvider(settingsPath);
  const normalizedDefault = defaultProvider ? piKeyToProvider(defaultProvider) : null;

  let primary;
  if (normalizedDefault && RATE_BALANCE_PRIORITY.includes(normalizedDefault) && blocks[normalizedDefault]) {
    primary = blocks[normalizedDefault];
  } else if (rateBalanceOrder.length > 0) {
    primary = blocks[rateBalanceOrder[0]];
  } else if (copilot) {
    primary = copilot;
  } else {
    console.error('no pi credentials');
    return null;
  }

  let secondary = null;
  for (const name of RATE_BALANCE_PRIORITY) {
    const block = blocks[name];
    if (!block || block === primary) continue;
    secondary = buildSecondary(block);
    break;
  }

  let copilotSecondary = null;
  if (copilot && copilot !== primary) {
    copilotSecondary = {
      provider: 'copilot',
      token: copilot.token,
      expiresAt: copilot.expiresAt,
    };
  }

  const bundle = {
    token: primary.token,
    expiresAt: primary.expiresAt,
    subscriptionType: 'unknown',
    provider: primary.provider,
    baseUrl: primary.baseUrl ?? null,
    secondary,
    copilotSecondary,
  };

  if (primary.provider === 'codex') {
    bundle.account_id = primary.account_id;
  }

  return bundle;
}

export default readPiCredentials;
