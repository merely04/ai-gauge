/**
 * SSRF guard for provider base URL validation.
 * Validates that a URL is safe to fetch from (HTTPS, not private IP, etc.)
 */

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc[0-9a-f][0-9a-f]:/i,
  /^fe[89ab][0-9a-f]:/i,
];

const BLOCKED_HOSTNAMES = new Set(['localhost', 'broadcasthost']);

/**
 * Validates a provider URL is safe to fetch.
 * @param {string} urlString - The URL to validate
 * @returns {{ allowed: boolean, reason?: string, parsed?: URL }}
 */
export function validateProviderUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { allowed: false, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: `protocol must be https, got ${parsed.protocol}` };
  }

  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'URL must not contain credentials' };
  }

  if (parsed.hash) {
    return { allowed: false, reason: 'URL must not contain fragment' };
  }

  const hostname = parsed.hostname;
  const lowerHostname = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lowerHostname)) {
    return { allowed: false, reason: `blocked hostname: ${hostname}` };
  }

  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(lowerHostname)) {
      return { allowed: false, reason: `blocked private/reserved IP: ${hostname}` };
    }
  }

  const plainIpv6 = lowerHostname.replace(/^\[|\]$/g, '');
  if (plainIpv6 !== lowerHostname) {
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(plainIpv6)) {
        return { allowed: false, reason: `blocked private/reserved IPv6: ${hostname}` };
      }
    }
  }

  return { allowed: true, parsed };
}

/**
 * Checks if a hostname belongs to a known provider.
 * @param {string} hostname
 * @returns {string | null} provider name or null
 */
export function isKnownProviderHost(hostname) {
  const h = hostname.toLowerCase();

  if (h === 'z.ai' || h.endsWith('.z.ai')) return 'zai';

  if (h === 'api.minimax.io' || h.endsWith('.minimax.io') || h === 'minimax.io') return 'minimax';
  if (h === 'chat.minimax.chat' || h.endsWith('.minimax.chat') || h === 'minimax.chat') return 'minimax';

  if (h === 'openrouter.ai' || h.endsWith('.openrouter.ai')) return 'openrouter';

  if (h === 'komilion.com' || h === 'www.komilion.com') return 'komilion';

  if (h === 'packyapi.com' || h.endsWith('.packyapi.com')) return 'packy';

  return null;
}
