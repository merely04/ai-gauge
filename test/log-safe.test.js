import { describe, it, expect } from 'bun:test';
import { redact, redactString, sanitizeError, logJson } from '../lib/log-safe.js';

describe('redactString', () => {
  it('masks Bearer token', () => {
    const s = 'Authorization: Bearer sk-ant-api03-abc123XYZ_def456GHI-validtoken';
    expect(redactString(s)).toContain('Bearer ***');
    expect(redactString(s)).not.toContain('sk-ant');
  });

  it('masks sk-* key', () => {
    const s = 'key=sk-ant-api03-abcdefghijklmnopqrstu';
    expect(redactString(s)).toContain('sk-***');
    expect(redactString(s)).not.toContain('sk-ant-api03');
  });

  it('masks JWT', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.somesignaturehere1234567890';
    expect(redactString(jwt)).toContain('eyJ-JWT-***');
    expect(redactString(jwt)).not.toContain('eyJhbGci');
  });

  it('passes non-sensitive strings through', () => {
    expect(redactString('hello world')).toBe('hello world');
  });

  it('handles non-string input', () => {
    expect(redactString(null)).toBeNull();
  });
});

describe('redact', () => {
  it('masks token field', () => {
    expect(redact({ token: 'secret' }).token).toBe('***');
  });

  it('masks password field', () => {
    expect(redact({ password: 'pass123' }).password).toBe('***');
  });

  it('masks authKey field', () => {
    expect(redact({ authKey: 'abcdef' }).authKey).toBe('***');
  });

  it('passes through non-sensitive fields', () => {
    const result = redact({ provider: 'zai', url: 'https://api.z.ai' });
    expect(result.provider).toBe('zai');
    expect(result.url).toBe('https://api.z.ai');
  });

  it('handles nested objects', () => {
    const result = redact({ meta: { token: 'secret', plan: 'pro' } });
    expect(result.meta.token).toBe('***');
    expect(result.meta.plan).toBe('pro');
  });

  it('handles arrays', () => {
    const result = redact([{ token: 'a' }, { name: 'b' }]);
    expect(result[0].token).toBe('***');
    expect(result[1].name).toBe('b');
  });

  it('handles circular references without crashing', () => {
    const o = { token: 'SECRET', name: 'test' };
    o.self = o;
    expect(() => redact(o)).not.toThrow();
    const r = redact(o);
    expect(r.token).toBe('***');
    expect(r.self).toBe('[Circular]');
  });
});

describe('sanitizeError', () => {
  it('redacts token from error message', () => {
    const err = new Error('Bearer sk-ant-api03-abcdefghijklmnopqrstu not valid');
    const result = sanitizeError(err);
    expect(result.message).not.toContain('sk-ant-api03');
    expect(result.name).toBe('Error');
  });

  it('includes error code if present', () => {
    const err = Object.assign(new Error('test'), { code: 'ECONNREFUSED' });
    expect(sanitizeError(err).code).toBe('ECONNREFUSED');
  });

  it('handles non-Error throw', () => {
    const result = sanitizeError('some string error');
    expect(result.name).toBe('UnknownError');
  });
});

describe('logJson', () => {
  it('logs structured JSON with event field', () => {
    let logged;
    logJson((s) => { logged = s; }, 'test_event', { provider: 'zai' });
    const parsed = JSON.parse(logged);
    expect(parsed.event).toBe('test_event');
    expect(parsed.provider).toBe('zai');
    expect(typeof parsed.ts).toBe('string');
  });

  it('redacts sensitive fields in logJson', () => {
    let logged;
    logJson((s) => { logged = s; }, 'creds_loaded', { token: 'SECRET_TOKEN' });
    const parsed = JSON.parse(logged);
    expect(parsed.token).toBe('***');
  });
});
