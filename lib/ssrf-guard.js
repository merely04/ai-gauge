/**
 * SSRF guard for provider base URL validation.
 * Validates that a URL is safe to fetch from (HTTPS, not private IP, etc.)
 */

import { isIP } from 'node:net';

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
 * Normalize IPv4 variants (decimal 2130706433, hex 0x7f000001, octal 0177.0.0.1)
 * to dotted-quad (127.0.0.1). Returns null if not a recognizable IPv4.
 * @param {string} hostname
 * @returns {string | null}
 */
export function normalizeIPv4(hostname) {
  if (isIP(hostname) === 4) return hostname;

  if (/^\d+$/.test(hostname)) {
    const n = parseInt(hostname, 10);
    if (n >= 0 && n <= 0xFFFFFFFF) {
      return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
    }
  }

  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const n = parseInt(hostname, 16);
    if (!Number.isNaN(n) && n >= 0 && n <= 0xFFFFFFFF) {
      return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
    }
  }

  const octets = hostname.split('.');
  if (octets.length === 4) {
    const nums = octets.map((octet) => {
      if (/^0x[0-9a-f]+$/i.test(octet)) return parseInt(octet, 16);
      if (/^0[0-7]+$/.test(octet)) return parseInt(octet, 8);
      if (/^\d+$/.test(octet)) return parseInt(octet, 10);
      return Number.NaN;
    });
    if (nums.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255)) {
      return nums.join('.');
    }
  }

  return null;
}

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

  const normalized = normalizeIPv4(lowerHostname);
  const checkHost = normalized ?? lowerHostname;

  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(checkHost)) {
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
