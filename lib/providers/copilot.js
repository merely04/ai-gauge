import { registerProvider } from './index.js';
import { httpError } from './_shared.js';

const COPILOT_V2_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// FRAGILE: hardcoded VS Code Copilot ext headers. Mirror lib/providers/codex.js pattern.
// Update procedure when GitHub deprecates these en masse: bump VS Code Marketplace version
// (https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) and replace literals here.
// No automated detection — manual upkeep on regression.
const COPILOT_HEADERS = {
  'User-Agent': 'GithubCopilot/1.270.0',
  'Editor-Version': 'vscode/1.96.0',
  'Editor-Plugin-Version': 'copilot/1.270.0',
  'Copilot-Integration-Id': 'vscode-chat',
  Accept: 'application/json',
};

function inferPlan(limit) {
  if (limit === 50) return 'free';
  if (limit === 300) return 'pro';
  if (limit === 1500) return 'pro-plus';
  return 'unknown';
}

const copilotAdapter = {
  name: 'copilot',
  kind: 'oauth',

  buildRequest(creds) {
    if (!creds?.token) {
      throw new Error('copilot: missing token');
    }

    return {
      url: COPILOT_V2_TOKEN_URL,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        ...COPILOT_HEADERS,
      },
    };
  },

  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return {
        ...httpError(responseStatus),
        copilot: null,
      };
    }

    const pi = json?.limited_user_quotas?.copilot_premium_interaction;
    if (!pi) {
      return {
        rateLimits: null,
        balance: null,
        copilot: null,
        error: { reason: 'no-copilot-subscription' },
      };
    }

    const used = pi.storage ?? 0;
    const limit = pi.limit ?? 0;
    const utilization = limit > 0 ? Math.min((used / limit) * 100, 200) : 0;
    const overageCount = pi.overage_count ?? json?.overage_count ?? 0;
    const overagePermitted = !!(pi.overage_permitted ?? json?.overage_permitted ?? false);

    return {
      rateLimits: null,
      balance: null,
      copilot: {
        plan: inferPlan(limit),
        premium_interactions: {
          utilization,
          used,
          limit,
          resets_at: pi.reset_date ?? null,
          overage_count: overageCount,
          overage_permitted: overagePermitted,
        },
      },
    };
  },
};

registerProvider(copilotAdapter);

export { copilotAdapter as copilot };
export default copilotAdapter;
