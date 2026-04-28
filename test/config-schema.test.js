import { describe, test, expect } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { validateConfigChange, applyConfigChange, readConfig, VALID_KEYS, VALID_VALUES, TOKEN_SOURCE_PATTERN } from "../lib/config.js";

describe("config schema: displayMode validation", () => {
  test("accepts all 5 valid displayMode values", () => {
    const valid = ['full', 'percent-only', 'bar-dots', 'number-bar', 'time-to-reset'];
    for (const v of valid) {
      const r = validateConfigChange('displayMode', v);
      expect(r.valid).toBe(true);
    }
  });

  test("rejects invalid displayMode value", () => {
    const r = validateConfigChange('displayMode', 'banana');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid value=banana for key=displayMode');
  });

  test("rejects numeric displayMode value", () => {
    const r = validateConfigChange('displayMode', 42);
    expect(r.valid).toBe(false);
  });

  test("rejects unknown key", () => {
    const r = validateConfigChange('unknownKey', 'anything');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('invalid key=unknownKey');
  });

  test("displayMode is in VALID_KEYS", () => {
    expect(VALID_KEYS).toContain('displayMode');
  });

  test("VALID_VALUES.displayMode has 5 entries", () => {
    expect(VALID_VALUES.displayMode).toHaveLength(5);
    expect(VALID_VALUES.displayMode).toContain('full');
    expect(VALID_VALUES.displayMode).toContain('bar-dots');
  });
});

describe("config schema: tokenSource pattern validation", () => {
  test("accepts claude-code", () => {
    expect(validateConfigChange('tokenSource', 'claude-code').valid).toBe(true);
  });

  test("accepts opencode", () => {
    expect(validateConfigChange('tokenSource', 'opencode').valid).toBe(true);
  });

  test("accepts claude-settings:z", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:z').valid).toBe(true);
  });

  test("accepts claude-settings:default", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:default').valid).toBe(true);
  });

  test("accepts claude-settings:my_profile.v2", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:my_profile.v2').valid).toBe(true);
  });

  test("rejects claude-settings:.. (path traversal)", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:..').valid).toBe(false);
  });

  test("rejects claude-settings: (empty name)", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:').valid).toBe(false);
  });

  test("rejects claude-settings:a/b (slash)", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:a/b').valid).toBe(false);
  });

  test("rejects claude-settings:a b (space)", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:a b').valid).toBe(false);
  });

  test("TOKEN_SOURCE_PATTERN exported and correct", () => {
    expect(TOKEN_SOURCE_PATTERN).toBeInstanceOf(RegExp);
    expect(TOKEN_SOURCE_PATTERN.test('claude-settings:nekocode')).toBe(true);
    expect(TOKEN_SOURCE_PATTERN.test('claude-settings:../etc')).toBe(false);
  });

  test("accepts codex as tokenSource", () => {
    expect(validateConfigChange('tokenSource', 'codex').valid).toBe(true);
  });

  test("accepts github tokenSource", () => {
    expect(validateConfigChange('tokenSource', 'github').valid).toBe(true);
  });

  test("accepts claude-settings:github as tokenSource", () => {
    expect(validateConfigChange('tokenSource', 'claude-settings:github').valid).toBe(true);
  });

  test("rejects invalid github tokenSource variant", () => {
    expect(validateConfigChange('tokenSource', 'githubXX').valid).toBe(false);
    expect(validateConfigChange('tokenSource', 'github with space').valid).toBe(false);
  });
});

describe("config schema: codex plan values", () => {
  test("accepts plus/business/edu as plan", () => {
    for (const p of ['plus', 'business', 'edu']) {
      expect(validateConfigChange('plan', p).valid).toBe(true);
    }
  });

  test("existing plan values still accepted", () => {
    for (const p of ['max', 'pro', 'team', 'enterprise', 'unknown']) {
      expect(validateConfigChange('plan', p).valid).toBe(true);
    }
  });

  test("rejects invalid plan value", () => {
    expect(validateConfigChange('plan', 'invalid_xyz').valid).toBe(false);
  });
});

describe("config schema: readConfig defaults", () => {
  test("readConfig on missing file returns displayMode='full'", async () => {
    const config = await readConfig("/nonexistent/path/config.json");
    expect(config.displayMode).toBe('full');
  });

  test("applyConfigChange writes displayMode to temp file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'aigauge-test-'));
    const tmpPath = join(tmpDir, 'config.json');
    try {
      await writeFile(tmpPath, JSON.stringify({ tokenSource: 'claude-code', plan: 'max' }));
      const result = await applyConfigChange('displayMode', 'bar-dots', tmpPath);
      expect(result.applied).toBe(true);
      const config = await readConfig(tmpPath);
      expect(config.displayMode).toBe('bar-dots');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
