/**
 * Shared helpers for provider adapters.
 */

/**
 * Generate HTTP error response object for non-200 status codes.
 * @param {number} status - HTTP status code
 * @returns {{ rateLimits: null, balance: null, error: { status: number, reason: string } }}
 */
export function httpError(status) {
  return { rateLimits: null, balance: null, error: { status, reason: 'http' } };
}
