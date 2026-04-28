import { describe, test, expect } from "bun:test";
import {
  computeIconName,
  computeStatus,
  computeTooltip,
  computeMenuItems,
} from "../lib/tray-menu.js";
import { render } from "../lib/render-waybar.js";

const FIXED_NOW = Date.parse("2026-04-20T02:00:00.000Z");

const baseData = {
  five_hour: { utilization: 30, resets_at: "2026-04-20T04:31:00.000000+00:00" },
  seven_day: { utilization: 15, resets_at: "2026-04-26T19:54:00.000000+00:00" },
  seven_day_sonnet: null,
  extra_usage: null,
  meta: { plan: "max", tokenSource: "claude-code", provider: "anthropic", displayMode: "full" },
};

const baseConfig = {
  plan: "max",
  tokenSource: "claude-code",
  displayMode: "full",
  autoCheckUpdates: true,
};

const noUpdate = { available: false, version: null, installing: false, error: null, changelogUrl: null };
const updateAvailable = { available: true, version: "2.0.0", installing: false, error: null, changelogUrl: "https://github.com/merely04/ai-gauge/compare/v1.0.0...v2.0.0" };
const updateInstalling = { available: false, version: "2.0.0", installing: true, error: null, changelogUrl: null };

function withUtil(util) {
  return { ...baseData, five_hour: { ...baseData.five_hour, utilization: util } };
}

function findItem(items, id) {
  return items.find((it) => it.id === id);
}

describe("computeIconName: priority ladder", () => {
  const cases = [
    [30, false, false, "ai-gauge-normal"],
    [60, false, false, "ai-gauge-warning"],
    [85, false, false, "ai-gauge-critical"],
    [30, false, true, "ai-gauge-update-available"],
    [60, false, true, "ai-gauge-warning"],
    [85, false, true, "ai-gauge-critical"],
    [30, true, false, "ai-gauge-updating"],
    [60, true, false, "ai-gauge-updating"],
    [85, true, false, "ai-gauge-updating"],
    [30, true, true, "ai-gauge-updating"],
    [60, true, true, "ai-gauge-updating"],
    [85, true, true, "ai-gauge-updating"],
    [49, false, false, "ai-gauge-normal"],
    [50, false, false, "ai-gauge-warning"],
    [79, false, false, "ai-gauge-warning"],
    [80, false, false, "ai-gauge-critical"],
  ];
  for (const [util, installing, available, expected] of cases) {
    test(`util=${util} installing=${installing} available=${available} -> ${expected}`, () => {
      const updateState = { ...noUpdate, installing, available };
      expect(computeIconName({ data: withUtil(util), updateState, displayMode: "full" })).toBe(expected);
    });
  }

  test("data=null -> waiting", () => {
    expect(computeIconName({ data: null, updateState: noUpdate, displayMode: "full" })).toBe("ai-gauge-waiting");
  });

  test("data=null with installing -> still waiting (disconnect dominates)", () => {
    expect(computeIconName({ data: null, updateState: updateInstalling, displayMode: "full" })).toBe("ai-gauge-waiting");
  });
});

describe("computeStatus", () => {
  test("data=null -> Passive", () => {
    expect(computeStatus({ data: null, updateState: noUpdate })).toBe("Passive");
  });
  test("util=30 -> Active", () => {
    expect(computeStatus({ data: withUtil(30), updateState: noUpdate })).toBe("Active");
  });
  test("util=60 -> Active", () => {
    expect(computeStatus({ data: withUtil(60), updateState: noUpdate })).toBe("Active");
  });
  test("util=85 -> NeedsAttention", () => {
    expect(computeStatus({ data: withUtil(85), updateState: noUpdate })).toBe("NeedsAttention");
  });
  test("util=80 boundary -> NeedsAttention", () => {
    expect(computeStatus({ data: withUtil(80), updateState: noUpdate })).toBe("NeedsAttention");
  });
});

