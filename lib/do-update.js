import { buildUpdateCommand } from './install-source.js';
import { copyToClipboard } from './clipboard.js';

/**
 * Run the update command for the given install source.
 * Returns {success, reason, command?, clipboardCopied?, stderr?}
 */
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

  let proc;
  try {
    proc = spawnFn(cmd, {
      env: { ...env, AIGAUGE_UPDATING: '1' },
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

  try {
    const exitCode = await waitForExit(proc, timeoutMs);

    if (exitCode === 0) {
      return { success: true, reason: 'completed' };
    }
  } catch {
    try {
      proc.kill();
    } catch {}
    const clipResult = await safeCopyToClipboard(clipboardFn, displayString);
    return {
      success: false,
      reason: 'timeout',
      command: displayString,
      clipboardCopied: clipResult.success,
    };
  }

  let stderrText = '';
  try {
    stderrText = await new Response(proc.stderr).text();
  } catch {}
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

function classifyError(text) {
  if (/EACCES|permission denied/i.test(text)) return 'permission';
  if (/ENOENT|command not found/i.test(text)) return 'tool-missing';
  if (/E404|not found.*404/i.test(text)) return 'not-found';
  if (/ETIMEDOUT|timed out|timeout/i.test(text)) return 'timeout';
  return 'unknown';
}

async function safeCopyToClipboard(clipboardFn, text) {
  try {
    return await clipboardFn(text);
  } catch {
    return { success: false };
  }
}
