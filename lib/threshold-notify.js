const THRESHOLDS = [95, 80];
const RESET_BELOW = 50;

function defaultExtractor(data) {
  if (!data?.five_hour) return null;
  return {
    utilization: data.five_hour.utilization,
    resets_at: data.five_hour.resets_at,
    daysResetAt: data?.seven_day?.resets_at,
  };
}

export function createThresholdNotifier({
  broadcast,
  systemNotify,
  formatDuration,
  formatDaysRemaining,
  extractor = defaultExtractor,
  messagePrefix = '5-hour limit',
}) {
  const triggered = new Set();

  async function check(cachedData) {
    const usage = extractor(cachedData);
    if (!usage) return;
    const fiveInt = Math.round(Number(usage.utilization) || 0);

    if (fiveInt < RESET_BELOW) {
      triggered.clear();
      return;
    }

    for (const threshold of THRESHOLDS) {
      if (fiveInt >= threshold && !triggered.has(threshold)) {
        triggered.add(threshold);
        await fire(threshold, fiveInt, usage);
      }
    }
  }

  async function fire(threshold, fiveInt, usage) {
    if (threshold === 80) {
      const remaining = formatDuration(usage.resets_at);
      await systemNotify({
        title: 'AI Gauge',
        message: `${messagePrefix} at ${fiveInt}%\nResets in ${remaining}`,
        urgency: 'critical',
      });
    }

    const daysRemaining = formatDaysRemaining(usage.daysResetAt);
    broadcast({
      type: 'notify',
      threshold,
      percentage: fiveInt,
      message: `Usage at ${threshold}%, ~${daysRemaining} days remaining`,
    });
  }

  return { check };
}
