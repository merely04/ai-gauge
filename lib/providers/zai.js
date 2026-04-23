import { registerProvider } from './index.js';

function toBucket(bucket) {
  if (!bucket) return null;

  return {
    utilization: Math.min(100, Math.max(0, bucket.percentage ?? 0)),
    resets_at: bucket.nextResetTime ? new Date(bucket.nextResetTime).toISOString() : null,
  };
}

const zaiAdapter = {
  name: 'zai',
  kind: 'api-key',

  /**
   * Build request for Z.ai quota API.
   * @param {{ token: string }} creds
   * @param {{ baseUrl?: string }} [options]
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
  buildRequest(creds, { baseUrl } = {}) {
    if (!creds?.token) {
      throw new Error('zai: missing token');
    }

    if (!baseUrl) {
      throw new Error('zai: missing baseUrl');
    }

    const origin = new URL(baseUrl).origin;

    return {
      url: `${origin}/api/monitor/usage/quota/limit`,
      method: 'GET',
      headers: {
        Authorization: creds.token,
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en',
      },
    };
  },

  /**
   * Parse response from Z.ai quota API.
   * @param {object | null} json
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: null, error?: object }}
   */
  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return {
        rateLimits: null,
        balance: null,
        error: { status: responseStatus, reason: 'http' },
      };
    }

    if (!Array.isArray(json?.data?.limits)) {
      return {
        rateLimits: null,
        balance: null,
        error: { reason: 'malformed' },
      };
    }

    const tokenLimits = json.data.limits.filter((limit) => limit?.type === 'TOKENS_LIMIT');
    const timeLimits = json.data.limits.filter((limit) => limit?.type === 'TIME_LIMIT');
    const sortedTokenLimits = [...tokenLimits].sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0));

    const fiveHourBucket = tokenLimits.find((limit) => limit.unit === 3) ?? sortedTokenLimits[0] ?? null;
    let weeklyBucket = tokenLimits.find((limit) => limit.unit === 6) ?? sortedTokenLimits[1] ?? null;

    if (!weeklyBucket && timeLimits[0]) {
      weeklyBucket = timeLimits[0];
    }

    return {
      rateLimits: {
        five_hour: toBucket(fiveHourBucket),
        seven_day: toBucket(weeklyBucket),
        seven_day_sonnet: null,
        seven_day_opus: null,
        extra_usage: null,
      },
      balance: null,
    };
  },
};

registerProvider(zaiAdapter);

export default zaiAdapter;
