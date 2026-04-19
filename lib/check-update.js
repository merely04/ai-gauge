/**
 * Compare two semver strings per SemVer §11 precedence rules.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareVersions(a, b) {
  const stripBuild = (version) => version.split('+')[0];
  const [aMain, aPre] = stripBuild(a).split('-', 2);
  const [bMain, bPre] = stripBuild(b).split('-', 2);

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

/**
 * Parse npm registry response (from ?fields=dist-tags endpoint).
 * Returns {latestVersion: string} on success, or {error: string} on failure.
 */
export function parseRegistryResponse(jsonOrString) {
  let json;

  try {
    json = typeof jsonOrString === 'string' ? JSON.parse(jsonOrString) : jsonOrString;
  } catch {
    return { error: 'malformed' };
  }

  if (!json || typeof json !== 'object') return { error: 'malformed' };
  if (!json['dist-tags'] || typeof json['dist-tags'] !== 'object') return { error: 'no-dist-tags' };

  const latest = json['dist-tags'].latest;
  if (!latest || typeof latest !== 'string') return { error: 'no-latest' };

  return { latestVersion: latest };
}

/**
 * Pure time logic: should we check for updates?
 */
export function shouldCheck({ lastCheckedAt, intervalMs, now }) {
  if (lastCheckedAt === null || lastCheckedAt === undefined) return true;
  return now - lastCheckedAt >= intervalMs;
}

/**
 * Detect CI environments.
 */
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

/**
 * Detect if update notifier is disabled.
 */
export function isNotifierDisabled(env) {
  return !!env.NO_UPDATE_NOTIFIER;
}

/**
 * Fetch latest version from npm registry and compare with current.
 */
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

    const json = await res.json();
    const parsed = parseRegistryResponse(json);

    if (parsed.error) {
      return { error: parsed.error, currentVersion };
    }

    const { latestVersion } = parsed;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return { updateAvailable, latestVersion, currentVersion };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('timed out')) {
      return { error: 'timeout', currentVersion };
    }

    return { error: 'network', currentVersion };
  }
}
