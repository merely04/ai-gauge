#!/usr/bin/env bun
// Helper script: connects to ws://localhost:19876, waits for 1 v2 broadcast, prints JSON, exits.
const ws = new WebSocket('ws://localhost:19876');
const timer = setTimeout(() => { ws.close(); process.exit(1); }, 5000);
ws.onmessage = (e) => {
  clearTimeout(timer);
  console.log(e.data);
  ws.close();
  process.exit(0);
};
ws.onerror = () => { clearTimeout(timer); process.exit(1); };
