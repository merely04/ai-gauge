import {
  checkForUpdate,
  readCache,
  shouldSkipUpdateCheck,
  writeCache,
} from './check-update.js';
import { runUpdate } from './do-update.js';
import { detectInstallSource } from './install-source.js';
import { atomicWriteJSON } from './atomic-write.js';
import { compareVersions } from './semver.js';

const GH_REPO_URL = 'https://github.com/merely04/ai-gauge';

export const changelogUrlFor = (fromVersion, toVersion) => {
  if (!fromVersion || fromVersion === toVersion) {
    return `${GH_REPO_URL}/releases/tag/v${toVersion}`;
  }
  return `${GH_REPO_URL}/compare/v${fromVersion}...v${toVersion}`;
};

function getUpdateCacheFilePath(platform) {
  const home = Bun.env.HOME || process.env.HOME;
  if (platform === 'darwin') {
    return `${home}/Library/Caches/ai-gauge/update-check.json`;
  }
  const cacheHome = Bun.env.XDG_CACHE_HOME || `${home}/.cache`;
  return `${cacheHome}/ai-gauge/update-check.json`;
}

export function createUpdateLifecycle({
  packageVersion,
  registryUrl,
  stateDir,
  installBinaryDir,
  fetchTimeoutMs,
  spawnTimeoutMs,
  intervalMs,
  initialDelayMs,
  readConfig,
  broadcast,
  systemNotify,
  logger,
  env = process.env,
  platform = process.platform,
}) {
  const state = {
    checking: false,
    installing: false,
    lastCheckedAt: null,
    latestVersion: null,
    lastNotifiedVersion: null,
    dismissedVersion: null,
    error: null,
    autoCheckUpdatesEnabled: true,
  };
  let timer = null;

  const stateFile = `${stateDir}/update-state.json`;
  const log = logger ?? ((msg) => process.stderr.write(msg + '\n'));

  async function writeStateFile(clear = false) {
    const snapshot = clear
      ? { available: false, version: null, installing: false, error: null, changelogUrl: null, lastUpdatedAt: Date.now() }
      : {
          available: !!state.latestVersion,
          version: state.latestVersion,
          installing: state.installing,
          error: state.error || null,
          changelogUrl: state.latestVersion ? changelogUrlFor(packageVersion, state.latestVersion) : null,
          lastUpdatedAt: Date.now(),
        };
    try {
      await atomicWriteJSON(stateFile, snapshot);
    } catch (err) {
      log(`[update] failed to write state file: ${err?.message || err}`);
    }
  }

  async function doCheck({ manual = false } = {}) {
    if (state.checking && !manual) return;
    const config = await readConfig();
    state.autoCheckUpdatesEnabled = config.autoCheckUpdates !== false;
    const { skip, reason } = shouldSkipUpdateCheck(env, config);

    if (skip && !manual) {
      log(`[update] scheduled update check skipped: ${reason}`);
      return;
    }
    if (skip && manual) {
      log(`[update] manual update check skipped: ${reason}`);
      broadcast({ type: 'updateCheckFailed', reason });
      return;
    }

    state.checking = true;
    try {
      const result = await checkForUpdate({
        currentVersion: packageVersion,
        registryUrl,
        packageName: 'ai-gauge',
        timeoutMs: fetchTimeoutMs,
      });

      if (result.error) {
        log(`[update] check failed: ${result.error}`);
        broadcast({ type: 'updateCheckFailed', reason: result.error });
        return;
      }

      state.lastCheckedAt = Date.now();

    try {
      writeCache(getUpdateCacheFilePath(platform), {
        lastCheckedAt: state.lastCheckedAt,
        latestVersion: result.latestVersion,
        currentVersion: packageVersion,
      });
      } catch (err) {
        log(`[update] failed to write cache: ${err?.message || err}`);
      }

      if (!result.updateAvailable) {
        if (state.lastNotifiedVersion || state.latestVersion) {
          state.lastNotifiedVersion = null;
          state.latestVersion = null;
          await writeStateFile(true);
        }
        return;
      }

      state.latestVersion = result.latestVersion;

      if (state.dismissedVersion && state.dismissedVersion !== result.latestVersion) {
        state.dismissedVersion = null;
      }

      if (state.dismissedVersion === result.latestVersion) {
        return;
      }

      if (state.lastNotifiedVersion !== result.latestVersion) {
        broadcast({
          type: 'updateAvailable',
          currentVersion: packageVersion,
          latestVersion: result.latestVersion,
          changelogUrl: changelogUrlFor(packageVersion, result.latestVersion),
        });
        state.lastNotifiedVersion = result.latestVersion;
        await writeStateFile();
        if (platform === 'linux') {
          await systemNotify({
            title: 'AI Gauge Update',
            message: `v${result.latestVersion} available`,
            urgency: 'normal',
          });
        }
      }
    } finally {
      state.checking = false;
    }
  }

  async function doInstall() {
    if (state.installing) {
      broadcast({ type: 'updateAlreadyInProgress' });
      return;
    }

    state.installing = true;
    state.error = null;
    broadcast({ type: 'updateInstalling', latestVersion: state.latestVersion });
    await writeStateFile();

    const installedTarget = state.latestVersion;
    const installSource = detectInstallSource(installBinaryDir);
    const result = await runUpdate({
      installSource,
      packageName: 'ai-gauge',
      timeoutMs: spawnTimeoutMs,
      env,
    });

    if (result.success) {
      broadcast({
        type: 'updateComplete',
        reason: 'completed',
        fromVersion: packageVersion,
        installedVersion: installedTarget,
      });
      await writeStateFile(true);
      setTimeout(() => process.exit(0), 500);
    } else {
      state.installing = false;
      state.error = result.reason;
      broadcast({
        type: 'updateFailed',
        reason: result.reason,
        command: result.command,
        clipboardCopied: result.clipboardCopied,
      });
      await writeStateFile();
    }
  }

  function schedule(delayMs) {
    cancel();
    timer = setTimeout(async () => {
      await doCheck({ manual: false });
      schedule(intervalMs);
    }, delayMs);
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function isScheduled() {
    return timer !== null;
  }

  async function rehydrateFromCache() {
    try {
      const cacheFile = getUpdateCacheFilePath(platform);
      const cached = readCache(cacheFile);
      if (cached?.latestVersion && cached.currentVersion === packageVersion) {
        if (compareVersions(cached.latestVersion, packageVersion) > 0) {
          state.latestVersion = cached.latestVersion;
          state.lastNotifiedVersion = cached.latestVersion;
        }
        state.lastCheckedAt = cached.lastCheckedAt;
        if (cached.dismissedVersion) {
          state.dismissedVersion = cached.dismissedVersion;
        }
      } else if (cached?.currentVersion && cached.currentVersion !== packageVersion) {
        log(`[update] package upgraded from ${cached.currentVersion} to ${packageVersion}; clearing stale cache`);
        try {
          writeCache(cacheFile, { lastCheckedAt: null, latestVersion: null, currentVersion: packageVersion });
        } catch {}
        await writeStateFile(true);
      }
    } catch (err) {
      log(`[update] failed to read cache: ${err?.message || err}`);
    }
  }

  async function dismiss(version) {
    if (!version) return { dismissed: false, reason: 'no-version' };
    state.dismissedVersion = version;
    if (state.lastNotifiedVersion === version) {
      state.lastNotifiedVersion = null;
    }
    try {
      writeCache(getUpdateCacheFilePath(platform), {
        lastCheckedAt: state.lastCheckedAt,
        latestVersion: state.latestVersion,
        currentVersion: packageVersion,
        dismissedVersion: version,
      });
    } catch (err) {
      log(`[update] failed to persist dismiss: ${err?.message || err}`);
    }
    await writeStateFile(true);
    return { dismissed: true, version };
  }

  async function undismiss() {
    if (!state.dismissedVersion) return { undismissed: false };
    const previous = state.dismissedVersion;
    state.dismissedVersion = null;
    try {
      writeCache(getUpdateCacheFilePath(platform), {
        lastCheckedAt: state.lastCheckedAt,
        latestVersion: state.latestVersion,
        currentVersion: packageVersion,
        dismissedVersion: null,
      });
    } catch {}
    return { undismissed: true, previous };
  }

  function getState() {
    return { ...state };
  }

  function buildAvailablePayload() {
    if (!state.autoCheckUpdatesEnabled) return null;
    if (!state.latestVersion || state.lastNotifiedVersion !== state.latestVersion) return null;
    if (state.dismissedVersion === state.latestVersion) return null;
    if (compareVersions(state.latestVersion, packageVersion) <= 0) return null;
    return {
      type: 'updateAvailable',
      currentVersion: packageVersion,
      latestVersion: state.latestVersion,
      changelogUrl: changelogUrlFor(packageVersion, state.latestVersion),
    };
  }

  async function start() {
    const config = await readConfig();
    state.autoCheckUpdatesEnabled = config.autoCheckUpdates !== false;
    await rehydrateFromCache();
    log(`[update] update check scheduled in ${initialDelayMs}ms`);
    schedule(initialDelayMs);
  }

  return {
    doCheck,
    doInstall,
    dismiss,
    undismiss,
    schedule,
    cancel,
    isScheduled,
    getState,
    buildAvailablePayload,
    start,
  };
}
