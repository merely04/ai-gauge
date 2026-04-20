import { describe, test, expect } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { validateConfigChange, applyConfigChange, readConfig, VALID_KEYS, VALID_VALUES } from "../lib/config.js";

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
