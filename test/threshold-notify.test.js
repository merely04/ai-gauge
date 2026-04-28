import { describe, it, expect, mock } from 'bun:test';
import { createThresholdNotifier } from '../lib/threshold-notify.js';

function createDeps() {
  return {
    broadcast: mock(() => {}),
    systemNotify: mock(async () => {}),
    formatDuration: mock(() => '2h00m'),
    formatDaysRemaining: mock(() => '3'),
  };
}

describe('createThresholdNotifier', () => {
  it('default extractor preserves existing five_hour behavior', async () => {
    const deps = createDeps();
    const notifier = createThresholdNotifier(deps);

    await notifier.check({
      five_hour: { utilization: 82, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { resets_at: '2099-01-04T00:00:00Z' },
    });

    expect(deps.systemNotify).toHaveBeenCalledTimes(1);
    expect(deps.systemNotify.mock.calls[0][0]).toEqual({
      title: 'AI Gauge',
      message: '5-hour limit at 82%\nResets in 2h00m',
      urgency: 'critical',
    });
    expect(deps.broadcast).toHaveBeenCalledTimes(1);
    expect(deps.broadcast.mock.calls[0][0]).toEqual({
      type: 'notify',
      threshold: 80,
      percentage: 82,
      message: '5-hour limit at 80%, ~3 days remaining',
    });
  });

  it('custom copilot extractor fires at 80%', async () => {
    const deps = createDeps();
    const notifier = createThresholdNotifier({
      ...deps,
      extractor: (data) => {
        const pi = data?.copilot?.premium_interactions;
        if (!pi) return null;
        return {
          utilization: pi.utilization,
          resets_at: pi.resets_at,
          daysResetAt: pi.resets_at,
        };
      },
      messagePrefix: 'Copilot premium',
    });

    await notifier.check({
      copilot: {
        premium_interactions: { utilization: 80, resets_at: '2099-01-01T00:00:00Z' },
      },
    });

    expect(deps.systemNotify).toHaveBeenCalledTimes(1);
    expect(deps.systemNotify.mock.calls[0][0].message).toBe('Copilot premium at 80%\nResets in 2h00m');
    expect(deps.broadcast).toHaveBeenCalledTimes(1);
    expect(deps.broadcast.mock.calls[0][0].threshold).toBe(80);
    expect(deps.broadcast.mock.calls[0][0].message).toContain('Copilot premium');
  });

  it('reset below 50 clears triggered state', async () => {
    const deps = createDeps();
    const notifier = createThresholdNotifier(deps);

    await notifier.check({
      five_hour: { utilization: 80, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { resets_at: '2099-01-04T00:00:00Z' },
    });
    await notifier.check({
      five_hour: { utilization: 49, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { resets_at: '2099-01-04T00:00:00Z' },
    });
    await notifier.check({
      five_hour: { utilization: 81, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { resets_at: '2099-01-04T00:00:00Z' },
    });

    expect(deps.systemNotify).toHaveBeenCalledTimes(2);
    expect(deps.broadcast).toHaveBeenCalledTimes(2);
  });

  it('two notifier instances keep independent state', async () => {
    const primaryDeps = createDeps();
    const copilotDeps = createDeps();
    const primary = createThresholdNotifier(primaryDeps);
    const copilot = createThresholdNotifier({
      ...copilotDeps,
      extractor: (data) => {
        const pi = data?.copilot?.premium_interactions;
        if (!pi) return null;
        return {
          utilization: pi.utilization,
          resets_at: pi.resets_at,
          daysResetAt: pi.resets_at,
        };
      },
      messagePrefix: 'Copilot premium',
    });

    const payload = {
      five_hour: { utilization: 81, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { resets_at: '2099-01-04T00:00:00Z' },
      copilot: {
        premium_interactions: { utilization: 81, resets_at: '2099-01-02T00:00:00Z' },
      },
    };

    await primary.check(payload);
    await copilot.check(payload);
    await primary.check(payload);
    await copilot.check(payload);

    expect(primaryDeps.systemNotify).toHaveBeenCalledTimes(1);
    expect(copilotDeps.systemNotify).toHaveBeenCalledTimes(1);
    expect(primaryDeps.systemNotify.mock.calls[0][0].message).toContain('5-hour limit');
    expect(copilotDeps.systemNotify.mock.calls[0][0].message).toContain('Copilot premium');
  });
});
