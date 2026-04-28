import { atomicWriteJSON } from './atomic-write.js';

export const CONFIG_PATH = `${process.env.HOME}/.config/ai-gauge/config.json`;

export const VALID_KEYS = ['plan', 'tokenSource', 'autoCheckUpdates', 'displayMode'];

export const TOKEN_SOURCE_PATTERN = /^(claude-code|opencode|codex|github|claude-settings:[a-zA-Z0-9_][a-zA-Z0-9_.-]*)$/;

export const VALID_VALUES = {
  plan: ['max', 'pro', 'team', 'enterprise', 'unknown', 'plus', 'business', 'edu'],
  tokenSource: ['claude-code', 'opencode'], // legacy list; pattern validation used at runtime (claude-code|opencode|codex|github|claude-settings:...)
  autoCheckUpdates: [true, false],
  displayMode: ['full', 'percent-only', 'bar-dots', 'number-bar', 'time-to-reset'],
};

const DEFAULTS = {
  tokenSource: 'claude-code',
  plan: null,
  autoCheckUpdates: true,
  displayMode: 'full',
};

export async function readConfig(path = CONFIG_PATH) {
  try {
    const data = await Bun.file(path).json();
    return {
      tokenSource: data?.tokenSource ?? DEFAULTS.tokenSource,
      plan: data?.plan ?? DEFAULTS.plan,
      autoCheckUpdates: data?.autoCheckUpdates ?? DEFAULTS.autoCheckUpdates,
      displayMode: data?.displayMode ?? DEFAULTS.displayMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function validateConfigChange(key, value) {
  if (!VALID_KEYS.includes(key)) {
    return { valid: false, reason: `invalid key=${key}` };
  }
  if (key === 'tokenSource') {
    if (!TOKEN_SOURCE_PATTERN.test(value)) {
      return { valid: false, reason: `invalid tokenSource=${value}: must match ${TOKEN_SOURCE_PATTERN}` };
    }
    return { valid: true };
  }
  if (!VALID_VALUES[key].includes(value)) {
    return { valid: false, reason: `invalid value=${value} for key=${key}` };
  }
  return { valid: true };
}

export async function applyConfigChange(key, value, path = CONFIG_PATH) {
  const validation = validateConfigChange(key, value);
  if (!validation.valid) {
    return { applied: false, reason: validation.reason };
  }
  const config = await readConfig(path);
  config[key] = value;
  await atomicWriteJSON(path, config, { indent: 2 });
  return { applied: true, config };
}
