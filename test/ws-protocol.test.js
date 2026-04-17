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
            if (!["plan", "tokenSource"].includes(msg.key)) {
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

  it("Test 7: Valid setConfig with tokenSource value accepted", async () => {
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
