import { registerProvider } from './index.js';
import { httpError } from './_shared.js';

const OLLAMA_SETTINGS_URL = 'https://ollama.com/settings';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ollamaCloudAdapter = {
  name: 'ollama-cloud',
  kind: 'scrape',
  responseType: 'text',

  /**
   * Build request for the authenticated ollama.com settings page.
   * @param {{ token: string }} creds - token holds the full Cookie header string
   * @returns {{ url: string, method: string, headers: Record<string, string> }}
   */
  buildRequest(creds) {
    if (!creds?.token) {
      throw new Error('ollama-cloud: missing cookie');
    }

    return {
      url: OLLAMA_SETTINGS_URL,
      method: 'GET',
      headers: {
        Cookie: creds.token,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://ollama.com/',
      },
    };
  },

  /**
   * Parse the ollama.com settings HTML for session/weekly usage.
   * The server reads res.text() (responseType: 'text'), so this receives the
   * raw HTML string rather than parsed JSON.
   * @param {string | null} html
   * @param {number} responseStatus
   * @returns {{ rateLimits: object | null, balance: null, plan?: string | null, error?: object }}
   */
  parseResponse(html, responseStatus) {
    if (responseStatus !== 200) {
      return httpError(responseStatus);
    }

    if (!html || typeof html !== 'string') {
      return {
        rateLimits: null,
        balance: null,
        error: { reason: 'empty-response' },
      };
    }

    const sessionMatch = html.match(/aria-label="Session usage\s+([\d.]+)%\s*used"/i);
    const sessionPct = sessionMatch ? parseFloat(sessionMatch[1]) : null;

    const weeklyMatch = html.match(/aria-label="Weekly usage\s+([\d.]+)%\s*used"/i);
    const weeklyPct = weeklyMatch ? parseFloat(weeklyMatch[1]) : null;

    // Reset timestamps live in `data-time` attributes. Split the document at the
    // "Weekly usage" heading so the first data-time on each side belongs to the
    // correct window regardless of surrounding markup.
    const weeklyIdx = html.search(/Weekly usage/i);
    const sessionPart = weeklyIdx !== -1 ? html.slice(0, weeklyIdx) : html;
    const weeklyPart = weeklyIdx !== -1 ? html.slice(weeklyIdx) : '';

    const sessionReset = (sessionPart.match(/data-time="([^"]+)"/) || [])[1] ?? null;
    const weeklyReset = (weeklyPart.match(/data-time="([^"]+)"/) || [])[1] ?? null;

    // Plan label (e.g. "pro") sits in a pill next to the "Cloud usage" heading.
    const planMatch = html.match(/Cloud usage<\/span>[\s\S]{0,300}?>\s*([A-Za-z][A-Za-z0-9+ -]*?)\s*<\/span/i);
    const plan = planMatch ? planMatch[1].trim().toLowerCase() : null;

    // Neither window parsed → not the usage page (expired cookie / login
    // redirect body / markup changed).
    if (sessionPct === null && weeklyPct === null) {
      return {
        rateLimits: null,
        balance: null,
        error: { reason: 'no-usage-data' },
      };
    }

    return {
      rateLimits: {
        five_hour: sessionPct !== null ? { utilization: sessionPct, resets_at: sessionReset } : null,
        seven_day: weeklyPct !== null ? { utilization: weeklyPct, resets_at: weeklyReset } : null,
        seven_day_sonnet: null,
        seven_day_opus: null,
        extra_usage: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        seven_day_omelette: null,
      },
      balance: null,
      plan,
    };
  },
};

registerProvider(ollamaCloudAdapter);

export { ollamaCloudAdapter as ollamaCloud };
export default ollamaCloudAdapter;
