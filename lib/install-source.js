import { realpathSync } from 'node:fs';

export function detectInstallSource(binaryPath) {
  const envOverride = Bun.env.AIGAUGE_INSTALL_SOURCE;
  if (envOverride) return envOverride;

  let resolvedPath;
  try {
    resolvedPath = realpathSync(binaryPath);
  } catch {
    resolvedPath = binaryPath;
  }

  if (resolvedPath.includes('/.bun/') || resolvedPath.includes('/bun/install/')) {
    return 'bun';
  }
  if (resolvedPath.includes('/.local/share/pnpm/') || resolvedPath.includes('/pnpm/')) {
    return 'pnpm';
  }
  if (
    resolvedPath.includes('/opt/homebrew/') ||
    resolvedPath.includes('/usr/local/Cellar/') ||
    resolvedPath.includes('/linuxbrew/')
  ) {
    return 'brew';
  }
  if (resolvedPath.includes('/.yarn/') || resolvedPath.includes('/yarn/global/')) {
    return 'yarn';
  }
  return 'npm';
}

export function buildUpdateCommand(source, packageName) {
  const npmCmd = Bun.env.AIGAUGE_NPM_COMMAND || 'npm';

  const commands = {
    npm: { cmd: [npmCmd, 'install', '-g', packageName], displayString: `npm install -g ${packageName}` },
    bun: { cmd: ['bun', 'add', '-g', packageName], displayString: `bun add -g ${packageName}` },
    pnpm: { cmd: ['pnpm', 'add', '-g', packageName], displayString: `pnpm add -g ${packageName}` },
    brew: { cmd: ['brew', 'upgrade', packageName], displayString: `brew upgrade ${packageName}` },
    yarn: { cmd: ['yarn', 'global', 'add', packageName], displayString: `yarn global add ${packageName}` },
    unknown: { cmd: [npmCmd, 'install', '-g', packageName], displayString: `npm install -g ${packageName}` },
  };

  return commands[source] || commands.npm;
}
