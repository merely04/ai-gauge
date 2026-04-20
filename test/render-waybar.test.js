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
