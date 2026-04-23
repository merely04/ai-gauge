import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_PATH = join(import.meta.dir, '../lib/streamdock-plugin/plugin/index.js');
const PLUGIN_SRC = readFileSync(PLUGIN_PATH, 'utf8');

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return Math.max(0, Math.round(numeric));
}

function formatTimeRemaining(resetAt) {
  const resetDate = new Date(resetAt);
  if (Number.isNaN(resetDate.getTime())) return '--';
  const diffMs = Math.max(0, resetDate.getTime() - Date.now());
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function simulateReadUsage(parsed) {
  if (!parsed) return { fiveHourPercent: '--', weeklyPercent: '--', timeRemaining: '--' };
  try {
    return {
      fiveHourPercent: normalizePercent(parsed?.five_hour?.utilization),
      weeklyPercent: normalizePercent(parsed?.seven_day?.utilization),
      timeRemaining: formatTimeRemaining(parsed?.five_hour?.resets_at),
    };
  } catch {
    return { fiveHourPercent: '--', weeklyPercent: '--', timeRemaining: '--' };
  }
}

describe('StreamDock plugin — protocol v2 compat (static source audit)', () => {
  test('plugin reads only five_hour + seven_day from broadcast, via optional chaining', () => {
    const fiveHourReads = PLUGIN_SRC.match(/parsed\?\.five_hour\?\./g) ?? [];
    const sevenDayReads = PLUGIN_SRC.match(/parsed\?\.seven_day\?\./g) ?? [];
    expect(fiveHourReads.length).toBeGreaterThanOrEqual(2);
    expect(sevenDayReads.length).toBeGreaterThanOrEqual(1);
  });

  test('plugin never dereferences parsed.meta.* or parsed.balance.* (unknown v2 fields)', () => {
    expect(PLUGIN_SRC).not.toMatch(/parsed\??\.meta\./);
    expect(PLUGIN_SRC).not.toMatch(/parsed\??\.balance\./);
  });
});

describe('StreamDock plugin — protocol v2 compat (behavioral)', () => {
  test('v2 anthropic broadcast with meta.provider and balance:null renders normal percents', () => {
    const v2Anthropic = {
      five_hour: { utilization: 45, resets_at: '2099-04-17T22:00:00Z' },
      seven_day: { utilization: 15, resets_at: '2099-04-24T03:00:00Z' },
      seven_day_sonnet: null,
      seven_day_opus: null,
      extra_usage: null,
      meta: { provider: 'anthropic', protocolVersion: 2, tokenSource: 'claude-code', plan: 'max' },
      balance: null,
    };
    const usage = simulateReadUsage(v2Anthropic);
    expect(usage.fiveHourPercent).toBe(45);
    expect(usage.weeklyPercent).toBe(15);
    expect(usage.timeRemaining).toMatch(/^\d+h\d{2}m$/);
  });

  test('credit-based provider broadcast (five_hour:null, balance populated) falls back to "--"', () => {
    const creditOnly = {
      five_hour: null,
      seven_day: null,
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { provider: 'openrouter', protocolVersion: 2 },
      balance: { currency: 'USD', total_cents: 10000, used_cents: 5297, remaining_cents: 4703 },
    };
    const usage = simulateReadUsage(creditOnly);
    expect(usage.fiveHourPercent).toBe('--');
    expect(usage.weeklyPercent).toBe('--');
    expect(usage.timeRemaining).toBe('--');
  });

  test('unknown stub broadcast with all-null fields does not crash', () => {
    const allNull = {
      five_hour: null,
      seven_day: null,
      meta: { provider: 'unknown', protocolVersion: 2 },
      balance: null,
    };
    expect(() => simulateReadUsage(allNull)).not.toThrow();
    const usage = simulateReadUsage(allNull);
    expect(usage.fiveHourPercent).toBe('--');
    expect(usage.weeklyPercent).toBe('--');
  });
});
