import { registerProvider } from './index.js';
import { httpError } from './_shared.js';

const openrouterAdapter = {
  name: 'openrouter',
  kind: 'credit-balance',

  /**
   * Build request for OpenRouter API.
   * @param {{ token: string }} creds
   * @param {{ baseUrl?: string }} [options]
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
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

  /**
   * Parse response from OpenRouter API.
   * @param {object | null} json
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: object | null, error?: object }}
   */
  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return httpError(responseStatus);
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
