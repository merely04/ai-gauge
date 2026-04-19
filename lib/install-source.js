import { realpathSync } from 'node:fs';

const VALID_SOURCES = new Set(['npm', 'bun', 'pnpm', 'brew', 'yarn', 'unknown']);

const DETECTION_PATTERNS = [
  [/\/\.bun\/install\//, 'bun'],
  [/\/bun\/install\//, 'bun'],
  [/\/\.local\/share\/pnpm\/global\//, 'pnpm'],
  [/\/pnpm\/global\//, 'pnpm'],
  [/\/opt\/homebrew\//, 'brew'],
  [/\/usr\/local\/Cellar\//, 'brew'],
  [/\/home\/linuxbrew\/\.linuxbrew\//, 'brew'],
  [/\/\.yarn\/global\//, 'yarn'],
  [/\/yarn\/global\//, 'yarn'],
];

export function detectInstallSource(binaryPath) {
  const envOverride = Bun.env.AIGAUGE_INSTALL_SOURCE;
  if (envOverride) {
    if (!VALID_SOURCES.has(envOverride)) {
      process.stderr.write(
        `[install-source] invalid AIGAUGE_INSTALL_SOURCE=${envOverride}; falling back to path detection\n`,
      );
    } else {
      return envOverride;
    }
  }

  let resolvedPath;
  try {
    resolvedPath = realpathSync(binaryPath);
  } catch {
    resolvedPath = binaryPath;
  }

  for (const [pattern, source] of DETECTION_PATTERNS) {
    if (pattern.test(resolvedPath)) return source;
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
