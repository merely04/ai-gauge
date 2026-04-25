// WARNING: /wham/usage is an undocumented endpoint. Shape may change without notice. Defensive defaults applied throughout parseResponse.
import { registerProvider } from './index.js';
import { httpError } from './_shared.js';
import { logJson } from '../log-safe.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lstat, readdir } from 'node:fs/promises';

const CODEX_URL = 'https://chatgpt.com/backend-api/wham/usage';
const DEFAULT_CODEX_VERSION = '0.42.0';
const MAX_JSONL_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_TO_SCAN = 50;

function epochToIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function mapWindow(window) {
  if (typeof window !== 'object' || window === null) {
    return null;
  }

  const pct = window.used_percent ?? window.utilization;
  return {
    utilization: typeof pct === 'number' ? pct : null,
    resets_at: epochToIso(window.reset_at),
  };
}

function mapCredits(credits) {
  if (credits?.has_credits !== true) return null;

  const raw = credits.balance;
  const amount = typeof raw === 'number' ? raw : parseFloat(raw ?? '0') || 0;
  const cents = Math.round(amount * 100);

  return {
    currency: credits.currency ?? 'USD',
    total_cents: cents,
    used_cents: null,
    remaining_cents: cents,
    usage_daily_cents: null,
    percentage: null,
  };
}

const codexAdapter = {
  name: 'codex',
  kind: 'oauth',

  /**
   * Build request for Codex ChatGPT usage API.
   * @param {{ token?: string, account_id?: string, codexVersion?: string }} creds
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
  buildRequest(creds) {
    if (!creds?.token) {
      throw new Error('codex: missing token');
    }

    if (!creds?.account_id) {
      throw new Error('codex: missing account_id');
    }

    return {
      url: CODEX_URL,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'ChatGPT-Account-Id': creds.account_id,
        'User-Agent': `codex_cli_rs/${creds.codexVersion || DEFAULT_CODEX_VERSION}`,
        Accept: 'application/json',
      },
    };
  },

  /**
   * Parse response from Codex ChatGPT usage API.
   * @param {object | null} json
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: object | null, error?: object }}
   */
  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return httpError(responseStatus);
    }

    if (typeof json !== 'object' || json === null) {
      return {
        rateLimits: null,
        balance: null,
        error: { reason: 'empty-response' },
      };
    }

    const balance = mapCredits(json.credits);

    return {
      rateLimits: {
        five_hour: mapWindow(json.rate_limit?.primary_window),
        seven_day: mapWindow(json.rate_limit?.secondary_window),
        code_review: mapWindow(json.code_review_rate_limit?.primary_window),
        seven_day_sonnet: null,
        seven_day_opus: null,
        extra_usage: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        seven_day_omelette: null,
      },
      balance,
    };
  },
};

/**
 * JSONL fallback: find the most recent token_count event in Codex session files.
 * @param {{ codexHome?: string }} options
 * @returns {Promise<{ rateLimits: object, balance: null } | null>}
 */
async function isRealDirectory(path) {
  const s = await lstat(path).catch(() => null);
  return !!(s && s.isDirectory() && !s.isSymbolicLink());
}

async function isRealFile(path) {
  const s = await lstat(path).catch(() => null);
  return s && s.isFile() && !s.isSymbolicLink() ? s : null;
}

export async function parseCodexJsonlFallback({ codexHome } = {}) {
  const home = codexHome || join(homedir(), '.codex');
  const sessionsDir = join(home, 'sessions');
  let filesScanned = 0;

  try {
    if (!(await isRealDirectory(sessionsDir))) return null;

    const years = await readdir(sessionsDir).catch(() => []);
    const sortedYears = years.filter((year) => /^\d{4}$/.test(year)).sort().reverse();

    for (const year of sortedYears) {
      const yearDir = join(sessionsDir, year);
      if (!(await isRealDirectory(yearDir))) continue;

      const months = await readdir(yearDir).catch(() => []);
      const sortedMonths = months.filter((month) => /^\d{2}$/.test(month)).sort().reverse();

      for (const month of sortedMonths) {
        const monthDir = join(yearDir, month);
        if (!(await isRealDirectory(monthDir))) continue;

        const days = await readdir(monthDir).catch(() => []);
        const sortedDays = days.filter((day) => /^\d{2}$/.test(day)).sort().reverse();

        for (const day of sortedDays) {
          const dayDir = join(monthDir, day);
          if (!(await isRealDirectory(dayDir))) continue;

          const files = await readdir(dayDir).catch(() => []);
          const jsonlFiles = files
            .filter((file) => /^rollout-.*\.jsonl$/.test(file))
            .sort()
            .reverse();

          for (const filename of jsonlFiles) {
            if (filesScanned >= MAX_FILES_TO_SCAN) return null;
            filesScanned += 1;

            const filePath = join(dayDir, filename);
            const fileStat = await isRealFile(filePath);
            if (!fileStat) continue;

            if (fileStat.size > MAX_JSONL_FILE_SIZE) {
              logJson(console.warn, 'codex_jsonl_file_too_large', { path: filePath, size: fileStat.size });
              continue;
            }

            const text = await Bun.file(filePath).text().catch(() => null);
            if (!text) continue;

            const lines = text.split('\n');
            for (let index = lines.length - 1; index >= 0; index -= 1) {
              const line = lines[index];
              if (!line?.trim()) continue;

              try {
                const event = JSON.parse(line);
                if (event?.type === 'token_count' && event?.rate_limits?.primary_window) {
                  return {
                    rateLimits: {
                      five_hour: mapWindow(event.rate_limits.primary_window),
                      seven_day: mapWindow(event.rate_limits.secondary_window ?? null),
                      code_review: null,
                      seven_day_sonnet: null,
                      seven_day_opus: null,
                      extra_usage: null,
                      seven_day_oauth_apps: null,
                      seven_day_cowork: null,
                      seven_day_omelette: null,
                    },
                    balance: null,
                  };
                }
              } catch (err) {
                logJson(console.warn, 'codex_jsonl_parse_error', { path: filePath, line: index });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logJson(console.warn, 'codex_jsonl_walk_error', { error: String(err) });
    return null;
  }

  return null;
}

registerProvider(codexAdapter);

export { codexAdapter as codex };
export default codexAdapter;
