import { describe, it, expect, beforeAll, afterAll } from "bun:test";

// Protocol contract tests: these tests verify WS message format compliance
// using an isolated mock server on port 29876.
// Integration tests against the real bin/ai-gauge-server are handled by F3 manual QA.

const TEST_PORT = 29876;
const TEST_URL = `ws://localhost:${TEST_PORT}`;

// Mock server state
let serverState = {
  config: { plan: "max", tokenSource: "claude-code" },
  usage: 45,
  notifyThreshold80Pending: false,
  notifyThreshold95Pending: false,
};

// Connected clients for broadcast
let connectedClients = [];

let server;

beforeAll(async () => {
  // Start mock WS server
  server = Bun.serve({
    port: TEST_PORT,
    websocket: {
      message(ws, data) {
        try {
          const msg = JSON.parse(data);

          if (msg.type === "setConfig") {
            // Validate key
            if (![
              "plan",
              "tokenSource",
              "autoCheckUpdates",
              "displayMode",
            ].includes(msg.key)) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid config key",
                })
              );
              return;
            }

            // Validate plan values
            if (
              msg.key === "plan" &&
              !["max", "pro", "team", "enterprise", "unknown"].includes(
                msg.value
              )
            ) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid plan value",
                })
              );
              return;
            }

            // Validate tokenSource values
            if (
              msg.key === "tokenSource" &&
              !["claude-code", "opencode"].includes(msg.value)
            ) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid tokenSource value",
                })
              );
              return;
            }

            // Validate displayMode values
            if (
              msg.key === "displayMode" &&
              !["full", "percent-only", "bar-dots", "number-bar", "time-to-reset"].includes(msg.value)
            ) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid displayMode value",
                })
              );
              return;
            }

            // Accept valid config
            serverState.config[msg.key] = msg.value;
            ws.send(
              JSON.stringify({
                type: "configAck",
                key: msg.key,
                value: msg.value,
              })
            );
            return;
          }

          if (msg.type === "listSettingsFiles") {
            const files = [
              { name: "default", provider: "anthropic", baseUrl: null, hasToken: true, supported: true },
              { name: "zai", provider: "zai", baseUrl: "https://api.z.ai/api/anthropic", hasToken: true, supported: true },
              { name: "broken", provider: "unknown", baseUrl: null, hasToken: false, supported: false, skipReason: "invalid-json" },
            ];
            ws.send(JSON.stringify({ type: "settingsFiles", files }));
            return;
          }

          if (msg.type === "broadcastUsageV2") {
            broadcastToAll({
              five_hour: { utilization: 44, resets_at: "2099-01-01T00:00:00.000000+00:00" },
              seven_day: { utilization: 15, resets_at: "2099-01-01T00:00:00.000000+00:00" },
              balance: null,
              meta: {
                plan: "max",
                tokenSource: "claude-code",
                displayMode: "full",
                fetchedAt: "2099-01-01T00:00:00.000Z",
                version: "0.0.0-test",
                protocolVersion: 2,
                autoCheckUpdates: false,
                provider: "anthropic",
              },
            });
            return;
          }

          if (msg.type === "broadcastUsageV2Credits") {
            broadcastToAll({
              five_hour: null,
              seven_day: null,
              balance: { remaining: 12.5, limit: 100, unit: "USD" },
              meta: {
                plan: "unknown",
                tokenSource: "claude-settings:packy",
                displayMode: "full",
                fetchedAt: "2099-01-01T00:00:00.000Z",
                version: "0.0.0-test",
                protocolVersion: 2,
                autoCheckUpdates: false,
                provider: "packy",
              },
            });
            return;
          }

          if (msg.type === "setUsage") {
            // For testing notify threshold crossing
            const oldUsage = serverState.usage;
            serverState.usage = msg.percentage;

            // Check 80% threshold
            if (oldUsage < 80 && msg.percentage >= 80) {
              serverState.notifyThreshold80Pending = true;
              broadcastToAll({
                type: "notify",
                threshold: 80,
                percentage: msg.percentage,
                message: `Usage at 80%, ~N days remaining`,
              });
            }

            // Check 95% threshold
            if (oldUsage < 95 && msg.percentage >= 95) {
              serverState.notifyThreshold95Pending = true;
              broadcastToAll({
                type: "notify",
                threshold: 95,
                percentage: msg.percentage,
                message: `Usage at 95%, ~N days remaining`,
              });
            }

            // Reset below 50%
            if (msg.percentage < 50) {
              serverState.notifyThreshold80Pending = false;
              serverState.notifyThreshold95Pending = false;
            }

            return;
          }

          // Unknown message type - ignore, no crash
          // (server silently ignores unknown types)
        } catch (e) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Parse error",
            })
          );
        }
      },

      open(ws) {
        connectedClients.push(ws);
      },

      close(ws) {
        connectedClients = connectedClients.filter((c) => c !== ws);
      },
    },

    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("not found", { status: 404 });
    },
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 100));
});

