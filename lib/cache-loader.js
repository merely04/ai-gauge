import { buildMeta } from './meta.js';
import { logJson } from './log-safe.js';

const ALLOWED_CACHE_KEYS = [
  'five_hour',
  'seven_day',
  'seven_day_oauth_apps',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_cowork',
  'seven_day_omelette',
  'extra_usage',
  'balance',
];

/**
 * Load cached usage data from disk with strict validation.
 * Returns null if cache is missing, invalid, or doesn't match current config.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.expectedTokenSource]
 * @param {string} [options.expectedProvider]
 * @param {object} [options.config]
 * @param {string} [options.fallbackPlan]
 * @returns {Promise<object | null>}
 */
export async function loadCachedUsage(path, { expectedTokenSource, expectedProvider, config, fallbackPlan } = {}) {
  let data;
  try {
    data = await Bun.file(path).json();
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') return null;
  if (!data.five_hour && !data.balance) return null;

  const cachedTokenSource = data.meta?.tokenSource;
  const cachedProvider = data.meta?.provider;

  if (expectedTokenSource && cachedTokenSource && cachedTokenSource !== expectedTokenSource) {
    logJson(console.warn, 'cache_invalidated', {
      reason: 'tokenSource_mismatch',
      cached: cachedTokenSource,
      expected: expectedTokenSource,
    });
    return null;
  }

  if (expectedProvider && cachedProvider && cachedProvider !== expectedProvider) {
    logJson(console.warn, 'cache_invalidated', {
      reason: 'provider_mismatch',
      cached: cachedProvider,
      expected: expectedProvider,
    });
    return null;
  }

  const plan = config?.plan && config.plan !== 'unknown' ? config.plan : fallbackPlan;
  const safeData = {};

  for (const key of ALLOWED_CACHE_KEYS) {
    if (key in data) {
      safeData[key] = data[key];
    }
  }

  return {
    ...safeData,
    meta: buildMeta(
      {
        plan: data.meta?.plan ?? plan,
        tokenSource: data.meta?.tokenSource ?? config?.tokenSource,
        displayMode: data.meta?.displayMode ?? config?.displayMode,
        autoCheckUpdates: config?.autoCheckUpdates,
      },
      {
        fetchedAt: data.meta?.fetchedAt,
        provider: data.meta?.provider ?? expectedProvider,
      }
    ),
  };
}