describe("computeTooltip: byte-match render().tooltip", () => {
  const fixtures = [
    { name: "normal-30", data: withUtil(30), updateState: noUpdate },
    { name: "warning-60", data: withUtil(60), updateState: noUpdate },
    { name: "critical-85", data: withUtil(85), updateState: noUpdate },
    {
      name: "with-extra",
      data: {
        ...baseData,
        extra_usage: { is_enabled: true, monthly_limit: 20000, used_credits: 17122, utilization: 85.61 },
      },
      updateState: noUpdate,
    },
    {
      name: "with-secondary",
      data: {
        ...baseData,
        secondary: {
          provider: "codex",
          five_hour: { utilization: 24, resets_at: "2026-04-20T06:12:00.000Z" },
          seven_day: { utilization: 15, resets_at: "2026-04-23T13:44:00.000Z" },
          balance: null,
        },
      },
      updateState: noUpdate,
    },
    {
      name: "with-copilot",
      data: {
        ...baseData,
        copilot: {
          plan: "pro",
          premium_interactions: { utilization: 50, used: 150, limit: 300, resets_at: "2026-04-23T13:44:00.000Z", overage_count: 0 },
        },
      },
      updateState: noUpdate,
    },
    { name: "update-available", data: withUtil(30), updateState: updateAvailable },
  ];

  for (const f of fixtures) {
    test(`${f.name}: tooltip body matches render().tooltip`, () => {
      const expected = render(f.data, f.updateState, FIXED_NOW).tooltip;
      const actual = computeTooltip({ data: f.data, updateState: f.updateState, now: FIXED_NOW }).body;
      expect(actual).toBe(expected);
    });
  }

  test("title is always 'AI Gauge'", () => {
    expect(computeTooltip({ data: withUtil(30), updateState: noUpdate, now: FIXED_NOW }).title).toBe("AI Gauge");
  });

  test("data=null -> waiting body", () => {
    const out = computeTooltip({ data: null, updateState: noUpdate, now: FIXED_NOW });
    expect(out.title).toBe("AI Gauge");
    expect(out.body).toBe("Connecting to ai-gauge-server...");
  });
});

