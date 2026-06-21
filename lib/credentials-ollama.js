import { homedir } from 'node:os';
import { join } from 'node:path';
import { logJson } from './log-safe.js';

/**
 * Reads Ollama Cloud browser session cookie from a config file.
 * The cookie is the full Cookie header value (e.g., "aid=...; __Secure-session=...").
 *
 * @param {string} [cookiePath] - Path to the cookie file. Defaults to ~/.config/ai-gauge/ollama-cookie
 * @returns {Promise<{token: string, source: string} | null>} - { token, source: 'file' } or null
 */
export async function readOllamaCloudCredentials(cookiePath) {
  if (!cookiePath) {
    cookiePath = join(process.env.HOME ?? homedir(), '.config', 'ai-gauge', 'ollama-cookie');
  }

  let text;
  try {
    text = await Bun.file(cookiePath).text();
  } catch {
    logJson(console.error, 'ollama_cookie_missing', {
      hint: 'ollama-cookie file not found or unreadable',
      path: cookiePath,
    });
    return null;
  }

  const token = text.trim();
  if (token === '') {
    return null;
  }

  return { token, source: 'file' };
}
