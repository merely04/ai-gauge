import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProviderByBaseUrl } from './providers/index.js';

const MAX_FILE_SIZE = 1 * 1024 * 1024;
const SETTINGS_FILE_RE = /^settings(\.([a-zA-Z0-9_][a-zA-Z0-9_.-]*))?\.json$/;

function parseSettingsName(filename) {
  if (filename === 'settings.json') return 'default';

  const match = filename.match(/^settings\.([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\.json$/);
  return match ? match[1] : null;
}

function readSettingsFileSafe(filepath) {
  try {
    const stat = lstatSync(filepath);

    if (stat.isSymbolicLink()) return { error: 'symlink' };
    if (stat.size > MAX_FILE_SIZE) return { error: 'too-large' };

    const content = readFileSync(filepath, 'utf8');
    return { json: JSON.parse(content) };
  } catch (err) {
    if (err?.code === 'ENOENT') return { error: 'not-found' };
    return { error: 'invalid-json' };
  }
}

/**
 * Discover settings files in ~/.claude/ — returns array for UI/WS (no tokens, no paths).
 * @param {string} claudeDir
 */
export function discoverSettingsFiles(claudeDir) {
  let files;

  try {
    files = readdirSync(claudeDir);
  } catch {
    return [];
  }

  const results = [];

  for (const filename of files) {
    if (filename === 'settings.local.json') continue;
    if (!SETTINGS_FILE_RE.test(filename)) continue;

    const name = parseSettingsName(filename);
    if (!name) continue;

    const parsed = readSettingsFileSafe(join(claudeDir, filename));

    if (parsed.error === 'symlink') {
      results.push({
        name,
        provider: 'unknown',
        baseUrl: null,
        hasToken: false,
        hasApiKeyHelper: false,
        supported: false,
        skipReason: 'symlink',
      });
      continue;
    }

    if (parsed.error === 'too-large') {
      results.push({
        name,
        provider: 'unknown',
        baseUrl: null,
        hasToken: false,
        hasApiKeyHelper: false,
        supported: false,
        skipReason: 'too-large',
      });
      continue;
    }

    if (parsed.error) {
      results.push({
        name,
        provider: 'unknown',
        baseUrl: null,
        hasToken: false,
        hasApiKeyHelper: false,
        supported: false,
        skipReason: 'invalid-json',
      });
      continue;
    }

    const env = parsed.json?.env ?? {};
    const token = env.ANTHROPIC_AUTH_TOKEN || null;
    const baseUrl = env.ANTHROPIC_BASE_URL || null;
    const hasApiKeyHelper = !!(parsed.json?.apiKeyHelper || env.ANTHROPIC_API_KEY_HELPER);
    const provider = detectProviderByBaseUrl(baseUrl);

    if (hasApiKeyHelper && !token) {
      results.push({
        name,
        provider,
        baseUrl,
        hasToken: false,
        hasApiKeyHelper: true,
        supported: false,
        skipReason: 'apiKeyHelper-only',
      });
      continue;
    }

    if (!token) {
      results.push({
        name,
        provider,
        baseUrl,
        hasToken: false,
        hasApiKeyHelper: false,
        supported: false,
        skipReason: 'no-token',
      });
      continue;
    }

    results.push({
      name,
      provider,
      baseUrl,
      hasToken: true,
      hasApiKeyHelper,
      supported: true,
    });
  }

  return results.sort((a, b) => {
    if (a.name === 'default' && b.name !== 'default') return -1;
    if (b.name === 'default' && a.name !== 'default') return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Read a named settings file for credential extraction (defense-in-depth — re-validates everything).
 * Returns null if file is invalid, symlink, apiKeyHelper-only, or has no token.
 * @param {string} claudeDir
 * @param {string} name
 */
export function readSettingsFileForCreds(claudeDir, name) {
  if (name !== 'default' && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name)) {
    return null;
  }

  const filename = name === 'default' ? 'settings.json' : `settings.${name}.json`;
  const parsed = readSettingsFileSafe(join(claudeDir, filename));

  if (parsed.error) return null;

  const env = parsed.json?.env ?? {};
  const token = env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = env.ANTHROPIC_BASE_URL || null;

  if ((parsed.json?.apiKeyHelper || env.ANTHROPIC_API_KEY_HELPER) && !token) {
    return null;
  }

  if (!token) return null;

  return {
    token,
    baseUrl,
    provider: detectProviderByBaseUrl(baseUrl),
    name,
  };
}
