import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const META_PROTOCOL_VERSION = 4;
export const PACKAGE_VERSION = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')).version;

export function buildMeta(config, { fetchedAt, subscriptionType, provider } = {}) {
  const plan = config.plan && config.plan !== 'unknown'
    ? config.plan
    : (subscriptionType ?? 'unknown');

  return {
    plan,
    tokenSource: config.tokenSource,
    displayMode: config.displayMode ?? 'full',
    fetchedAt: fetchedAt ?? new Date().toISOString(),
    version: PACKAGE_VERSION,
    protocolVersion: META_PROTOCOL_VERSION,
    autoCheckUpdates: config.autoCheckUpdates ?? true,
    provider: provider ?? 'anthropic',
  };
}
