const DOT_FILLED = '\u25CF';
const DOT_EMPTY = '\u25CB';
const BAR_FILLED = '\u2593';
const BAR_EMPTY = '\u2591';
const TIMER = '\u23F1';
const SPARK = '\u2726';

function barCells(pct) {
  return Math.max(0, Math.min(10, Math.floor(Number(pct) / 10)));
}

function providerLabel(provider, tokenSource) {
  if (tokenSource === 'github' || provider === 'copilot') return 'GitHub Copilot Usage';
  if (tokenSource === 'codex' || provider === 'codex') return 'Codex Usage';
  if (provider === 'zai') return 'Z.ai Usage';
  if (provider === 'minimax') return 'MiniMax Usage';
  if (provider === 'openrouter') return 'OpenRouter Usage';
  if (provider === 'komilion') return 'Komilion Usage';
  if (provider === 'packy') return 'Packy Usage';
  if (typeof tokenSource === 'string' && tokenSource.startsWith('claude-settings:')) {
    return `Claude (${tokenSource.slice('claude-settings:'.length)}) Usage`;
  }
  if (tokenSource === 'opencode') return 'OpenCode Usage';
  return 'Claude Code Usage';
}

function providerShortName(provider) {
  switch (provider) {
    case 'anthropic': return 'Claude';
    case 'codex': return 'Codex';
    case 'copilot': return 'GitHub Copilot';
    case 'zai': return 'Z.ai';
    case 'minimax': return 'MiniMax';
    case 'openrouter': return 'OpenRouter';
    case 'komilion': return 'Komilion';
    case 'packy': return 'Packy';
    default: return provider || 'Unknown';
  }
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

function applyUpdateStateOverlay({ text, cssClass, tooltip }, updateState, displayMode) {
  if (updateState.installing) {
    return {
      text: `${SPARK} updating...`,
      class: 'updating',
      tooltip,
    };
  }

  if (updateState.available && updateState.version) {
    let nextText = displayMode === 'full' ? `${text} ⬆` : text;
    let nextClass = cssClass === 'normal' ? 'update-available' : `${cssClass} update-available`;
    let nextTooltip = `${tooltip}\n───────────────\nUpdate: v${updateState.version} available`;
    if (updateState.changelogUrl) nextTooltip += `\n${updateState.changelogUrl}`;
    return { text: nextText, class: nextClass, tooltip: nextTooltip };
  }

  if (updateState.error) {
    let nextText = displayMode === 'full' ? `${text} ⚠` : text;
    let nextClass = cssClass === 'normal' ? 'update-failed' : `${cssClass} update-failed`;
    let nextTooltip = `${tooltip}\n───────────────\nUpdate failed: ${updateState.error}`;
    return { text: nextText, class: nextClass, tooltip: nextTooltip };
  }

  return { text, class: cssClass, tooltip };
}

function buildCopilotLines(copilot, now) {
  const pi = copilot?.premium_interactions;
  if (!pi) return null;

  const utilRaw = Number(pi?.utilization ?? 0);
  const util = fmtPct(Number.isFinite(utilRaw) ? utilRaw : 0);
  const used = Number(pi?.used ?? 0);
  const limit = Number(pi?.limit ?? 0);
  const plan = copilot.plan ?? 'unknown';
  const countdownLong = formatDurationLong(pi?.resets_at, now);

  const lines = [
    `Plan:    ${plan}`,
    `Premium: ${util}% (${used}/${limit})`,
    `Resets:  ${countdownLong || 'unknown'}`,
  ];
  if (Number(pi?.overage_count ?? 0) > 0) {
    lines.push(`Overage: ${pi.overage_count} requests`);
  }
  return lines.join('\n');
}

function renderCopilotMode(data, updateState = {}, now = Date.now()) {
  const pi = data.copilot.premium_interactions;
  const displayMode = data?.meta?.displayMode ?? 'full';
  const utilRaw = Number(pi?.utilization ?? 0);
  const util = fmtPct(Number.isFinite(utilRaw) ? utilRaw : 0);

  let cssClass;
  if (util >= 80) {
    cssClass = 'critical';
  } else if (util >= 50) {
    cssClass = 'warning';
  } else {
    cssClass = 'normal';
  }

  const countdownShort = formatDuration(pi?.resets_at, now);

  let text;
  switch (displayMode) {
    case 'percent-only':
      text = `${SPARK} ${util}%`;
      break;
    case 'bar-dots': {
      const n = barCells(util);
      text = `${SPARK} ${DOT_FILLED.repeat(n)}${DOT_EMPTY.repeat(10 - n)}`;
      break;
    }
    case 'number-bar': {
      const n = barCells(util);
      text = `${util}% ${BAR_FILLED.repeat(n)}${BAR_EMPTY.repeat(10 - n)}`;
      break;
    }
    case 'time-to-reset':
      text = countdownShort ? `${TIMER} ${countdownShort}` : `${TIMER} --`;
      break;
    case 'full':
    default:
      text = `${SPARK} ${util}%`;
      if (countdownShort) text += ` ${countdownShort}`;
      break;
  }

  const tooltip = `GitHub Copilot Usage\n───────────────\n${buildCopilotLines(data.copilot, now)}`;

  return applyUpdateStateOverlay({ text, cssClass, tooltip }, updateState, displayMode);
}

export function render(data, updateState = {}, now = Date.now()) {
  if (!data?.five_hour && data?.copilot?.premium_interactions) {
    return renderCopilotMode(data, updateState, now);
  }

  const hasFiveHour = !!data?.five_hour;
  const hasBalance = !!data?.balance;
  const fivePct = Number(data?.five_hour?.utilization ?? 0);
  const sevenPct = Number(data?.seven_day?.utilization ?? 0);
  const fiveInt = fmtPct(Number.isFinite(fivePct) ? fivePct : 0);
  const sevenInt = fmtPct(Number.isFinite(sevenPct) ? sevenPct : 0);
  const displayMode = data?.meta?.displayMode ?? 'full';

  const fiveRemaining = formatDuration(data?.five_hour?.resets_at, now);
  const fiveRemainingLong = formatDurationLong(data?.five_hour?.resets_at, now);
  const sevenRemainingLong = formatDurationLong(data?.seven_day?.resets_at, now);

  let cssClass;
  if (!hasFiveHour) {
    cssClass = 'waiting';
  } else if (fiveInt >= 80) {
    cssClass = 'critical';
  } else if (fiveInt >= 50) {
    cssClass = 'warning';
  } else {
    cssClass = 'normal';
  }

  let text;
  switch (displayMode) {
    case 'percent-only':
      text = hasFiveHour ? `${SPARK} ${fiveInt}%` : `${SPARK} --`;
      break;
    case 'bar-dots': {
      if (!hasFiveHour) {
        text = `${SPARK} --`;
        break;
      }
      const n = barCells(fiveInt);
      text = `${SPARK} ${DOT_FILLED.repeat(n)}${DOT_EMPTY.repeat(10 - n)}`;
      break;
    }
    case 'number-bar': {
      if (!hasFiveHour) {
        text = `-- ${BAR_EMPTY.repeat(10)}`;
        break;
      }
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
      if (!hasFiveHour) {
        text = `${SPARK} --`;
      } else {
        text = `${SPARK} ${fiveInt}%`;
        if (fiveRemaining) text += ` ${fiveRemaining}`;
        text += ` · ${sevenInt}%w`;
      }
      break;
    }
  }

  const hasSecondary = data?.secondary && typeof data.secondary === 'object';
  let tooltip = hasSecondary
    ? providerShortName(data?.meta?.provider)
    : providerLabel(data?.meta?.provider, data?.meta?.tokenSource);
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

  const codeReviewPct = data?.code_review?.utilization;
  if (codeReviewPct != null && codeReviewPct !== 'null') {
    const codeReviewNum = Number(codeReviewPct);
    const codeReviewInt = Math.round(Number.isFinite(codeReviewNum) ? codeReviewNum : 0);
    const codeReviewRemainingLong = formatDurationLong(data?.code_review?.resets_at, now);

    tooltip += `\nCode review:  ${codeReviewInt}%`;
    if (codeReviewRemainingLong) tooltip += `  (resets in ${codeReviewRemainingLong})`;
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

  if (data?.meta?.provider && !hasSecondary) {
    tooltip += `\nProvider: ${data.meta.provider}`;
  }

  if (hasBalance) {
    const totalCents = data.balance.total_cents;
    const usedCents = data.balance.used_cents;
    if (totalCents != null && usedCents != null) {
      const usedDollars = (Number(usedCents) / 100).toFixed(2);
      const totalDollars = (Number(totalCents) / 100).toFixed(2);
      tooltip += `\nBalance: $${usedDollars} / $${totalDollars}`;
    } else if (usedCents != null) {
      const usedDollars = (Number(usedCents) / 100).toFixed(2);
      tooltip += `\nBalance: $${usedDollars} used`;
    } else if (totalCents != null) {
      const totalDollars = (Number(totalCents) / 100).toFixed(2);
      tooltip += `\nBalance: $${totalDollars} available`;
    }
  }

  const secondary = hasSecondary ? data.secondary : null;
  if (secondary) {
    tooltip += '\n───────────────';
    tooltip += `\n${providerShortName(secondary.provider)}`;

    const sFive = Number(secondary?.five_hour?.utilization);
    if (Number.isFinite(sFive)) {
      tooltip += `\n5-hour:  ${Math.round(sFive)}%`;
      const r = formatDurationLong(secondary?.five_hour?.resets_at, now);
      if (r) tooltip += `  (resets in ${r})`;
    }

    const sSeven = Number(secondary?.seven_day?.utilization);
    if (Number.isFinite(sSeven)) {
      tooltip += `\nWeekly:  ${Math.round(sSeven)}%`;
      const r = formatDurationLong(secondary?.seven_day?.resets_at, now);
      if (r) tooltip += `  (resets in ${r})`;
    }

    const sCodeReview = Number(secondary?.code_review?.utilization);
    if (Number.isFinite(sCodeReview)) {
      tooltip += `\nCode review:  ${Math.round(sCodeReview)}%`;
      const r = formatDurationLong(secondary?.code_review?.resets_at, now);
      if (r) tooltip += `  (resets in ${r})`;
    }

    const sBalanceTotal = secondary?.balance?.total_cents;
    if (sBalanceTotal != null) {
      const dollars = (Number(sBalanceTotal) / 100).toFixed(2);
      tooltip += `\nBalance: $${dollars} available`;
    }
  }

  const copilotLines = buildCopilotLines(data?.copilot, now);
  if (copilotLines) {
    tooltip += `\n───────────────\nGitHub Copilot\n${copilotLines}`;
  }

  return applyUpdateStateOverlay({ text, cssClass, tooltip }, updateState, displayMode);
}

export { getRemainingSeconds, formatDuration, formatDurationLong };
