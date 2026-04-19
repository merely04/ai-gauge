import { writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getCacheDir } from './paths.js';
import { compareVersions, isValidSemver } from './semver.js';

export { compareVersions } from './semver.js';

export function parseRegistryResponse(jsonOrString) {
  let json;

  try {
    const raw = typeof jsonOrString === 'string' ? jsonOrString.replace(/^\uFEFF/, '') : jsonOrString;
    json = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { error: 'malformed' };
  }

  if (!json || typeof json !== 'object') return { error: 'malformed' };
  if (!json['dist-tags'] || typeof json['dist-tags'] !== 'object') return { error: 'no-dist-tags' };

  const latest = json['dist-tags'].latest;
  if (!latest || typeof latest !== 'string') return { error: 'no-latest' };
  if (!isValidSemver(latest)) return { error: 'invalid-version' };

  return { latestVersion: latest };
}

export function isCiEnvironment(env) {
  const ciVars = [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'JENKINS_HOME',
    'BUILDKITE',
    'DRONE',
    'TRAVIS',
  ];

  return ciVars.some((name) => !!env[name]);
}

export function isNotifierDisabled(env) {
  return !!env.NO_UPDATE_NOTIFIER;
}

export async function checkForUpdate({
  currentVersion,
  registryUrl = 'https://registry.npmjs.org',
  packageName = 'ai-gauge',
  fetchFn = fetch,
  timeoutMs = 10000,
}) {
  const url = `${registryUrl}/${encodeURIComponent(packageName)}?fields=dist-tags`;

  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': `ai-gauge/${currentVersion}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return { error: `http-${res.status}`, currentVersion };
    }

    const body = await res.text();
    const parsed = parseRegistryResponse(body);

    if (parsed.error) {
      return { error: parsed.error, currentVersion };
    }

    const { latestVersion } = parsed;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return { updateAvailable, latestVersion, currentVersion };
  } catch (err) {
    if (isTimeoutError(err)) {
      return { error: 'timeout', currentVersion };
    }

    return { error: 'network', currentVersion };
  }
}

function isTimeoutError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const msg = String(err);
  return msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('timed out');
}

export function getCacheFilePath() {
  return join(getCacheDir(), 'update-check.json');
}

export function readCache(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeCache(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, filePath);
}

export function shouldSkipUpdateCheck(env, config) {
  if (isNotifierDisabled(env)) {
    return { skip: true, reason: 'NO_UPDATE_NOTIFIER env' };
  }

  if (isCiEnvironment(env)) {
    return { skip: true, reason: 'CI detected' };
  }

  if (config?.autoCheckUpdates === false) {
    return { skip: true, reason: 'autoCheckUpdates disabled' };
  }

  return { skip: false };
}
