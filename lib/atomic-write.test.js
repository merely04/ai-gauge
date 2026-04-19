import { describe, expect, test, afterEach } from 'bun:test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJSON } from './atomic-write.js';

const TMP_BASE = join('/tmp', `atomic-write-test-${Date.now()}`);

afterEach(() => {
  try {
    unlinkSync(TMP_BASE);
  } catch {}
  try {
    unlinkSync(`${TMP_BASE}.tmp`);
  } catch {}
});

describe('atomicWriteJSON', () => {
  test('writes JSON to target path', async () => {
    await atomicWriteJSON(TMP_BASE, { hello: 'world' });
    const text = readFileSync(TMP_BASE, 'utf8');
    expect(JSON.parse(text)).toEqual({ hello: 'world' });
  });

  test('creates parent directories recursively', async () => {
    const nested = join('/tmp', `atomic-nested-${Date.now()}`, 'a', 'b', 'c.json');
    await atomicWriteJSON(nested, { a: 1 });
    expect(existsSync(nested)).toBe(true);
    unlinkSync(nested);
  });

  test('supports indent option', async () => {
    await atomicWriteJSON(TMP_BASE, { a: 1, b: 2 }, { indent: 2 });
    const text = readFileSync(TMP_BASE, 'utf8');
    expect(text).toContain('\n  "a"');
  });

  test('validate success allows rename', async () => {
    await atomicWriteJSON(
      TMP_BASE,
      { ok: true },
      { validate: (parsed) => parsed?.ok === true },
    );
    expect(existsSync(TMP_BASE)).toBe(true);
  });

  test('validate failure throws and cleans temp', async () => {
    await expect(
      atomicWriteJSON(TMP_BASE, { ok: false }, { validate: (p) => p?.ok === true }),
    ).rejects.toThrow(/validation failed/);
    expect(existsSync(TMP_BASE)).toBe(false);
    expect(existsSync(`${TMP_BASE}.tmp`)).toBe(false);
  });

  test('overwrites existing file atomically', async () => {
    writeFileSync(TMP_BASE, JSON.stringify({ old: true }));
    await atomicWriteJSON(TMP_BASE, { old: false, fresh: 1 });
    expect(JSON.parse(readFileSync(TMP_BASE, 'utf8'))).toEqual({ old: false, fresh: 1 });
  });
});
