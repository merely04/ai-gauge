/**
 * Secret masking utilities for safe logging.
 * Prevents credential leakage in structured and text logs.
 */

// Regexes for string redaction
const BEARER_RE = /Bearer\s+[\w._~+/=-]{10,}/g;
const SK_ANT_RE = /sk-[a-zA-Z0-9_-]{20,}/g;
const JWT_RE = /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// Field name patterns for object redaction
const SENSITIVE_FIELD_RE = /token|password|credential|secret|auth|key/i;
const NON_SECRET_FIELDS = new Set(['tokenSource', 'source', 'provider', 'name']);

/**
 * Deep-clone an object, masking sensitive field values.
 * Handles circular references safely.
 * @param {*} obj
 * @returns {*}
 */
export function redact(obj) {
  const seen = new WeakSet();

  function _redact(val) {
    if (val === null || typeof val !== 'object') return val;
    if (seen.has(val)) return '[Circular]';
    seen.add(val);

    if (Array.isArray(val)) return val.map(_redact);

    const result = {};
    for (const [k, v] of Object.entries(val)) {
      if (NON_SECRET_FIELDS.has(k)) {
        result[k] = _redact(v);
      } else if (SENSITIVE_FIELD_RE.test(k)) {
        result[k] = '***';
      } else {
        result[k] = _redact(v);
      }
    }
    return result;
  }

  return _redact(obj);
}

/**
 * Mask secrets in a string.
 * @param {string} str
 * @returns {string}
 */
export function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(JWT_RE, 'eyJ-JWT-***')
    .replace(BEARER_RE, 'Bearer ***')
    .replace(SK_ANT_RE, 'sk-***');
}

/**
 * Sanitize an Error object for safe logging.
 * @param {Error | unknown} err
 * @returns {{ name: string, message: string, code?: string }}
 */
export function sanitizeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message),
      ...(err.code ? { code: err.code } : {}),
    };
  }
  return { name: 'UnknownError', message: redactString(String(err)) };
}

/**
 * Log a structured JSON event, with all field values redacted.
 * @param {Function} logger - logging function (e.g., console.error)
 * @param {string} event - event name
 * @param {object} fields - extra fields to include
 */
export function logJson(logger, event, fields = {}) {
  logger(JSON.stringify({ ts: new Date().toISOString(), event, ...redact(fields) }));
}
