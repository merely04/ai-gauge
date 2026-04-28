/**
 * Pure functions converting WebSocket broadcast + update state + config + settings-files
 * into the four IPC payloads consumed by lib/sni-tray/sni-helper.py:
 *   set-icon, set-status, set-tooltip, set-menu.
 *
 * Single source of truth for IDs, icon names, and enums: lib/sni-tray/IPC.md.
 * Plan / token source / display mode lists must match macos/AIGauge/Sources/AIGauge/MenuBarView.swift:10-23.
 *
 * No I/O. No globals. now is a parameter for test reproducibility.
 */

import { render, formatDurationLong } from './render-waybar.js';

const PLAN_VALUES = ['max', 'pro', 'team', 'enterprise', 'unknown', 'plus', 'business', 'edu'];
const SOURCE_VALUES = ['claude-code', 'opencode', 'codex', 'github'];
const DISPLAY_MODE_VALUES = ['full', 'percent-only', 'bar-dots', 'number-bar', 'time-to-reset'];

/**
 * @param {{data: Object|null, updateState: Object, displayMode: string}} args
 * @returns {string} one of 6 icon names from the IPC enum.
 */
export function computeIconName({ data, updateState }) {
  if (data == null) return 'ai-gauge-waiting';
  if (updateState?.installing) return 'ai-gauge-updating';

  const util = Number(data.five_hour?.utilization ?? 0);
  if (util >= 80) return 'ai-gauge-critical';
  if (util >= 50) return 'ai-gauge-warning';
  if (updateState?.available) return 'ai-gauge-update-available';
  return 'ai-gauge-normal';
}

/**
 * @param {{data: Object|null, updateState: Object}} args
 * @returns {'Active'|'Passive'|'NeedsAttention'}
 */
export function computeStatus({ data }) {
  if (data == null) return 'Passive';
  const util = Number(data.five_hour?.utilization ?? 0);
  if (util >= 80) return 'NeedsAttention';
  return 'Active';
}

/**
 * @param {{data: Object|null, updateState: Object, now: number}} args
 * @returns {{title: string, body: string}}
 */
export function computeTooltip({ data, updateState, now }) {
  if (data == null) {
    return { title: 'AI Gauge', body: 'Connecting to ai-gauge-server...' };
  }
  const out = render(data, updateState ?? {}, now);
  return { title: 'AI Gauge', body: out.tooltip };
}

/**
 * @param {{data: Object|null, updateState: Object, config: Object, settingsFiles: Array, now: number}} args
 * @returns {Array<Object>}
 */
export function computeMenuItems({ data, updateState, config, settingsFiles, now }) {
  const items = [];

  if (data) {
    addInfoRows(items, data, now);
    if (data.secondary) addSecondaryRows(items, data.secondary, now);
    if (data.copilot?.premium_interactions) addCopilotRows(items, data.copilot, now);
  }

  if (items.length > 0) items.push({ type: 'separator' });

  const updateItemsBefore = items.length;
  if (updateState?.available) {
    items.push({ id: 'install-update', label: `✨ Update to v${updateState.version || 'unknown'}` });
  }
  if (updateState?.changelogUrl) {
    items.push({ id: 'view-changelog', label: 'View changelog' });
  }
  if (updateState?.available) {
    items.push({ id: 'dismiss-update', label: `Dismiss v${updateState.version || 'unknown'}` });
  }
  items.push({ id: 'check-update', label: '🔍 Check for updates' });

  if (items.length > updateItemsBefore) items.push({ type: 'separator' });

  items.push({ id: 'refresh-now', label: '↻ Refresh now' });
  items.push({ id: 'copy-summary', label: '📋 Copy usage summary' });
  items.push({ id: 'copy-raw', label: '📋 Copy raw data' });

  const currentSource = config?.tokenSource ?? 'claude-code';
  const currentPlan = config?.plan ?? 'unknown';
  const rawDisplayMode = config?.displayMode;
  const currentDisplayMode = DISPLAY_MODE_VALUES.includes(rawDisplayMode) ? rawDisplayMode : 'full';

  items.push(buildTokenSourceMenu(currentSource, settingsFiles ?? []));
  items.push(buildPlanMenu(currentPlan));
  items.push(buildDisplayModeMenu(currentDisplayMode));

  const autoCheckOn = config?.autoCheckUpdates !== false;
  items.push({
    id: 'toggle-auto-check-updates',
    label: `Auto-check updates: ${autoCheckOn ? 'ON' : 'OFF'}`,
  });

  items.push({ type: 'separator' });

  items.push({ id: 'restart-server', label: '⟳ Restart server' });
  items.push({ id: 'open-settings', label: '⚙ Open settings' });
  items.push({ id: 'quit', label: '✕ Quit' });

  return items;
}

