import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HOME = Bun.env.HOME || process.env.HOME;
const platform = process.platform;

export function getCacheDir() {
  let dir;
  if (platform === 'darwin') {
    dir = join(HOME, 'Library', 'Caches', 'ai-gauge');
  } else {
    // Linux: XDG_CACHE_HOME fallback to ~/.cache
    const xdg = Bun.env.XDG_CACHE_HOME || join(HOME, '.cache');
    dir = join(xdg, 'ai-gauge');
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getStateDir() {
  let dir;
  if (platform === 'darwin') {
    const tmpdir = Bun.env.TMPDIR || '/tmp';
    // Remove trailing slash if present
    dir = join(tmpdir.replace(/\/$/, ''), 'ai-gauge');
  } else {
    const xdg = Bun.env.XDG_RUNTIME_DIR || '/tmp';
    dir = join(xdg, 'ai-gauge');
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigDir() {
  // Always ~/.config/ai-gauge — same on both platforms
  const dir = join(HOME, '.config', 'ai-gauge');
  mkdirSync(dir, { recursive: true });
  return dir;
}
