import { registerProvider } from './index.js';
import { httpError } from './_shared.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_CLAUDE_VERSION = '2.1.100';

const anthropicAdapter = {
  name: 'anthropic',
  kind: 'oauth',

  /**
   * Build request for Anthropic OAuth usage API.
   * @param {{ token: string, claudeVersion?: string }} creds
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
  buildRequest(creds) {
    if (!creds?.token) {
      throw new Error('anthropic: missing token');
    }

    return {
      url: ANTHROPIC_URL,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': `claude-code/${creds.claudeVersion || DEFAULT_CLAUDE_VERSION}`,
      },
    };
  },

  /**
   * Parse response from Anthropic OAuth usage API.
   * @param {object | null} json
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: null, error?: object }}
   */
  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return httpError(responseStatus);
    }

    if (!json) {
      return {
        rateLimits: null,
        balance: null,
        error: { reason: 'empty-response' },
      };
    }

    const {
      five_hour,
      seven_day,
      seven_day_sonnet,
      seven_day_opus,
      extra_usage,
      seven_day_oauth_apps,
      seven_day_cowork,
      seven_day_omelette,
    } = json;

    return {
      rateLimits: {
        five_hour,
        seven_day,
        seven_day_sonnet,
        seven_day_opus,
        extra_usage,
        seven_day_oauth_apps,
        seven_day_cowork,
        seven_day_omelette,
      },
      balance: null,
    };
  },
};

registerProvider(anthropicAdapter);

export { anthropicAdapter as anthropic };
export default anthropicAdapter;
