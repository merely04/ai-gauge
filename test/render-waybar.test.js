import { describe, test, expect } from "bun:test";
import cases from "./fixtures/display-mode/cases.json";
import { render } from "../lib/render-waybar.js";

describe("render-waybar: fixture contract", () => {
  for (const c of cases) {
    test(c.name, () => {
      const nowMs = Date.parse(c.input.now);
      const data = {
        ...c.input.data,
        meta: { ...(c.input.data.meta || {}), displayMode: c.displayMode },
      };
      const out = render(data, c.input.updateState, nowMs);
      expect(out.text).toBe(c.expected.text);
      expect(out.class).toBe(c.expected.class);
      if (c.expected.tooltip) {
        expect(out.tooltip).toBe(c.expected.tooltip);
      } else if (c.expected.tooltipRef) {
        const ref = cases.find((x) => x.name === c.expected.tooltipRef);
        expect(out.tooltip).toBe(ref.expected.tooltip);
      }
    });
  }
});

describe("render-waybar: invariants", () => {
  const fixedNow = Date.parse("2026-04-20T02:00:00.000Z");
  const baseData = {
    five_hour: { utilization: 44, resets_at: "2026-04-20T04:31:00.000000+00:00" },
    seven_day: { utilization: 15, resets_at: "2026-04-26T19:54:00.000000+00:00" },
    seven_day_sonnet: null,
    extra_usage: null,
    meta: { plan: "max" },
  };
  const modes = ["full", "percent-only", "bar-dots", "number-bar", "time-to-reset"];

  test("class identical across 5 modes for same data", () => {
    const classes = modes.map(
      (m) =>
        render(
          { ...baseData, meta: { ...baseData.meta, displayMode: m } },
          {},
          fixedNow,
        ).class,
    );
    expect(new Set(classes).size).toBe(1);
  });

  test("tooltip byte-identical across 5 modes for same data", () => {
    const tooltips = modes.map(
      (m) =>
        render(
          { ...baseData, meta: { ...baseData.meta, displayMode: m } },
          {},
          fixedNow,
        ).tooltip,
    );
    expect(new Set(tooltips).size).toBe(1);
  });

  test("invalid displayMode falls back to full", () => {
    const out = render(
      { ...baseData, meta: { ...baseData.meta, displayMode: "banana-invalid" } },
      {},
      fixedNow,
    );
    const fullOut = render(
      { ...baseData, meta: { ...baseData.meta, displayMode: "full" } },
      {},
      fixedNow,
    );
    expect(out.text).toBe(fullOut.text);
  });

  test("deterministic: same input + same now => same output", () => {
    const out1 = render(baseData, {}, fixedNow);
    const out2 = render(baseData, {}, fixedNow);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });
});