function addInfoRows(items, data, now) {
  const fivePct = Math.round(Number(data.five_hour?.utilization ?? 0));
  const fiveLong = formatDurationLong(data.five_hour?.resets_at, now);
  let fiveLabel = `5-hour: ${fivePct}%`;
  if (fiveLong) fiveLabel += ` (resets in ${fiveLong})`;
  items.push({ id: 'info:five-hour', label: fiveLabel, enabled: false });

  const sevenPct = Math.round(Number(data.seven_day?.utilization ?? 0));
  const sevenLong = formatDurationLong(data.seven_day?.resets_at, now);
  let sevenLabel = `Weekly: ${sevenPct}%`;
  if (sevenLong) sevenLabel += ` (resets in ${sevenLong})`;
  items.push({ id: 'info:weekly', label: sevenLabel, enabled: false });

  if (data.seven_day_sonnet) {
    const pct = Math.round(Number(data.seven_day_sonnet.utilization ?? 0));
    items.push({ id: 'info:sonnet', label: `Sonnet: ${pct}%`, enabled: false });
  }

  if (data.code_review) {
    const pct = Math.round(Number(data.code_review.utilization ?? 0));
    items.push({ id: 'info:code-review', label: `Code Review: ${pct}%`, enabled: false });
  }

  const extraEnabled = data.extra_usage?.is_enabled;
  if (extraEnabled === true || extraEnabled === 'true') {
    const used = Number(data.extra_usage.used_credits ?? 0);
    const limit = Number(data.extra_usage.monthly_limit ?? 0);
    const pct = Math.round(Number(data.extra_usage.utilization ?? 0));
    const usedDollars = (used / 100).toFixed(2);
    const limitDollars = Math.round(limit / 100);
    items.push({
      id: 'info:extra-usage',
      label: `Extra: $${usedDollars}/$${limitDollars} (${pct}%)`,
      enabled: false,
    });
  }

  if (data.balance) {
    const totalCents = data.balance.total_cents;
    const usedCents = data.balance.used_cents;
    let label = 'Balance: ';
    if (totalCents != null && usedCents != null) {
      label += `$${(Number(usedCents) / 100).toFixed(2)} / $${(Number(totalCents) / 100).toFixed(2)}`;
    } else if (usedCents != null) {
      label += `$${(Number(usedCents) / 100).toFixed(2)} used`;
    } else if (totalCents != null) {
      label += `$${(Number(totalCents) / 100).toFixed(2)} available`;
    }
    items.push({ id: 'info:balance', label, enabled: false });
  }

  if (data.meta?.provider) {
    items.push({ id: 'info:provider', label: `Provider: ${data.meta.provider}`, enabled: false });
  }
  const plan = data.meta?.plan ?? 'unknown';
  items.push({ id: 'info:plan', label: `Plan: ${plan}`, enabled: false });
}

function addSecondaryRows(items, secondary, now) {
  items.push({ type: 'separator' });
  items.push({
    id: 'info:secondary',
    label: secondaryHeaderLabel(secondary?.provider),
    enabled: false,
  });

  const fiveUtil = Number(secondary?.five_hour?.utilization);
  if (Number.isFinite(fiveUtil)) {
    const long = formatDurationLong(secondary.five_hour?.resets_at, now);
    let label = `5-hour: ${Math.round(fiveUtil)}%`;
    if (long) label += ` (resets in ${long})`;
    items.push({ id: 'info:secondary-five-hour', label, enabled: false });
  }

  const sevenUtil = Number(secondary?.seven_day?.utilization);
  if (Number.isFinite(sevenUtil)) {
    const long = formatDurationLong(secondary.seven_day?.resets_at, now);
    let label = `Weekly: ${Math.round(sevenUtil)}%`;
    if (long) label += ` (resets in ${long})`;
    items.push({ id: 'info:secondary-weekly', label, enabled: false });
  }

  const balTotal = secondary?.balance?.total_cents;
  if (balTotal != null) {
    const dollars = (Number(balTotal) / 100).toFixed(2);
    items.push({
      id: 'info:secondary-balance',
      label: `Balance: $${dollars} available`,
      enabled: false,
    });
  }
}

function addCopilotRows(items, copilot, now) {
  items.push({ type: 'separator' });
  items.push({ id: 'info:copilot', label: 'GitHub Copilot', enabled: false });

  const plan = copilot.plan ?? 'unknown';
  items.push({ id: 'info:copilot-plan', label: `Plan: ${plan}`, enabled: false });

  const pi = copilot.premium_interactions;
  const pct = Math.round(Number(pi?.utilization ?? 0));
  const used = Number(pi?.used ?? 0);
  const limit = Number(pi?.limit ?? 0);
  items.push({
    id: 'info:copilot-premium',
    label: `Premium: ${pct}% (${used}/${limit})`,
    enabled: false,
  });

  const long = formatDurationLong(pi?.resets_at, now);
  items.push({
    id: 'info:copilot-resets',
    label: `Resets: ${long || 'unknown'}`,
    enabled: false,
  });
}

function secondaryHeaderLabel(provider) {
  if (provider === 'codex') return 'Codex';
  if (provider === 'openai') return 'OpenAI';
  return provider || 'Unknown';
}

function buildTokenSourceMenu(currentSource, settingsFiles) {
  const children = SOURCE_VALUES.map((src) => ({
    id: `set-token-source:${src}`,
    label: src,
    toggleType: 'checkmark',
    toggleState: src === currentSource ? 1 : 0,
  }));

  if (settingsFiles.length > 0) {
    children.push({ type: 'separator' });
    for (const f of settingsFiles) {
      const value = `claude-settings:${f.name}`;
      children.push({
        id: `set-token-source:${value}`,
        label: `${f.name} (${f.provider})`,
        toggleType: 'checkmark',
        toggleState: value === currentSource ? 1 : 0,
      });
    }
  }

  return {
    id: 'set-token-source',
    label: `🔑 Token source: ${currentSource}`,
    type: 'menu',
    children,
  };
}

function buildPlanMenu(currentPlan) {
  return {
    id: 'set-plan',
    label: `📋 Plan: ${currentPlan}`,
    type: 'menu',
    children: PLAN_VALUES.map((p) => ({
      id: `set-plan:${p}`,
      label: p,
      toggleType: 'checkmark',
      toggleState: p === currentPlan ? 1 : 0,
    })),
  };
}

function buildDisplayModeMenu(currentMode) {
  return {
    id: 'set-display-mode',
    label: `🎨 Display mode: ${currentMode}`,
    type: 'menu',
    children: DISPLAY_MODE_VALUES.map((m) => ({
      id: `set-display-mode:${m}`,
      label: m,
      toggleType: 'checkmark',
      toggleState: m === currentMode ? 1 : 0,
    })),
  };
}
