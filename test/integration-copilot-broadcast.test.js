import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const copilotFixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/copilot-individual-pro-happy.json'), 'utf8'));
const anthropicFixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/providers/anthropic-happy.json'), 'utf8'));

let fetchUsage;
let setFetchImpl;
let stateDir;

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2);
  process.env.TMPDIR = `/tmp/ai-gauge-copilot-${suffix}/`;
  stateDir = `${process.env.TMPDIR}ai-gauge`;
  mkdirSync(stateDir, { recursive: true });

  const serverModule = await import(`../bin/ai-gauge-server?copilot-broadcast=${suffix}`);
  fetchUsage = serverModule.fetchUsage;
  setFetchImpl = serverModule.setFetchImpl;
});

afterEach(() => {
  setFetchImpl(null);
  try { rmSync(process.env.TMPDIR, { recursive: true, force: true }); } catch {}
  mkdirSync(stateDir, { recursive: true });
});

describe('fetchUsage copilot persistence', () => {
  it('writes copilot field with copilot meta provider and protocolVersion 4', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(copilotFixture), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await fetchUsage({
      token: 'FAKE_GH_TOKEN',
      expiresAt: null,
      provider: 'copilot',
      tokenSource: 'github',
      baseUrl: null,
      subscriptionType: 'unknown',
    }, {
      tokenSource: 'github',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: true,
    });

    expect(result).toBe(true);

    const persisted = JSON.parse(readFileSync(join(stateDir, 'usage.json'), 'utf8'));
    expect(persisted.copilot.plan).toBe('pro');
    expect(persisted.meta.provider).toBe('copilot');
    expect(persisted.meta.protocolVersion).toBe(4);
  });

  it('writes copilot field via opencode copilotSecondary when both Anthropic and github-copilot present', async () => {
    setFetchImpl(async (url) => {
      const isCopilotEndpoint = typeof url === 'string' && url.includes('copilot_internal/v2/token');
      const fixture = isCopilotEndpoint ? copilotFixture : anthropicFixture;
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await fetchUsage({
      token: 'ant-token',
      expiresAt: Date.now() + 3600000,
      provider: 'anthropic',
      tokenSource: 'opencode',
      baseUrl: null,
      subscriptionType: 'unknown',
      copilotSecondary: {
        provider: 'copilot',
        token: 'gho_realtoken123',
        expiresAt: null,
        enterpriseUrl: null,
      },
    }, {
      tokenSource: 'opencode',
      plan: 'unknown',
      displayMode: 'full',
      autoCheckUpdates: true,
    });

    expect(result).toBe(true);

    const persisted = JSON.parse(readFileSync(join(stateDir, 'usage.json'), 'utf8'));
    expect(persisted.five_hour).toBeTruthy();
    expect(persisted.copilot).toBeTruthy();
    expect(persisted.copilot.plan).toBe('pro');
    expect(persisted.copilot.premium_interactions.limit).toBe(300);
    expect(persisted.meta.provider).toBe('anthropic');
  });
});
