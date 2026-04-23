/**
 * Provider registry — central dispatch for provider adapters.
 *
 * ProviderAdapter interface:
 * {
 *   name: string,
 *   kind: "oauth" | "api-key" | "credit-balance" | "stub",
 *   buildRequest(creds, options) → { url, method, headers }
 *   parseResponse(rawJson, responseStatus) → { rateLimits?, balance?, error? }
 * }
 */

import { isKnownProviderHost } from '../ssrf-guard.js';

const REGISTRY = new Map();
const ANTHROPIC_HOST = 'api.anthropic.com';

export const PROVIDER_NAMES = ['anthropic', 'zai', 'minimax', 'openrouter', 'komilion', 'packy', 'unknown'];

/**
 * Register a provider adapter.
 * @param {{ name: string }} adapter
 */
export function registerProvider(adapter) {
  if (!adapter || typeof adapter !== 'object' || typeof adapter.name !== 'string' || !adapter.name) {
    throw new Error('Invalid provider adapter');
  }

  if (REGISTRY.has(adapter.name)) {
    throw new Error(`Provider already registered: ${adapter.name}`);
  }

  REGISTRY.set(adapter.name, adapter);
}

/**
 * Get a provider adapter by name.
 * @param {string} name
 * @returns {object}
 */
export function getProvider(name) {
  if (!REGISTRY.has(name)) {
    throw new Error(`Unknown provider: ${name}`);
  }

  return REGISTRY.get(name);
}

/**
 * Detect which provider to use based on a base URL.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function detectProviderByBaseUrl(url) {
  if (!url) return 'anthropic';

  try {
    const { hostname } = new URL(url);
    if (hostname === ANTHROPIC_HOST) return 'anthropic';
    return isKnownProviderHost(hostname) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