describe("computeMenuItems: structure", () => {
  test("data=null: no info rows, but actions/submenus/footer present", () => {
    const items = computeMenuItems({
      data: null, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "info:five-hour")).toBeUndefined();
    expect(findItem(items, "refresh-now")).toBeDefined();
    expect(findItem(items, "set-token-source")).toBeDefined();
    expect(findItem(items, "restart-server")).toBeDefined();
    expect(findItem(items, "quit")).toBeDefined();
  });

  test("normal 30%: info rows include five-hour, weekly, provider, plan", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const fiveHour = findItem(items, "info:five-hour");
    expect(fiveHour).toBeDefined();
    expect(fiveHour.enabled).toBe(false);
    expect(fiveHour.label).toContain("5-hour");
    expect(fiveHour.label).toContain("30%");
    expect(findItem(items, "info:weekly")).toBeDefined();
    expect(findItem(items, "info:provider")?.label).toContain("anthropic");
    expect(findItem(items, "info:plan")?.label).toContain("max");
  });

  test("info:sonnet only when seven_day_sonnet present", () => {
    const without = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(without, "info:sonnet")).toBeUndefined();

    const dataWithSonnet = {
      ...withUtil(30),
      seven_day_sonnet: { utilization: 4, resets_at: "2026-04-23T04:00:00.000Z" },
    };
    const withSonnet = computeMenuItems({
      data: dataWithSonnet, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(withSonnet, "info:sonnet")).toBeDefined();
  });

  test("info:code-review only when code_review present", () => {
    const dataWithCR = {
      ...withUtil(30),
      code_review: { utilization: 5, resets_at: "2026-04-23T04:00:00.000Z" },
    };
    const items = computeMenuItems({
      data: dataWithCR, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "info:code-review")).toBeDefined();
  });

  test("info:extra-usage only when extra_usage.is_enabled", () => {
    const dataWithExtra = {
      ...withUtil(30),
      extra_usage: { is_enabled: true, monthly_limit: 20000, used_credits: 17122, utilization: 85.61 },
    };
    const items = computeMenuItems({
      data: dataWithExtra, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const extra = findItem(items, "info:extra-usage");
    expect(extra).toBeDefined();
    expect(extra.label).toContain("171");
    expect(extra.label).toContain("$");
  });

  test("info:balance only when balance present", () => {
    const dataWithBal = {
      ...withUtil(30),
      balance: { total_cents: 10000, used_cents: 3500, currency: "USD" },
    };
    const items = computeMenuItems({
      data: dataWithBal, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "info:balance")).toBeDefined();
  });

  test("with-secondary: shows secondary header + sub-rows", () => {
    const data = {
      ...withUtil(30),
      secondary: {
        provider: "codex",
        five_hour: { utilization: 24, resets_at: "2026-04-20T06:12:00.000Z" },
        seven_day: { utilization: 15, resets_at: "2026-04-23T13:44:00.000Z" },
        balance: null,
      },
    };
    const items = computeMenuItems({
      data, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const secHeader = findItem(items, "info:secondary");
    expect(secHeader).toBeDefined();
    expect(secHeader.label).toContain("Codex");
    expect(findItem(items, "info:secondary-five-hour")).toBeDefined();
    expect(findItem(items, "info:secondary-weekly")).toBeDefined();
  });

  test("with-copilot: shows copilot section", () => {
    const data = {
      ...withUtil(30),
      copilot: {
        plan: "pro",
        premium_interactions: { utilization: 50, used: 150, limit: 300, resets_at: "2026-04-23T13:44:00.000Z", overage_count: 0 },
      },
    };
    const items = computeMenuItems({
      data, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "info:copilot")).toBeDefined();
    expect(findItem(items, "info:copilot-plan")).toBeDefined();
    expect(findItem(items, "info:copilot-premium")).toBeDefined();
    expect(findItem(items, "info:copilot-resets")).toBeDefined();
  });

  test("tri-mode: anthropic + secondary + copilot all rendered", () => {
    const data = {
      ...withUtil(30),
      secondary: {
        provider: "codex",
        five_hour: { utilization: 24, resets_at: "2026-04-20T06:12:00.000Z" },
        seven_day: { utilization: 15, resets_at: "2026-04-23T13:44:00.000Z" },
        balance: null,
      },
      copilot: {
        plan: "pro",
        premium_interactions: { utilization: 50, used: 150, limit: 300, resets_at: "2026-04-23T13:44:00.000Z", overage_count: 0 },
      },
    };
    const items = computeMenuItems({
      data, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "info:five-hour")).toBeDefined();
    expect(findItem(items, "info:secondary")).toBeDefined();
    expect(findItem(items, "info:copilot")).toBeDefined();
  });
});

describe("computeMenuItems: update items", () => {
  test("install-update appears when updateState.available", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: updateAvailable, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const inst = findItem(items, "install-update");
    expect(inst).toBeDefined();
    expect(inst.label).toContain("2.0.0");
  });

  test("view-changelog appears when changelogUrl present", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: updateAvailable, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "view-changelog")).toBeDefined();
  });

  test("dismiss-update appears when available", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: updateAvailable, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const dis = findItem(items, "dismiss-update");
    expect(dis).toBeDefined();
    expect(dis.label).toContain("2.0.0");
  });

  test("update items absent when no update", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "install-update")).toBeUndefined();
    expect(findItem(items, "view-changelog")).toBeUndefined();
    expect(findItem(items, "dismiss-update")).toBeUndefined();
  });

  test("check-update always present", () => {
    const itemsNoUpdate = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const itemsWithUpdate = computeMenuItems({
      data: withUtil(30), updateState: updateAvailable, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(itemsNoUpdate, "check-update")).toBeDefined();
    expect(findItem(itemsWithUpdate, "check-update")).toBeDefined();
  });

  test("changelogUrl without available: view-changelog still appears", () => {
    const updateState = { ...noUpdate, changelogUrl: "https://example.com/changelog" };
    const items = computeMenuItems({
      data: withUtil(30), updateState, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "view-changelog")).toBeDefined();
    expect(findItem(items, "install-update")).toBeUndefined();
  });
});