afterAll(async () => {
  // Close all client connections
  connectedClients.forEach((ws) => ws.close());
  connectedClients = [];

  // Close server
  if (server) {
    server.stop();
  }

  // Wait for cleanup
  await new Promise((resolve) => setTimeout(resolve, 100));
});

function broadcastToAll(msg) {
  const data = JSON.stringify(msg);
  connectedClients.forEach((ws) => {
    try {
      ws.send(data);
    } catch (e) {
      // Client may have disconnected
    }
  });
}

// ============================================================================
// TEST CASES
// ============================================================================

describe("WS Protocol", () => {
  it("Test 1: Valid setConfig with plan value accepted", async () => {
    const ws = new WebSocket(TEST_URL);

    let received = null;
    ws.onmessage = (event) => {
      received = JSON.parse(event.data);
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "setConfig",
            key: "plan",
            value: "team",
          })
        );

        // Wait for response
        setTimeout(() => {
          expect(received).not.toBeNull();
          expect(received.type).toBe("configAck");
          expect(received.key).toBe("plan");
          expect(received.value).toBe("team");
          expect(serverState.config.plan).toBe("team");
          ws.close();
          resolve();
        }, 100);
      };
    });
  });

  it("Test 2: Invalid setConfig value rejected", async () => {
    const ws = new WebSocket(TEST_URL);

    let received = null;
    ws.onmessage = (event) => {
      received = JSON.parse(event.data);
    };

    const originalPlan = serverState.config.plan;

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "setConfig",
            key: "plan",
            value: "invalid-plan",
          })
        );

        setTimeout(() => {
          expect(received).not.toBeNull();
          expect(received.type).toBe("error");
          expect(serverState.config.plan).toBe(originalPlan); // unchanged
          ws.close();
          resolve();
        }, 100);
      };
    });
  });

  it("Test 3: Invalid setConfig key rejected", async () => {
    const ws = new WebSocket(TEST_URL);

    let received = null;
    ws.onmessage = (event) => {
      received = JSON.parse(event.data);
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "setConfig",
            key: "invalidKey",
            value: "someValue",
          })
        );

        setTimeout(() => {
          expect(received).not.toBeNull();
          expect(received.type).toBe("error");
          ws.close();
          resolve();
        }, 100);
      };
    });
  });

  it("Test 4: Notify broadcast on threshold crossing (80%)", async () => {
    // Reset state
    serverState.usage = 45;
    serverState.notifyThreshold80Pending = false;

    const ws = new WebSocket(TEST_URL);

    let notifyReceived = null;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "notify") {
        notifyReceived = msg;
      }
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        // Trigger usage crossing 80%
        const triggerWs = new WebSocket(TEST_URL);
        triggerWs.onopen = () => {
          triggerWs.send(
            JSON.stringify({
              type: "setUsage",
              percentage: 82,
            })
          );

          setTimeout(() => {
            expect(notifyReceived).not.toBeNull();
            expect(notifyReceived.type).toBe("notify");
            expect(notifyReceived.threshold).toBe(80);
            expect(notifyReceived.percentage).toBe(82);
            triggerWs.close();
            ws.close();
            resolve();
          }, 150);
        };
      };
    });
  });

  it("Test 5: No notify below threshold", async () => {
    // Reset state
    serverState.usage = 45;
    serverState.notifyThreshold80Pending = false;

    const ws = new WebSocket(TEST_URL);

    let notifyReceived = false;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "notify") {
        notifyReceived = true;
      }
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        // Trigger usage at 60% (below 80%)
        const triggerWs = new WebSocket(TEST_URL);
        triggerWs.onopen = () => {
          triggerWs.send(
            JSON.stringify({
              type: "setUsage",
              percentage: 60,
            })
          );

          setTimeout(() => {
            expect(notifyReceived).toBe(false);
            triggerWs.close();
            ws.close();
            resolve();
          }, 150);
        };
      };
    });
  });

  it("Test 6: Unknown message type ignored, no crash", async () => {
    const ws = new WebSocket(TEST_URL);

    let errorReceived = false;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "error") {
        errorReceived = true;
      }
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "unknownMessageType",
            data: "some data",
          })
        );

        setTimeout(() => {
          // Server should not crash or send error
          expect(errorReceived).toBe(false);
          ws.close();
          resolve();
        }, 100);
      };
    });
  });

  it("Test 7a: listSettingsFiles returns settingsFiles with expected shape", async () => {
    const ws = new WebSocket(TEST_URL);

    let received = null;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "settingsFiles") received = msg;
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "listSettingsFiles" }));

        setTimeout(() => {
          expect(received).not.toBeNull();
          expect(received.type).toBe("settingsFiles");
          expect(Array.isArray(received.files)).toBe(true);
          expect(received.files.length).toBeGreaterThan(0);

          for (const file of received.files) {
            expect(typeof file.name).toBe("string");
            expect(typeof file.provider).toBe("string");
            expect("baseUrl" in file).toBe(true);
            expect(typeof file.hasToken).toBe("boolean");
            expect(typeof file.supported).toBe("boolean");
            expect("path" in file).toBe(false);
          }

          const broken = received.files.find((f) => f.name === "broken");
          expect(broken).toBeDefined();
          expect(broken.skipReason).toBe("invalid-json");

          ws.close();
          resolve();
        }, 100);
      };
    });
  });

  it("Test 7b: listSettingsFiles response goes only to requesting client", async () => {
    function openWs() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(TEST_URL);
        const timer = setTimeout(() => reject(new Error("open timeout")), 2000);
        ws.onopen = () => { clearTimeout(timer); resolve(ws); };
        ws.onerror = (e) => { clearTimeout(timer); reject(e); };
      });
    }

    const listener = await openWs();
    const requester = await openWs();

    let listenerReceivedSettingsFiles = false;
    let requesterReceivedSettingsFiles = false;

    listener.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "settingsFiles") listenerReceivedSettingsFiles = true;
    };
    requester.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "settingsFiles") requesterReceivedSettingsFiles = true;
    };

    requester.send(JSON.stringify({ type: "listSettingsFiles" }));

    await new Promise((r) => setTimeout(r, 200));

    expect(requesterReceivedSettingsFiles).toBe(true);
    expect(listenerReceivedSettingsFiles).toBe(false);

    listener.close();
    requester.close();
  });

  it("Test 7c: v2 broadcast includes meta.provider, meta.protocolVersion===2, balance key", async () => {
    const ws = new WebSocket(TEST_URL);

    let broadcastData = null;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.five_hour !== undefined || msg.balance !== undefined) broadcastData = msg;
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        const trigger = new WebSocket(TEST_URL);
        trigger.onopen = () => {
          trigger.send(JSON.stringify({ type: "broadcastUsageV2" }));

          setTimeout(() => {
            expect(broadcastData).not.toBeNull();
            expect(broadcastData.meta).toBeDefined();
            expect(broadcastData.meta.provider).toBe("anthropic");
            expect(broadcastData.meta.protocolVersion).toBe(2);
            expect("balance" in broadcastData).toBe(true);
            trigger.close();
            ws.close();
            resolve();
          }, 200);
        };
      };
    });
  });

  it("Test 7d: v2 broadcast with credits data (balance non-null, five_hour null)", async () => {
    const ws = new WebSocket(TEST_URL);

    let broadcastData = null;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.balance && msg.balance.remaining !== undefined) broadcastData = msg;
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        const trigger = new WebSocket(TEST_URL);
        trigger.onopen = () => {
          trigger.send(JSON.stringify({ type: "broadcastUsageV2Credits" }));

          setTimeout(() => {
            expect(broadcastData).not.toBeNull();
            expect(broadcastData.balance).toBeDefined();
            expect(broadcastData.balance.remaining).toBe(12.5);
            expect(broadcastData.five_hour).toBeNull();
            expect(broadcastData.meta.provider).toBe("packy");
            expect(broadcastData.meta.protocolVersion).toBe(2);
            trigger.close();
            ws.close();
            resolve();
          }, 200);
        };
      };
    });
  });

  it("Test 8: Valid setConfig with tokenSource value accepted", async () => {
    const ws = new WebSocket(TEST_URL);

    let received = null;
    ws.onmessage = (event) => {
      received = JSON.parse(event.data);
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "setConfig",
            key: "tokenSource",
            value: "opencode",
          })
        );

        setTimeout(() => {
          expect(received).not.toBeNull();
          expect(received.type).toBe("configAck");
          expect(received.key).toBe("tokenSource");
          expect(received.value).toBe("opencode");
          expect(serverState.config.tokenSource).toBe("opencode");
          ws.close();
          resolve();
        }, 100);
      };
    });
  });
});
