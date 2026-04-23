#!/usr/bin/env bun
// Helper script: sends listSettingsFiles command, waits for settingsFiles response, prints JSON, exits.
const ws = new WebSocket('ws://localhost:19876');
const timer = setTimeout(() => { ws.close(); process.exit(1); }, 5000);
ws.onopen = () => { ws.send(JSON.stringify({ type: 'listSettingsFiles' })); };
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'settingsFiles') {
    clearTimeout(timer);
    console.log(e.data);
    ws.close();
    process.exit(0);
  }
};
ws.onerror = () => { clearTimeout(timer); process.exit(1); };