describe("computeMenuItems: actions and footer", () => {
  test("all actions present: refresh-now, copy-summary, copy-raw", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "refresh-now")).toBeDefined();
    expect(findItem(items, "copy-summary")).toBeDefined();
    expect(findItem(items, "copy-raw")).toBeDefined();
  });

  test("footer present: restart-server, open-settings, quit", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    expect(findItem(items, "restart-server")).toBeDefined();
    expect(findItem(items, "open-settings")).toBeDefined();
    expect(findItem(items, "quit")).toBeDefined();
  });

  test("toggle-auto-check-updates ON when config.autoCheckUpdates=true", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const toggle = findItem(items, "toggle-auto-check-updates");
    expect(toggle).toBeDefined();
    expect(toggle.label).toContain("ON");
  });

  test("toggle-auto-check-updates OFF when config.autoCheckUpdates=false", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: { ...baseConfig, autoCheckUpdates: false }, settingsFiles: [], now: FIXED_NOW,
    });
    const toggle = findItem(items, "toggle-auto-check-updates");
    expect(toggle.label).toContain("OFF");
  });
});

describe("computeMenuItems: submenus", () => {
  test("Token source submenu has all 4 static + checkmark on current", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const ts = findItem(items, "set-token-source");
    expect(ts).toBeDefined();
    expect(ts.type).toBe("menu");
    expect(ts.label).toContain("claude-code");
    const ids = ts.children.map((c) => c.id);
    expect(ids).toContain("set-token-source:claude-code");
    expect(ids).toContain("set-token-source:opencode");
    expect(ids).toContain("set-token-source:codex");
    expect(ids).toContain("set-token-source:github");
    const current = ts.children.find((c) => c.id === "set-token-source:claude-code");
    expect(current.toggleType).toBe("checkmark");
    expect(current.toggleState).toBe(1);
    const other = ts.children.find((c) => c.id === "set-token-source:opencode");
    expect(other.toggleState).toBe(0);
  });

  test("Token source submenu adds claude-settings:* with provider suffix", () => {
    const settingsFiles = [
      { name: "myprovider", provider: "zai" },
      { name: "work", provider: "anthropic" },
    ];
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles, now: FIXED_NOW,
    });
    const ts = findItem(items, "set-token-source");
    const ids = ts.children.map((c) => c.id);
    expect(ids).toContain("set-token-source:claude-settings:myprovider");
    expect(ids).toContain("set-token-source:claude-settings:work");
    const my = ts.children.find((c) => c.id === "set-token-source:claude-settings:myprovider");
    expect(my.label).toContain("zai");
  });

  test("Token source submenu has separator between static and dynamic when settingsFiles non-empty", () => {
    const settingsFiles = [{ name: "myprovider", provider: "zai" }];
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles, now: FIXED_NOW,
    });
    const ts = findItem(items, "set-token-source");
    const sepIdx = ts.children.findIndex((c) => c.type === "separator");
    expect(sepIdx).toBeGreaterThan(0);
    expect(sepIdx).toBeLessThan(ts.children.length - 1);
  });

  test("Token source: claude-settings current value is checked", () => {
    const settingsFiles = [{ name: "myprovider", provider: "zai" }];
    const config = { ...baseConfig, tokenSource: "claude-settings:myprovider" };
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config, settingsFiles, now: FIXED_NOW,
    });
    const ts = findItem(items, "set-token-source");
    const my = ts.children.find((c) => c.id === "set-token-source:claude-settings:myprovider");
    expect(my.toggleState).toBe(1);
    const claudeCode = ts.children.find((c) => c.id === "set-token-source:claude-code");
    expect(claudeCode.toggleState).toBe(0);
  });

  test("Plan submenu has all 8 plans + checkmark on current", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const plan = findItem(items, "set-plan");
    expect(plan.type).toBe("menu");
    const ids = plan.children.map((c) => c.id);
    expect(ids).toEqual([
      "set-plan:max",
      "set-plan:pro",
      "set-plan:team",
      "set-plan:enterprise",
      "set-plan:unknown",
      "set-plan:plus",
      "set-plan:business",
      "set-plan:edu",
    ]);
    const current = plan.children.find((c) => c.id === "set-plan:max");
    expect(current.toggleState).toBe(1);
  });

  test("Display mode submenu has all 5 modes + checkmark on current", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    });
    const dm = findItem(items, "set-display-mode");
    expect(dm.type).toBe("menu");
    const ids = dm.children.map((c) => c.id);
    expect(ids).toEqual([
      "set-display-mode:full",
      "set-display-mode:percent-only",
      "set-display-mode:bar-dots",
      "set-display-mode:number-bar",
      "set-display-mode:time-to-reset",
    ]);
    const current = dm.children.find((c) => c.id === "set-display-mode:full");
    expect(current.toggleState).toBe(1);
  });

  test("Display mode: each mode can be the current one", () => {
    const modes = ["full", "percent-only", "bar-dots", "number-bar", "time-to-reset"];
    for (const mode of modes) {
      const items = computeMenuItems({
        data: withUtil(30), updateState: noUpdate, config: { ...baseConfig, displayMode: mode }, settingsFiles: [], now: FIXED_NOW,
      });
      const dm = findItem(items, "set-display-mode");
      expect(dm.label).toContain(mode);
      const current = dm.children.find((c) => c.id === `set-display-mode:${mode}`);
      expect(current.toggleState).toBe(1);
    }
  });
});

