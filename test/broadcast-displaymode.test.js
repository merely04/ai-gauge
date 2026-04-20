import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir, platform } from "os";

const WS_PORT = 19876;
const WS_URL = `ws://localhost:${WS_PORT}`;

let serverProc = null;
let tmpHome = null;
let tmpState = null;
let portInUse = false;

const CACHED_DATA = {
  five_hour: { utilization: 44, resets_at: "2099-01-01T00:00:00.000000+00:00" },
  seven_day: { utilization: 15, resets_at: "2099-01-01T00:00:00.000000+00:00" },
  seven_day_sonnet: null,
  extra_usage: null,
  meta: {
    plan: "max",
    tokenSource: "claude-code",
    fetchedAt: "2099-01-01T00:00:00.000Z",
    version: "0.0.0-test",
    protocolVersion: 1,
    autoCheckUpdates: false,
    displayMode: "full",
  },
};

async function probePort() {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(false);
    }, 500);
    ws.onopen = () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(true);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

beforeAll(async () => {
  portInUse = await probePort();
  if (portInUse) {
    console.warn(`SKIP: port ${WS_PORT} already in use — cannot run broadcast-displaymode integration test`);
    return;
  }

  tmpHome = await mkdtemp(join(tmpdir(), "aigauge-test-"));

  const configDir = join(tmpHome, ".config", "ai-gauge");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({
      tokenSource: "claude-code",
      plan: "max",
      autoCheckUpdates: false,
      displayMode: "full",
    }),
  );

  const claudeDir = join(tmpHome, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    join(claudeDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "fake-token-for-test",
        expiresAt: 9999999999999,
      },
    }),
  );

  const isMacOS = platform() === "darwin";
  tmpState = join(tmpHome, "runtime");
  await mkdir(join(tmpState, "ai-gauge"), { recursive: true });
  await writeFile(
    join(tmpState, "ai-gauge", "usage.json"),
    JSON.stringify(CACHED_DATA),
  );

  const env = {
    ...process.env,
    HOME: tmpHome,
    NO_UPDATE_NOTIFIER: "1",
    AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS: "999999",
  };
  if (isMacOS) {
    env.TMPDIR = tmpState;
  } else {
    env.XDG_RUNTIME_DIR = tmpState;
  }

  serverProc = Bun.spawn(["bun", "bin/ai-gauge-server"], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });

  // Server startup may block up to ~10s on fake-token fetch; wait up to 20s.
  let ready = false;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await probePort()) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    throw new Error(`ai-gauge-server did not become ready on port ${WS_PORT} within 20s`);
  }
});

afterAll(async () => {
  if (serverProc) {
    try { serverProc.kill(); } catch {}
    try { await serverProc.exited; } catch {}
    serverProc = null;
  }
  if (tmpHome) {
    try { await rm(tmpHome, { recursive: true, force: true }); } catch {}
  }
});

describe("broadcast-displaymode: setConfig propagation", () => {
  test("meta.displayMode propagates within 2s for all 5 values", async () => {
    if (portInUse) {
      console.warn("SKIP: port 19876 in use; integration test deferred");
      return;
    }

    const values = ["full", "percent-only", "bar-dots", "number-bar", "time-to-reset"];

    for (const value of values) {
      const ws = new WebSocket(WS_URL);
      const received = [];

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.meta && data.meta.displayMode !== undefined) {
            received.push({ t: Date.now(), displayMode: data.meta.displayMode });
          }
        } catch {}
      };

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
        ws.onopen = () => { clearTimeout(timer); resolve(); };
        ws.onerror = (err) => { clearTimeout(timer); reject(err); };
      });

      const t0 = Date.now();
      ws.send(JSON.stringify({ type: "setConfig", key: "displayMode", value }));

      await new Promise((r) => setTimeout(r, 2500));
      try { ws.close(); } catch {}

      const match = received.find((m) => m.t >= t0 && m.displayMode === value);
      expect(match).toBeDefined();
      if (match) {
        const latency = match.t - t0;
        expect(latency).toBeLessThan(2000);
      }
    }
  }, 30000);
});
