import { describe, test, expect } from 'bun:test';
import { render } from '../lib/render-waybar.js';

const FIXED_NOW = Date.parse('2026-04-20T02:00:00.000Z');
const FIVE_HOUR_RESET = '2026-04-20T04:31:00.000000+00:00';
const SEVEN_DAY_RESET = '2026-04-26T19:54:00.000000+00:00';

describe('waybar render: protocol v2 backward compatibility', () => {
  test('Case 1 — v1 legacy without meta.provider/balance renders as pre-change', () => {
    const data = {
      five_hour: { utilization: 45, resets_at: FIVE_HOUR_RESET },
      seven_day: { utilization: 15, resets_at: SEVEN_DAY_RESET },
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { plan: 'max', displayMode: 'full' },
    };

    const out = render(data, {}, FIXED_NOW);

    expect(out.text).toContain('45%');
    expect(out.text).toContain('15%w');
    expect(out.text).toBe('✦ 45% 2h31m · 15%w');
    expect(out.class).toBe('normal');
    expect(out.tooltip).not.toContain('Provider:');
    expect(out.tooltip).not.toContain('Balance:');
  });

  test('Case 2 — v2 anthropic is text-identical to Case 1 and tooltip ends with Provider line', () => {
    const legacyData = {
      five_hour: { utilization: 45, resets_at: FIVE_HOUR_RESET },
      seven_day: { utilization: 15, resets_at: SEVEN_DAY_RESET },
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { plan: 'max', displayMode: 'full' },
    };
    const v2Data = {
      ...legacyData,
      meta: { ...legacyData.meta, provider: 'anthropic', protocolVersion: 2 },
      balance: null,
    };

    const legacyOut = render(legacyData, {}, FIXED_NOW);
    const v2Out = render(v2Data, {}, FIXED_NOW);

    expect(v2Out.text).toBe(legacyOut.text);
    expect(v2Out.class).toBe(legacyOut.class);
    expect(v2Out.tooltip.endsWith('\nProvider: anthropic')).toBe(true);
    expect(v2Out.tooltip).not.toContain('Balance:');
  });

  test('Case 3 — z.ai critical utilization reports critical class and provider tooltip', () => {
    const data = {
      five_hour: { utilization: 85, resets_at: FIVE_HOUR_RESET },
      seven_day: { utilization: 60, resets_at: SEVEN_DAY_RESET },
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { plan: 'unknown', provider: 'zai', protocolVersion: 2, displayMode: 'full' },
      balance: null,
    };

    const out = render(data, {}, FIXED_NOW);

    expect(out.text).toContain('85%');
    expect(out.text).toContain('60%w');
    expect(out.class).toBe('critical');
    expect(out.tooltip).toContain('Provider: zai');
  });

  test('Case 4 — OpenRouter balance-only renders as waiting and exposes balance in tooltip', () => {
    const data = {
      five_hour: null,
      seven_day: null,
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { plan: 'unknown', provider: 'openrouter', protocolVersion: 2, displayMode: 'full' },
      balance: { currency: 'USD', total_cents: 10000, used_cents: 5297, remaining_cents: 4703 },
    };

    const out = render(data, {}, FIXED_NOW);

    expect(out.text).toBe('✦ --');
    expect(out.class).toBe('waiting');
    expect(out.tooltip).toContain('Provider: openrouter');
    expect(out.tooltip).toContain('Balance: $52.97 / $100.00');
  });

  test('Case 5 — unknown provider stub with all nulls renders as waiting', () => {
    const data = {
      five_hour: null,
      seven_day: null,
      seven_day_sonnet: null,
      extra_usage: null,
      meta: { plan: 'unknown', provider: 'unknown', protocolVersion: 2, displayMode: 'full' },
      balance: null,
    };

    const out = render(data, {}, FIXED_NOW);

    expect(out.text).toBe('✦ --');
    expect(out.class).toBe('waiting');
    expect(out.tooltip).toContain('Provider: unknown');
    expect(out.tooltip).not.toContain('Balance:');
  });
});
