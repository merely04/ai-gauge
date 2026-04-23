import { registerProvider } from './index.js';

const openrouterAdapter = {
  name: 'openrouter',
  kind: 'credit-balance',

  buildRequest(creds) {
    if (!creds?.token) throw new Error('openrouter: missing token');

    return {
      url: 'https://openrouter.ai/api/v1/key',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
    };
  },

  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return { rateLimits: null, balance: null, error: { status: responseStatus, reason: 'http' } };
    }

    const data = json?.data ?? json ?? {};
    const limit = data.limit ?? null;
    const usage = data.usage ?? 0;
    const limitRemaining = data.limit_remaining ?? null;
    const usageDaily = data.usage_daily ?? null;

    return {
      rateLimits: null,
      balance: {
        currency: 'USD',
        total_cents: limit !== null ? Math.round(limit * 100) : null,
        used_cents: Math.round(usage * 100),
        remaining_cents: limitRemaining !== null ? Math.round(limitRemaining * 100) : null,
        usage_daily_cents: usageDaily !== null ? Math.round(usageDaily * 100) : null,
        percentage: limit != null && limit > 0 ? (usage / limit) * 100 : null,
      },
    };
  },
};

registerProvider(openrouterAdapter);
export default openrouterAdapter;
