import { describe, test, expect } from "bun:test";
import { buildMeta, META_PROTOCOL_VERSION } from "../lib/meta.js";

describe("meta builder", () => {
  test("default config produces correct meta shape", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });

    expect(meta).toEqual({
      plan: "unknown",
      tokenSource: "claude-code",
      displayMode: "full",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      version: expect.any(String),
      protocolVersion: 2,
      autoCheckUpdates: true,
      provider: "anthropic",
    });
  });

  test("custom plan passes through", () => {
    const meta = buildMeta({ plan: "team", tokenSource: "opencode" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.plan).toBe("team");
  });

  test("subscriptionType is used when plan is unknown", () => {
    const meta = buildMeta({ plan: "unknown", tokenSource: "opencode" }, { subscriptionType: "pro", fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.plan).toBe("pro");
  });

  test("protocolVersion is 2", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.protocolVersion).toBe(2);
    expect(meta.protocolVersion).not.toBe(1);
    expect(META_PROTOCOL_VERSION).toBe(2);
  });

  test("provider defaults to 'anthropic' when not supplied", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.provider).toBe("anthropic");
  });

  test("custom provider passes through", () => {
    const meta = buildMeta(
      { tokenSource: "claude-settings:packy" },
      { fetchedAt: "2026-01-01T00:00:00.000Z", provider: "packy" },
    );
    expect(meta.provider).toBe("packy");
  });

  test("provider=null falls back to 'anthropic'", () => {
    const meta = buildMeta(
      { tokenSource: "claude-code" },
      { fetchedAt: "2026-01-01T00:00:00.000Z", provider: null },
    );
    expect(meta.provider).toBe("anthropic");
  });

  test("defaults autoCheckUpdates and displayMode", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.autoCheckUpdates).toBe(true);
    expect(meta.displayMode).toBe("full");
  });

  test("version is a non-empty string", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(typeof meta.version).toBe("string");
    expect(meta.version.length).toBeGreaterThan(0);
  });
});
