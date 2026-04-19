const platform = process.platform;

export function resolveClipboardCommand(targetPlatform = platform) {
  if (targetPlatform === 'darwin') return ['pbcopy'];
  if (targetPlatform === 'linux') return ['wl-copy'];
  return null;
}

async function runClipboardCommand(cmd, text, spawn = Bun.spawn) {
  const proc = spawn(cmd, { stdin: 'pipe' });

  try {
    proc.stdin.write(text);
    proc.stdin.end();
  } catch (err) {
    if (err?.code !== 'EPIPE') {
      try {
        await proc.exited;
      } catch {}
      return { success: false, error: String(err) };
    }
  }

  const exitCode = await proc.exited;
  if (exitCode === 0) return { success: true };
  return { success: false, error: 'spawn-failed' };
}

async function copyWithFallback(text, spawn) {
  try {
    const result = await runClipboardCommand(['xclip', '-selection', 'clipboard'], text, spawn);
    return result.success ? result : { success: false, error: 'no-clipboard-tool' };
  } catch {
    return { success: false, error: 'no-clipboard-tool' };
  }
}

export async function copyToClipboard(text, { spawn = Bun.spawn } = {}) {
  const cmd = resolveClipboardCommand();
  if (!cmd) return { success: false, error: 'unsupported-platform' };

  try {
    return await runClipboardCommand(cmd, text, spawn);
  } catch (err) {
    if (err?.code === 'ENOENT' || String(err).includes('ENOENT')) {
      if (platform === 'linux' && cmd[0] === 'wl-copy') {
        return copyWithFallback(text, spawn);
      }
      return { success: false, error: 'not-installed' };
    }
    return { success: false, error: String(err) };
  }
}
