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
      protocolVersion: 1,
      autoCheckUpdates: true,
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

  test("protocolVersion stays at 1", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(meta.protocolVersion).toBe(1);
    expect(meta.protocolVersion).not.toBe(2);
    expect(META_PROTOCOL_VERSION).toBe(1);
  });

  test("returns no provider field", () => {
    const meta = buildMeta({ tokenSource: "claude-code" }, { fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(Object.prototype.hasOwnProperty.call(meta, "provider")).toBe(false);
    expect(meta.provider).toBeUndefined();
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