describe("computeMenuItems: invariants", () => {
  test("deterministic: same input + same now -> byte-identical output", () => {
    const args = {
      data: withUtil(30), updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW,
    };
    const a = computeMenuItems(args);
    const b = computeMenuItems(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("invalid displayMode in config falls back to 'full' label", () => {
    const items = computeMenuItems({
      data: withUtil(30), updateState: noUpdate, config: { ...baseConfig, displayMode: "banana-invalid" }, settingsFiles: [], now: FIXED_NOW,
    });
    const dm = findItem(items, "set-display-mode");
    expect(dm.label).toContain("full");
    const fullChild = dm.children.find((c) => c.id === "set-display-mode:full");
    expect(fullChild.toggleState).toBe(1);
  });

  test("does not mutate input data", () => {
    const data = withUtil(30);
    const snapshot = JSON.stringify(data);
    computeMenuItems({ data, updateState: noUpdate, config: baseConfig, settingsFiles: [], now: FIXED_NOW });
    computeTooltip({ data, updateState: noUpdate, now: FIXED_NOW });
    computeIconName({ data, updateState: noUpdate, displayMode: "full" });
    computeStatus({ data, updateState: noUpdate });
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  test("does not mutate updateState", () => {
    const updateState = { ...updateAvailable };
    const snapshot = JSON.stringify(updateState);
    computeMenuItems({ data: withUtil(30), updateState, config: baseConfig, settingsFiles: [], now: FIXED_NOW });
    expect(JSON.stringify(updateState)).toBe(snapshot);
  });

  test("does not mutate config", () => {
    const config = { ...baseConfig };
    const snapshot = JSON.stringify(config);
    computeMenuItems({ data: withUtil(30), updateState: noUpdate, config, settingsFiles: [], now: FIXED_NOW });
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});
