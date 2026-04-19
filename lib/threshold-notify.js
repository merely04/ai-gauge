const THRESHOLDS = [95, 80];
const RESET_BELOW = 50;

export function createThresholdNotifier({ broadcast, systemNotify, formatDuration, formatDaysRemaining }) {
  const triggered = new Set();

  async function check(cachedData) {
    if (!cachedData?.five_hour) return;
    const fiveInt = Math.round(Number(cachedData.five_hour.utilization) || 0);

    if (fiveInt < RESET_BELOW) {
      triggered.clear();
      return;
    }

    for (const threshold of THRESHOLDS) {
      if (fiveInt >= threshold && !triggered.has(threshold)) {
        triggered.add(threshold);
        await fire(threshold, fiveInt, cachedData);
      }
    }
  }

  async function fire(threshold, fiveInt, cachedData) {
    if (threshold === 80) {
      const remaining = formatDuration(cachedData.five_hour.resets_at);
      await systemNotify({
        title: 'AI Gauge',
        message: `5-hour limit at ${fiveInt}%\nResets in ${remaining}`,
        urgency: 'critical',
      });
    }

    const daysRemaining = formatDaysRemaining(cachedData?.seven_day?.resets_at);
    broadcast({
      type: 'notify',
      threshold,
      percentage: fiveInt,
      message: `Usage at ${threshold}%, ~${daysRemaining} days remaining`,
    });
  }

  return { check };
}
