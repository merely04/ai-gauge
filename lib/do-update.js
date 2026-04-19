import { buildUpdateCommand } from './install-source.js';
import { copyToClipboard } from './clipboard.js';

const ERROR_PATTERNS = [
  [/EACCES|permission denied/i, 'permission'],
  [/ENOENT|command not found/i, 'tool-missing'],
  [/E404|not found.*404/i, 'not-found'],
  [/ETIMEDOUT|timed out|timeout/i, 'timeout'],
];

export async function runUpdate({
  installSource,
  packageName = 'ai-gauge',
  spawnFn = Bun.spawn,
  clipboardFn = copyToClipboard,
  timeoutMs = 120_000,
  env = process.env,
} = {}) {
  const { cmd, displayString } = buildUpdateCommand(installSource, packageName);

  if (installSource === 'brew') {
    const clipResult = await safeCopyToClipboard(clipboardFn, displayString);
    return {
      success: false,
      reason: 'manual-required',
      command: displayString,
      clipboardCopied: clipResult.success,
    };
  }

  const childEnv = buildChildEnv(env);

  let proc;
  try {
    proc = spawnFn(cmd, {
      env: childEnv,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (spawnErr) {
    const reason = classifyError(String(spawnErr));
    const clipResult = await safeCopyToClipboard(clipboardFn, displayString);
    return {
      success: false,
      reason,
      command: displayString,
      clipboardCopied: clipResult.success,
      stderr: String(spawnErr).slice(0, 500),
    };
  }

  const stderrPromise = readStreamSafe(proc.stderr);

  let exitCode;
  let timedOut = false;
  try {
    exitCode = await waitForExit(proc, timeoutMs);
  } catch {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
    proc.exited.catch(() => {});
    const clipResult = await safeCopyToClipboard(clipboardFn, displayString);
    return {
      success: false,
      reason: 'timeout',
      command: displayString,
      clipboardCopied: clipResult.success,
    };
  }

  if (exitCode === 0) {
    return { success: true, reason: 'completed' };
  }

  const stderrText = await stderrPromise;
  const stderrTail = stderrText.slice(-500);
  const reason = classifyError(stderrTail);
  const clipResult = await safeCopyToClipboard(clipboardFn, displayString);

  return {
    success: false,
    reason,
    command: displayString,
    clipboardCopied: clipResult.success,
    stderr: stderrTail,
  };
}

function buildChildEnv(sourceEnv) {
  const SECRET_PATTERN = /TOKEN|KEY|SECRET|CREDENTIAL|AUTH|PASSWORD|PASSPHRASE/i;
  const filtered = {};
  for (const key of Object.keys(sourceEnv)) {
    if (SECRET_PATTERN.test(key)) continue;
    filtered[key] = sourceEnv[key];
  }
  filtered.AIGAUGE_UPDATING = '1';
  return filtered;
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('spawn-timeout')), timeoutMs);

    proc.exited.then(
      (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readStreamSafe(stream) {
  if (!stream) return '';
  try {
    return await new Response(stream).text();
  } catch {
    return '';
  }
}

function classifyError(text) {
  for (const [pattern, reason] of ERROR_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return 'unknown';
}

async function safeCopyToClipboard(clipboardFn, text) {
  try {
    return await clipboardFn(text);
  } catch {
    return { success: false };
  }
}
