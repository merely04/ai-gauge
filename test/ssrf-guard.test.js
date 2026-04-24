import { describe, it, expect } from 'bun:test';
import { validateProviderUrl, isKnownProviderHost, normalizeIPv4 } from '../lib/ssrf-guard.js';

describe('validateProviderUrl', () => {
  it('allows valid HTTPS public URL', () => {
    expect(validateProviderUrl('https://api.z.ai/api/anthropic').allowed).toBe(true);
  });

  it('allows valid HTTPS with path', () => {
    expect(validateProviderUrl('https://openrouter.ai/api/v1/key').allowed).toBe(true);
  });

  it('rejects http:', () => {
    const r = validateProviderUrl('http://api.z.ai');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/protocol/);
  });

  it('rejects ftp:', () => {
    expect(validateProviderUrl('ftp://api.z.ai').allowed).toBe(false);
  });

  it('rejects 169.254.x.x (AWS metadata)', () => {
    expect(validateProviderUrl('https://169.254.169.254/latest/meta-data/').allowed).toBe(false);
  });

  it('rejects 10.x.x.x', () => {
    expect(validateProviderUrl('https://10.0.0.1').allowed).toBe(false);
  });

  it('rejects 192.168.x.x', () => {
    expect(validateProviderUrl('https://192.168.1.1').allowed).toBe(false);
  });

  it('rejects 172.16-31.x.x', () => {
    expect(validateProviderUrl('https://172.16.0.1').allowed).toBe(false);
  });

  it('rejects 127.0.0.1', () => {
    expect(validateProviderUrl('https://127.0.0.1').allowed).toBe(false);
  });

  it('rejects localhost', () => {
    expect(validateProviderUrl('https://localhost').allowed).toBe(false);
  });

  it('rejects IPv6 loopback ::1', () => {
    expect(validateProviderUrl('https://[::1]/').allowed).toBe(false);
  });

  it('rejects IPv6 link-local fe80', () => {
    expect(validateProviderUrl('https://[fe80::1]/').allowed).toBe(false);
  });

  it('rejects user:pass in URL', () => {
    expect(validateProviderUrl('https://user:pass@api.z.ai').allowed).toBe(false);
  });

  it('rejects fragment', () => {
    expect(validateProviderUrl('https://api.z.ai/path#fragment').allowed).toBe(false);
  });

  it('rejects non-URL string', () => {
    expect(validateProviderUrl('not-a-url').allowed).toBe(false);
  });

  describe('SSRF: IPv4 encoding bypass', () => {
    it('blocks decimal-encoded localhost (2130706433)', () => {
      expect(validateProviderUrl('https://2130706433').allowed).toBe(false);
    });

    it('blocks hex-encoded localhost (0x7f000001)', () => {
      expect(validateProviderUrl('https://0x7f000001').allowed).toBe(false);
    });

    it('blocks octal-encoded localhost (0177.0.0.1)', () => {
      expect(validateProviderUrl('https://0177.0.0.1').allowed).toBe(false);
    });

    it('blocks decimal metadata endpoint', () => {
      expect(validateProviderUrl('https://2852039166').allowed).toBe(false);
    });
  });
});

describe('normalizeIPv4', () => {
  it('normalizes decimal, hex and octal IPv4 forms', () => {
    expect(normalizeIPv4('2130706433')).toBe('127.0.0.1');
    expect(normalizeIPv4('0x7f000001')).toBe('127.0.0.1');
    expect(normalizeIPv4('0177.0.0.1')).toBe('127.0.0.1');
  });
});

describe('isKnownProviderHost', () => {
  it('z.ai → zai', () => {
    expect(isKnownProviderHost('z.ai')).toBe('zai');
  });

  it('api.z.ai → zai (subdomain)', () => {
    expect(isKnownProviderHost('api.z.ai')).toBe('zai');
  });

  it('api.minimax.io → minimax', () => {
    expect(isKnownProviderHost('api.minimax.io')).toBe('minimax');
  });

  it('chat.minimax.chat → minimax', () => {
    expect(isKnownProviderHost('chat.minimax.chat')).toBe('minimax');
  });

  it('openrouter.ai → openrouter', () => {
    expect(isKnownProviderHost('openrouter.ai')).toBe('openrouter');
  });

  it('www.komilion.com → komilion', () => {
    expect(isKnownProviderHost('www.komilion.com')).toBe('komilion');
  });

  it('api.packyapi.com → packy', () => {
    expect(isKnownProviderHost('api.packyapi.com')).toBe('packy');
  });

  it('api.anthropic.com → null', () => {
    expect(isKnownProviderHost('api.anthropic.com')).toBeNull();
  });

  it('attacker.com → null', () => {
    expect(isKnownProviderHost('attacker.com')).toBeNull();
  });

  it('recognizes chatgpt.com as codex', () => {
    expect(isKnownProviderHost('chatgpt.com')).toBe('codex');
    expect(isKnownProviderHost('api.chatgpt.com')).toBe('codex');
  });

  it('allows chatgpt.com via validateProviderUrl', () => {
    expect(validateProviderUrl('https://chatgpt.com/backend-api/wham/usage').allowed).toBe(true);
  });

  it('rejects http://chatgpt.com (HTTP not HTTPS)', () => {
    expect(validateProviderUrl('http://chatgpt.com').allowed).toBe(false);
  });
});
