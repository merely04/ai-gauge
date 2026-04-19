import { writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getCacheDir } from './paths.js';

const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

export function compareVersions(a, b) {
  const stripBuild = (version) => version.split('+')[0];
  const splitPrerelease = (version) => {
    const stripped = stripBuild(version);
    const hyphenIndex = stripped.indexOf('-');
    if (hyphenIndex === -1) {
      return [stripped, undefined];
    }

    return [stripped.slice(0, hyphenIndex), stripped.slice(hyphenIndex + 1)];
  };

  const [aMain, aPre] = splitPrerelease(a);
  const [bMain, bPre] = splitPrerelease(b);

  const aParts = aMain.split('.').map(Number);
  const bParts = bMain.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (aPre === undefined && bPre !== undefined) return 1;
  if (aPre !== undefined && bPre === undefined) return -1;
  if (aPre === undefined && bPre === undefined) return 0;

  const aIds = aPre.split('.');
  const bIds = bPre.split('.');
  const len = Math.max(aIds.length, bIds.length);

  for (let i = 0; i < len; i++) {
    if (i >= aIds.length) return -1;
    if (i >= bIds.length) return 1;

    const aId = aIds[i];
    const bId = bIds[i];
    const aNum = Number(aId);
    const bNum = Number(bId);
    const aIsNum = !Number.isNaN(aNum) && String(aNum) === aId;
    const bIsNum = !Number.isNaN(bNum) && String(bNum) === bId;

    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum > bNum ? 1 : -1;
      continue;
    }

    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    if (aId < bId) return -1;
    if (aId > bId) return 1;
  }

  return 0;
}

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
  if (!SEMVER_PATTERN.test(latest)) return { error: 'invalid-version' };

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
