import {
  checkForUpdate,
  getCacheFilePath,
  readCache,
  shouldSkipUpdateCheck,
  writeCache,
} from './check-update.js';
import { runUpdate } from './do-update.js';
import { detectInstallSource } from './install-source.js';
import { atomicWriteJSON } from './atomic-write.js';

const changelogUrlFor = (version) => `https://github.com/mere1y/ai-gauge/releases/tag/v${version}`;

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
    error: null,
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
          changelogUrl: state.latestVersion ? changelogUrlFor(state.latestVersion) : null,
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
      state.latestVersion = result.latestVersion;

      try {
        writeCache(getCacheFilePath(), {
          lastCheckedAt: state.lastCheckedAt,
          latestVersion: result.latestVersion,
          currentVersion: packageVersion,
        });
      } catch (err) {
        log(`[update] failed to write cache: ${err?.message || err}`);
      }

      if (!result.updateAvailable) {
        if (state.lastNotifiedVersion) {
          state.lastNotifiedVersion = null;
          await writeStateFile(true);
        }
        return;
      }

      if (state.lastNotifiedVersion !== result.latestVersion) {
        broadcast({
          type: 'updateAvailable',
          currentVersion: packageVersion,
          latestVersion: result.latestVersion,
          changelogUrl: changelogUrlFor(result.latestVersion),
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

    const installSource = detectInstallSource(installBinaryDir);
    const result = await runUpdate({
      installSource,
      packageName: 'ai-gauge',
      timeoutMs: spawnTimeoutMs,
      env,
    });

    if (result.success) {
      broadcast({ type: 'updateComplete', reason: 'completed' });
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
      const cacheFile = getCacheFilePath();
      const cached = readCache(cacheFile);
      if (cached?.latestVersion && cached.currentVersion === packageVersion) {
        state.latestVersion = cached.latestVersion;
        state.lastNotifiedVersion = cached.latestVersion;
        state.lastCheckedAt = cached.lastCheckedAt;
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

  function getState() {
    return { ...state };
  }

  function buildAvailablePayload() {
    if (!state.latestVersion || state.lastNotifiedVersion !== state.latestVersion) return null;
    return {
      type: 'updateAvailable',
      currentVersion: packageVersion,
      latestVersion: state.latestVersion,
      changelogUrl: changelogUrlFor(state.latestVersion),
    };
  }

  async function start() {
    await rehydrateFromCache();
    log(`[update] update check scheduled in ${initialDelayMs}ms`);
    schedule(initialDelayMs);
  }

  return {
    doCheck,
    doInstall,
    schedule,
    cancel,
    isScheduled,
    getState,
    buildAvailablePayload,
    start,
  };
}
