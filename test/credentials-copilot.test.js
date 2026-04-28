import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGhHostsYaml,
  readGhAuthTokenViaSpawn,
  readCopilotCredentials,
} from '../lib/credentials-copilot.js';

function createTempDir() {
  const tempDir = `/tmp/copilot-cred-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function makeMockProc({ stdout = '', exitCode = 0, exitDelayMs = 0 } = {}) {
  const stdoutStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stdout));
      controller.close();
    },
  });
  const stderrStream = new ReadableStream({
    start(controller) { controller.close(); },
  });

  const exitedPromise = exitDelayMs > 0
    ? new Promise((resolve) => setTimeout(() => resolve(exitCode), exitDelayMs))
    : Promise.resolve(exitCode);

  return {
    exited: exitedPromise,
    stdout: stdoutStream,
    stderr: stderrStream,
    kill: () => {},
  };
}

function withMockedSpawn(mockImpl, fn) {
  const original = Bun.spawn;
  Bun.spawn = mockImpl;
  return Promise.resolve(fn()).finally(() => {
    Bun.spawn = original;
  });
}

describe('parseGhHostsYaml', () => {
  it('extracts gho_ token from a realistic hosts.yml block', () => {
    const text = `github.com:
    user: someone
    oauth_token: gho_realtoken123
    git_protocol: ssh
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_realtoken123',
      mode: 'plaintext',
    });
  });

  it('strips surrounding double quotes from oauth_token value', () => {
    const text = `github.com:
    oauth_token: "gho_quotedtoken456"
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_quotedtoken456',
      mode: 'plaintext',
    });
  });

  it('strips surrounding single quotes from oauth_token value', () => {
    const text = `github.com:
    oauth_token: 'gho_singlequoted'
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_singlequoted',
      mode: 'plaintext',
    });
  });

  it('returns only the github.com token in multi-host config (skips ghe.example.com)', () => {
    const text = `ghe.example.com:
    user: enterprise-user
    oauth_token: ghe_enterprisetoken
github.com:
    user: someone
    oauth_token: gho_correctone
    git_protocol: ssh
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_correctone',
      mode: 'plaintext',
    });
  });

  it('ignores comment-only lines inside the github.com block', () => {
    const text = `# top-level comment
github.com:
    # inner comment about user
    user: someone
    # inner comment about token
    oauth_token: gho_with_comments
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_with_comments',
      mode: 'plaintext',
    });
  });

  it('returns mode=unknown for an empty file', () => {
    expect(parseGhHostsYaml('')).toEqual({ token: null, mode: 'unknown' });
  });

  it('returns mode=keychain when oauth_token value is the literal "keyring"', () => {
    const text = `github.com:
    oauth_token: keyring
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'keychain' });
  });

  it('returns mode=keychain when github.com block has user but no oauth_token line', () => {
    const text = `github.com:
    user: someone
    git_protocol: ssh
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'keychain' });
  });

  it('returns mode=keychain when oauth_token value is empty string', () => {
    const text = `github.com:
    oauth_token: ""
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'keychain' });
  });

  it('rejects ghp_ classic PAT prefix (mode=unknown)', () => {
    const text = `github.com:
    oauth_token: ghp_classicPAT123
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'unknown' });
  });

  it('rejects github_pat_ fine-grained PAT prefix (mode=unknown)', () => {
    const text = `github.com:
    oauth_token: github_pat_finegrained456
    user: someone
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'unknown' });
  });

  it('returns mode=unknown when only enterprise host is present (no github.com block)', () => {
    const text = `ghe.example.com:
    user: enterprise-user
    oauth_token: ghe_xxx
    git_protocol: ssh
`;
    expect(parseGhHostsYaml(text)).toEqual({ token: null, mode: 'unknown' });
  });

  it('handles oauth_token with trailing whitespace correctly', () => {
    const text = `github.com:
    user: someone
    oauth_token: gho_trailing_ws_token   
`;
    expect(parseGhHostsYaml(text)).toEqual({
      token: 'gho_trailing_ws_token',
      mode: 'plaintext',
    });
  });

  it('returns mode=unknown for non-string input', () => {
    expect(parseGhHostsYaml(null)).toEqual({ token: null, mode: 'unknown' });
    expect(parseGhHostsYaml(undefined)).toEqual({ token: null, mode: 'unknown' });
    expect(parseGhHostsYaml(123)).toEqual({ token: null, mode: 'unknown' });
  });
});

describe('readGhAuthTokenViaSpawn', () => {
  it('returns the trimmed token when gh exits 0 with a gho_ stdout', async () => {
    await withMockedSpawn(
      () => makeMockProc({ stdout: 'gho_spawnedtoken123\n', exitCode: 0 }),
      async () => {
        const token = await readGhAuthTokenViaSpawn();
        expect(token).toBe('gho_spawnedtoken123');
      },
    );
  });

  it('returns null when gh exits non-zero', async () => {
    await withMockedSpawn(
      () => makeMockProc({ stdout: '', exitCode: 1 }),
      async () => {
        const token = await readGhAuthTokenViaSpawn();
        expect(token).toBeNull();
      },
    );
  });

  it('returns null when stdout token has invalid prefix (e.g. ghp_)', async () => {
    await withMockedSpawn(
      () => makeMockProc({ stdout: 'ghp_classicPAT\n', exitCode: 0 }),
      async () => {
        const token = await readGhAuthTokenViaSpawn();
        expect(token).toBeNull();
      },
    );
  });

  it('returns null when Bun.spawn itself throws (binary not found)', async () => {
    await withMockedSpawn(
      () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; },
      async () => {
        const token = await readGhAuthTokenViaSpawn();
        expect(token).toBeNull();
      },
    );
  });

  it('passes the hostname argument through to gh', async () => {
    let capturedArgs = null;
    await withMockedSpawn(
      (args) => {
        capturedArgs = args;
        return makeMockProc({ stdout: 'gho_hostnamearg\n', exitCode: 0 });
      },
      async () => {
        await readGhAuthTokenViaSpawn('ghe.example.com');
      },
    );
    expect(capturedArgs).toEqual(['gh', 'auth', 'token', '--hostname', 'ghe.example.com']);
  });
});

describe('readCopilotCredentials integration (HOME-isolated)', () => {
  let tempDir;
  let originalHome;
  let originalSpawn;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalSpawn = Bun.spawn;
    tempDir = createTempDir();
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      tempDir = undefined;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('Tier 1 short-circuits: returns gh-cli-spawn when gh CLI succeeds', async () => {
    Bun.spawn = () => makeMockProc({ stdout: 'gho_tier1wins\n', exitCode: 0 });

    ensureDir(join(tempDir, '.config', 'gh'));
    writeFileSync(
      join(tempDir, '.config', 'gh', 'hosts.yml'),
      `github.com:\n    oauth_token: gho_tier2should_not_win\n    user: someone\n`,
    );

    const result = await readCopilotCredentials();
    expect(result).toEqual({ token: 'gho_tier1wins', source: 'gh-cli-spawn' });
  });

  it('Tier 2 takes over when gh shell-out fails: gh-cli-file source', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };

    ensureDir(join(tempDir, '.config', 'gh'));
    writeFileSync(
      join(tempDir, '.config', 'gh', 'hosts.yml'),
      `github.com:\n    user: someone\n    oauth_token: gho_fromfile789\n    git_protocol: ssh\n`,
    );

    const result = await readCopilotCredentials();
    expect(result).toEqual({ token: 'gho_fromfile789', source: 'gh-cli-file' });
  });

  it('Tier 3 PAT file used when gh fails AND hosts.yml is missing', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };

    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    writeFileSync(
      join(tempDir, '.config', 'ai-gauge', 'copilot-token'),
      'gho_headlesstoken\n',
    );

    const result = await readCopilotCredentials();
    expect(result).toEqual({ token: 'gho_headlesstoken', source: 'pat' });
  });

  it('Tier 3 rejects classic ghp_ PAT and returns null', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };

    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    writeFileSync(
      join(tempDir, '.config', 'ai-gauge', 'copilot-token'),
      'ghp_classicPAT123\n',
    );

    const result = await readCopilotCredentials();
    expect(result).toBeNull();
  });

  it('Tier 3 rejects fine-grained github_pat_ token and returns null', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };

    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    writeFileSync(
      join(tempDir, '.config', 'ai-gauge', 'copilot-token'),
      'github_pat_finegrained789\n',
    );

    const result = await readCopilotCredentials();
    expect(result).toBeNull();
  });

  it('returns null when all three tiers fail (empty HOME)', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };
    const result = await readCopilotCredentials();
    expect(result).toBeNull();
  });

  it('Tier 2 keychain mode (no oauth_token in hosts.yml) does NOT short-circuit to PAT', async () => {
    Bun.spawn = () => { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; throw e; };

    ensureDir(join(tempDir, '.config', 'gh'));
    writeFileSync(
      join(tempDir, '.config', 'gh', 'hosts.yml'),
      `github.com:\n    user: someone\n    git_protocol: ssh\n`,
    );

    ensureDir(join(tempDir, '.config', 'ai-gauge'));
    writeFileSync(
      join(tempDir, '.config', 'ai-gauge', 'copilot-token'),
      'gho_patbackup\n',
    );

    const result = await readCopilotCredentials();
    expect(result).toEqual({ token: 'gho_patbackup', source: 'pat' });
  });
});
