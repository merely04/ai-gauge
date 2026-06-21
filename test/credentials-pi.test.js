import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readPiCredentials } from '../lib/credentials-pi.js';

const future = () => Date.now() + 3600000;
const past = () => Date.now() - 3600000;

let tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs = [];
});

function createTempDir() {
  const dir = `/tmp/pi-cred-test-${Math.random().toString(36).slice(2, 9)}`;
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function setup({ auth, authRaw, settings } = {}) {
  const dir = createTempDir();
  const authPath = join(dir, 'auth.json');
  const settingsPath = join(dir, 'settings.json');

  if (authRaw !== undefined) {
    writeFileSync(authPath, authRaw);
  } else if (auth !== undefined) {
    writeFileSync(authPath, JSON.stringify(auth));
  }

  if (settings !== undefined) {
    writeFileSync(settingsPath, JSON.stringify(settings));
  }

  return { authPath, settingsPath };
}

describe('readPiCredentials', () => {
  it('anthropic-only → primary anthropic, secondary null, copilotSecondary null', async () => {
    const { authPath, settingsPath } = setup({
      auth: { anthropic: { type: 'oauth', access: 'ant-tok', expires: future() } },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result).not.toBeNull();
    expect(result.provider).toBe('anthropic');
    expect(result.token).toBe('ant-tok');
    expect(result.subscriptionType).toBe('unknown');
    expect(result.baseUrl).toBeNull();
    expect(result.secondary).toBeNull();
    expect(result.copilotSecondary).toBeNull();
    expect(result.account_id).toBeUndefined();
  });

  it('anthropic+codex+zai+copilot with NO defaultProvider → primary anthropic, secondary codex (account_id set), copilotSecondary set', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'acc-1', expires: future() },
        zai: { type: 'api_key', key: 'zai-key' },
        'github-copilot': { type: 'oauth', access: 'gho_x', expires: future() },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.token).toBe('ant');

    expect(result.secondary).not.toBeNull();
    expect(result.secondary.provider).toBe('codex');
    expect(result.secondary.token).toBe('cdx');
    expect(result.secondary.account_id).toBe('acc-1');
    expect(result.secondary.baseUrl).toBeUndefined();

    expect(result.copilotSecondary).not.toBeNull();
    expect(result.copilotSecondary.provider).toBe('copilot');
    expect(result.copilotSecondary.token).toBe('gho_x');

    expect(result.secondary.provider).not.toBe(result.provider);
    expect(result.secondary.provider).not.toBe('copilot');
  });

  it("defaultProvider='zai' (anthropic+zai+codex+copilot) → primary zai, secondary anthropic, copilotSecondary set", async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        zai: { type: 'api_key', key: 'zk' },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
        'github-copilot': { type: 'oauth', access: 'gho', expires: future() },
      },
      settings: { defaultProvider: 'zai' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('zai');
    expect(result.token).toBe('zk');
    expect(result.baseUrl).toBe('https://api.z.ai');
    expect(result.expiresAt).toBeNull();

    expect(result.secondary).not.toBeNull();
    expect(result.secondary.provider).toBe('anthropic');
    expect(result.secondary.token).toBe('ant');
    expect(result.secondary.account_id).toBeUndefined();
    expect(result.secondary.baseUrl).toBeUndefined();

    expect(result.copilotSecondary).not.toBeNull();
    expect(result.copilotSecondary.provider).toBe('copilot');

    expect(result.secondary.provider).not.toBe(result.provider);
    expect(result.secondary.provider).not.toBe('copilot');
  });

  it("defaultProvider='ollama-cloud' (unsupported) + anthropic+codex → fallback primary anthropic, secondary codex", async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
      },
      settings: { defaultProvider: 'ollama-cloud' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.secondary).not.toBeNull();
    expect(result.secondary.provider).toBe('codex');
  });

  it("defaultProvider='anthropic' but anthropic EXPIRED → falls back to codex as primary", async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: past() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'acc-z', expires: future() },
      },
      settings: { defaultProvider: 'anthropic' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('codex');
    expect(result.account_id).toBe('acc-z');
    expect(result.secondary).toBeNull();
    expect(result.copilotSecondary).toBeNull();
  });

  it('zai-primary → expiresAt null, baseUrl https://api.z.ai, token=key', async () => {
    const { authPath, settingsPath } = setup({
      auth: { zai: { type: 'api_key', key: 'zk-solo' } },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('zai');
    expect(result.token).toBe('zk-solo');
    expect(result.baseUrl).toBe('https://api.z.ai');
    expect(result.expiresAt).toBeNull();
    expect(result.secondary).toBeNull();
    expect(result.copilotSecondary).toBeNull();
  });

  it('codex-primary → account_id set; expiresAt === Infinity when expires absent', async () => {
    const { authPath, settingsPath } = setup({
      auth: { 'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'acc-9' } },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('codex');
    expect(result.token).toBe('cdx');
    expect(result.account_id).toBe('acc-9');
    expect(result.expiresAt).toBe(Infinity);
    expect(result.baseUrl).toBeNull();
    expect(result.secondary).toBeNull();
  });

  it('openrouter-primary → baseUrl null, token=key, expiresAt null', async () => {
    const { authPath, settingsPath } = setup({
      auth: { openrouter: { type: 'api_key', key: 'or-key' } },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('openrouter');
    expect(result.token).toBe('or-key');
    expect(result.baseUrl).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(result.account_id).toBeUndefined();
  });

  it('copilot-only → primary provider copilot, token=access, copilotSecondary null', async () => {
    const { authPath, settingsPath } = setup({
      auth: { 'github-copilot': { type: 'oauth', access: 'gho_only', expires: future() } },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('copilot');
    expect(result.token).toBe('gho_only');
    expect(result.baseUrl).toBeNull();
    expect(result.secondary).toBeNull();
    expect(result.copilotSecondary).toBeNull();
  });

  it('github-copilot WITH enterpriseUrl + anthropic present → copilotSecondary null (skipped), primary anthropic', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'github-copilot': {
          type: 'oauth',
          access: 'gho',
          expires: future(),
          enterpriseUrl: 'https://ghe.corp.example.com',
        },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.copilotSecondary).toBeNull();
  });

  it('only ollama-cloud/synthetic (unsupported) → returns null', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        'ollama-cloud': { type: 'oauth', access: 'x', expires: future() },
        synthetic: { type: 'api_key', key: 'y' },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result).toBeNull();
  });

  it('malformed auth.json (invalid JSON) → returns null', async () => {
    const { authPath, settingsPath } = setup({ authRaw: 'not valid json {]' });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result).toBeNull();
  });

  it('missing auth.json → returns null', async () => {
    const { authPath, settingsPath } = setup({});

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result).toBeNull();
  });

  it('missing settings.json → proceeds using priority fallback', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        zai: { type: 'api_key', key: 'zk' },
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.secondary.provider).toBe('zai');
    expect(result.secondary.baseUrl).toBe('https://api.z.ai');
  });

  it('malformed settings.json → ignored, priority fallback applies', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
      },
    });
    writeFileSync(settingsPath, 'not valid json {]');

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.secondary.provider).toBe('codex');
  });

  it('empty-string access (oauth) is unusable → block skipped', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: '', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('codex');
    expect(result.secondary).toBeNull();
  });

  it('empty-string key (api_key) is unusable → block skipped', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        zai: { type: 'api_key', key: '' },
        openrouter: { type: 'api_key', key: 'or-key' },
      },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('openrouter');
    expect(result.secondary).toBeNull();
  });

  it('all four rate/balance providers usable → secondary is highest non-primary, never copilot, never primary', async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
        zai: { type: 'api_key', key: 'zk' },
        openrouter: { type: 'api_key', key: 'or' },
        'github-copilot': { type: 'oauth', access: 'gho', expires: future() },
      },
      settings: { defaultProvider: 'openrouter' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('openrouter');
    expect(result.secondary).not.toBeNull();
    expect(result.secondary.provider).toBe('anthropic');
    expect(result.secondary.provider).not.toBe(result.provider);
    expect(result.secondary.provider).not.toBe('copilot');
    expect(result.copilotSecondary).not.toBeNull();
    expect(result.copilotSecondary.provider).toBe('copilot');
  });

  it("defaultProvider='openai-codex' (pi-key form) normalizes to codex primary", async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'openai-codex': { type: 'oauth', access: 'cdx', accountId: 'a', expires: future() },
      },
      settings: { defaultProvider: 'openai-codex' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('codex');
    expect(result.account_id).toBe('a');
    expect(result.secondary.provider).toBe('anthropic');
  });

  it("defaultProvider='github-copilot' with usable anthropic → copilot NOT primary (anthropic wins)", async () => {
    const { authPath, settingsPath } = setup({
      auth: {
        anthropic: { type: 'oauth', access: 'ant', expires: future() },
        'github-copilot': { type: 'oauth', access: 'gho', expires: future() },
      },
      settings: { defaultProvider: 'github-copilot' },
    });

    const result = await readPiCredentials(authPath, settingsPath);

    expect(result.provider).toBe('anthropic');
    expect(result.copilotSecondary).not.toBeNull();
    expect(result.copilotSecondary.provider).toBe('copilot');
  });
});
