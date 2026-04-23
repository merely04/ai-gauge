import { registerProvider } from './index.js';
import { httpError } from './_shared.js';

const komilionAdapter = {
  name: 'komilion',
  kind: 'credit-balance',

  /**
   * Build request for Komilion API.
   * @param {{ token: string }} creds
   * @param {{ baseUrl?: string }} [options]
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
  buildRequest(creds) {
    if (!creds?.token) throw new Error('komilion: missing token');

    return {
      url: 'https://www.komilion.com/api/wallet/balance',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
    };
  },

  /**
   * Parse response from Komilion API.
   * @param {object | null} json
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: object | null, error?: object }}
   */
  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return httpError(responseStatus);
    }

    return {
      rateLimits: null,
      balance: {
        currency: 'USD',
        total_cents: Math.round((json?.total_available ?? 0) * 100),
        used_cents: null,
        remaining_cents: Math.round((json?.wallet_balance ?? 0) * 100),
        usage_daily_cents: null,
        percentage: null,
        extras: {
          trial_credits_cents: Math.round((json?.trial_credits ?? 0) * 100),
          is_low_balance: !!json?.is_low_balance,
        },
      },
    };
  },
};

registerProvider(komilionAdapter);
export default komilionAdapter;