describe("render-waybar: copilot fallback", () => {
  const fixedNow = Date.parse("2026-04-30T22:00:00.000Z");
  const RESET = "2026-05-01T00:00:00Z";

  function copilotData(overrides = {}) {
    return {
      five_hour: null,
      seven_day: null,
      copilot: {
        plan: "pro",
        premium_interactions: {
          utilization: 50,
          used: 150,
          limit: 300,
          resets_at: RESET,
          overage_count: 0,
          overage_permitted: true,
        },
      },
      meta: { displayMode: "full" },
      ...overrides,
    };
  }

  test("renders copilot when five_hour=null and copilot.premium_interactions present", () => {
    const out = render(copilotData(), {}, fixedNow);
    expect(out.class).toBe("warning");
    expect(out.text).toContain("50%");
    expect(out.tooltip).toContain("GitHub Copilot");
  });

  test("class normal for util < 50", () => {
    const data = copilotData();
    data.copilot.premium_interactions.utilization = 30;
    data.copilot.premium_interactions.used = 90;
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("normal");
  });

  test("class warning for 50 <= util < 80", () => {
    const data = copilotData();
    data.copilot.premium_interactions.utilization = 75;
    data.copilot.premium_interactions.used = 225;
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("warning");
  });

  test("class critical for util >= 80", () => {
    const data = copilotData();
    data.copilot.premium_interactions.utilization = 85;
    data.copilot.premium_interactions.used = 255;
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("critical");
  });

  test("class boundary at exactly 50% is warning", () => {
    const data = copilotData();
    data.copilot.premium_interactions.utilization = 50;
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("warning");
  });

  test("class boundary at exactly 80% is critical", () => {
    const data = copilotData();
    data.copilot.premium_interactions.utilization = 80;
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("critical");
  });

  test("all 5 display modes produce non-empty text", () => {
    const modes = ["full", "percent-only", "bar-dots", "number-bar", "time-to-reset"];
    for (const mode of modes) {
      const data = copilotData({ meta: { displayMode: mode } });
      const out = render(data, {}, fixedNow);
      expect(out.text).toBeTruthy();
      expect(out.text.length).toBeGreaterThan(0);
    }
  });

  test("full mode includes spark and percentage", () => {
    const data = copilotData({ meta: { displayMode: "full" } });
    const out = render(data, {}, fixedNow);
    expect(out.text).toContain("✦");
    expect(out.text).toContain("50%");
  });

  test("percent-only mode shows only percentage", () => {
    const data = copilotData({ meta: { displayMode: "percent-only" } });
    const out = render(data, {}, fixedNow);
    expect(out.text).toContain("50%");
    expect(out.text).not.toContain("h");
  });

  test("bar-dots mode shows dot bar", () => {
    const data = copilotData({ meta: { displayMode: "bar-dots" } });
    const out = render(data, {}, fixedNow);
    expect(out.text).toContain("●");
    expect(out.text).toContain("○");
  });

  test("number-bar mode shows percentage and bar", () => {
    const data = copilotData({ meta: { displayMode: "number-bar" } });
    const out = render(data, {}, fixedNow);
    expect(out.text).toContain("50%");
    expect(out.text).toContain("▓");
  });

  test("time-to-reset mode shows timer and countdown", () => {
    const data = copilotData({ meta: { displayMode: "time-to-reset" } });
    const out = render(data, {}, fixedNow);
    expect(out.text).toContain("⏱");
  });

  test("tooltip contains Copilot, plan, used/limit, and resets", () => {
    const out = render(copilotData(), {}, fixedNow);
    expect(out.tooltip).toContain("GitHub Copilot");
    expect(out.tooltip).toContain("Plan:");
    expect(out.tooltip).toContain("pro");
    expect(out.tooltip).toContain("Premium:");
    expect(out.tooltip).toContain("150/300");
    expect(out.tooltip).toContain("Resets:");
  });

  test("tooltip includes overage line when overage_count > 0", () => {
    const data = copilotData();
    data.copilot.premium_interactions.overage_count = 25;
    const out = render(data, {}, fixedNow);
    expect(out.tooltip).toContain("Overage:");
    expect(out.tooltip).toContain("25");
  });

  test("tooltip omits overage line when overage_count === 0", () => {
    const out = render(copilotData(), {}, fixedNow);
    expect(out.tooltip).not.toContain("Overage:");
  });

  test("five_hour wins when both five_hour and copilot present", () => {
    const data = {
      five_hour: { utilization: 44, resets_at: "2026-04-30T23:00:00.000Z" },
      seven_day: { utilization: 15, resets_at: "2026-05-07T00:00:00.000Z" },
      copilot: {
        plan: "pro",
        premium_interactions: {
          utilization: 50,
          used: 150,
          limit: 300,
          resets_at: RESET,
          overage_count: 0,
          overage_permitted: true,
        },
      },
      meta: { displayMode: "full" },
    };
    const out = render(data, {}, fixedNow);
    expect(out.tooltip).not.toContain("GitHub Copilot");
    expect(out.text).toContain("44%");
  });

  test("waiting state when both five_hour and copilot null", () => {
    const data = {
      five_hour: null,
      seven_day: null,
      copilot: null,
      meta: { displayMode: "full", provider: "anthropic" },
    };
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("waiting");
  });

  test("waiting state when copilot present but premium_interactions missing", () => {
    const data = {
      five_hour: null,
      seven_day: null,
      copilot: { plan: "pro" },
      meta: { displayMode: "full", provider: "copilot" },
    };
    const out = render(data, {}, fixedNow);
    expect(out.class).toBe("waiting");
  });

  test("missing plan defaults to unknown in tooltip", () => {
    const data = copilotData();
    delete data.copilot.plan;
    const out = render(data, {}, fixedNow);
    expect(out.tooltip).toContain("Plan:");
    expect(out.tooltip).toContain("unknown");
  });

  test("update available adds ⬆ in full mode", () => {
    const out = render(copilotData(), { available: true, version: "2.0.0" }, fixedNow);
    expect(out.text).toContain("⬆");
    expect(out.tooltip).toContain("Update: v2.0.0");
  });

  test("update installing overrides text", () => {
    const out = render(copilotData(), { installing: true }, fixedNow);
    expect(out.text).toContain("updating");
    expect(out.class).toBe("updating");
  });

  test("update error adds ⚠ in full mode", () => {
    const out = render(copilotData(), { error: "permission" }, fixedNow);
    expect(out.text).toContain("⚠");
    expect(out.tooltip).toContain("Update failed");
  });
});
