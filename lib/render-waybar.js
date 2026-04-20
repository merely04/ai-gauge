const DOT_FILLED = '\u25CF';
const DOT_EMPTY = '\u25CB';
const BAR_FILLED = '\u2593';
const BAR_EMPTY = '\u2591';
const TIMER = '\u23F1';
const SPARK = '\u2726';

function barCells(pct) {
  return Math.max(0, Math.min(10, Math.floor(Number(pct) / 10)));
}

function fmtPct(pct) {
  return Math.round(Number(pct) || 0);
}

function getRemainingSeconds(resetsAt, now = Date.now()) {
  if (!resetsAt || resetsAt === 'null') return null;

  const resetMs = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetMs)) return 0;

  return Math.floor((resetMs - now) / 1000);
}

function formatDuration(resetsAt, now = Date.now()) {
  const seconds = getRemainingSeconds(resetsAt, now);
  if (seconds == null) return '';
  if (seconds <= 0) return 'now';

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h${String(mins).padStart(2, '0')}m`;
  }

  return `${mins}m`;
}

function formatDurationLong(resetsAt, now = Date.now()) {
  const seconds = getRemainingSeconds(resetsAt, now);
  if (seconds == null) return '';
  if (seconds <= 0) return 'now';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }

  return `${mins}m`;
}

export function render(data, updateState = {}, now = Date.now()) {
  const fivePct = Number(data?.five_hour?.utilization ?? 0);
  const sevenPct = Number(data?.seven_day?.utilization ?? 0);
  const fiveInt = fmtPct(Number.isFinite(fivePct) ? fivePct : 0);
  const sevenInt = fmtPct(Number.isFinite(sevenPct) ? sevenPct : 0);
  const displayMode = data?.meta?.displayMode ?? 'full';

  const fiveRemaining = formatDuration(data?.five_hour?.resets_at, now);
  const fiveRemainingLong = formatDurationLong(data?.five_hour?.resets_at, now);
  const sevenRemainingLong = formatDurationLong(data?.seven_day?.resets_at, now);

  let cssClass = 'normal';
  if (fiveInt >= 80) {
    cssClass = 'critical';
  } else if (fiveInt >= 50) {
    cssClass = 'warning';
  }

  let text;
  switch (displayMode) {
    case 'percent-only':
      text = `${SPARK} ${fiveInt}%`;
      break;
    case 'bar-dots': {
      const n = barCells(fiveInt);
      text = `${SPARK} ${DOT_FILLED.repeat(n)}${DOT_EMPTY.repeat(10 - n)}`;
      break;
    }
    case 'number-bar': {
      const n = barCells(fiveInt);
      text = `${fiveInt}% ${BAR_FILLED.repeat(n)}${BAR_EMPTY.repeat(10 - n)}`;
      break;
    }
    case 'time-to-reset': {
      const rem = formatDuration(data?.five_hour?.resets_at, now);
      text = rem ? `${TIMER} ${rem}` : `${TIMER} --`;
      break;
    }
    case 'full':
    default: {
      text = `${SPARK} ${fiveInt}%`;
      if (fiveRemaining) text += ` ${fiveRemaining}`;
      text += ` · ${sevenInt}%w`;
      break;
    }
  }

  let tooltip = 'Claude Code Usage';
  tooltip += '\n───────────────';
  tooltip += `\n5-hour:  ${fiveInt}%`;
  if (fiveRemainingLong) tooltip += `  (resets in ${fiveRemainingLong})`;
  tooltip += `\nWeekly:  ${sevenInt}%`;
  if (sevenRemainingLong) tooltip += `  (resets in ${sevenRemainingLong})`;

  const sonnetPct = data?.seven_day_sonnet?.utilization;
  if (sonnetPct != null && sonnetPct !== 'null') {
    const sonnetNum = Number(sonnetPct);
    const sonnetInt = Math.round(Number.isFinite(sonnetNum) ? sonnetNum : 0);
    const sonnetRemainingLong = formatDurationLong(data?.seven_day_sonnet?.resets_at, now);

    tooltip += `\nSonnet:  ${sonnetInt}%`;
    if (sonnetRemainingLong) tooltip += `  (resets in ${sonnetRemainingLong})`;
  }

  const extraEnabled = data?.extra_usage?.is_enabled;
  if (extraEnabled === true || extraEnabled === 'true') {
    const extraPct = Number(data?.extra_usage?.utilization ?? 0);
    const extraUsed = Number(data?.extra_usage?.used_credits ?? 0);
    const extraLimit = Number(data?.extra_usage?.monthly_limit ?? 0);
    const extraInt = Math.round(Number.isFinite(extraPct) ? extraPct : 0);
    const extraUsedDollars = ((Number.isFinite(extraUsed) ? extraUsed : 0) / 100).toFixed(2);
    const extraLimitDollars = Math.round((Number.isFinite(extraLimit) ? extraLimit : 0) / 100);

    tooltip += '\n───────────────';
    tooltip += `\nExtra: $${extraUsedDollars}/$${extraLimitDollars} (${extraInt}%)`;
  }

  const plan = data?.meta?.plan ?? 'unknown';
  tooltip += '\n───────────────';
  tooltip += `\nPlan: ${plan}`;

  if (updateState.installing) {
    cssClass = 'updating';
    text = `${SPARK} updating...`;
  } else if (updateState.available && updateState.version) {
    if (displayMode === 'full') text += ' ⬆';
    cssClass = cssClass === 'normal' ? 'update-available' : `${cssClass} update-available`;
    tooltip += `\n───────────────\nUpdate: v${updateState.version} available`;
    if (updateState.changelogUrl) {
      tooltip += `\n${updateState.changelogUrl}`;
    }
  } else if (updateState.error) {
    if (displayMode === 'full') text += ' ⚠';
    cssClass = cssClass === 'normal' ? 'update-failed' : `${cssClass} update-failed`;
    tooltip += `\n───────────────\nUpdate failed: ${updateState.error}`;
  }

  return { text, class: cssClass, tooltip };
}

export { getRemainingSeconds, formatDuration, formatDurationLong };
