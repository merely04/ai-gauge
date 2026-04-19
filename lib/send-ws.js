#!/usr/bin/env bun
// Usage:
//   Send mode: echo '{"type":"checkUpdate"}' | bun lib/send-ws.js
//   Listen mode: bun lib/send-ws.js --listen [--limit N] [--timeout-ms M] [--filter TYPE]

const WS_URL = Bun.env.AIGAUGE_WS_URL || 'ws://localhost:19876';
const args = process.argv.slice(2);
const listenMode = args.includes('--listen');

if (listenMode) {
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;
  const timeoutIdx = args.indexOf('--timeout-ms');
  const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : 30000;
  const filterIdx = args.indexOf('--filter');
  const filterType = filterIdx !== -1 ? args[filterIdx + 1] : null;

  let count = 0;
  const ws = new WebSocket(WS_URL);

  const done = (code = 0) => {
    try { ws.close(); } catch {}
    process.exit(code);
  };

  const timer = setTimeout(() => done(0), timeoutMs);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (filterType && data?.type !== filterType) return;
      process.stdout.write(event.data + '\n');
      count++;
      if (count >= limit) {
        clearTimeout(timer);
        done(0);
      }
    } catch {}
  };

  ws.onerror = () => done(1);
  ws.onclose = () => {};

} else {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) process.exit(1);

  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => { try { ws.close(); } catch {} process.exit(1); }, 5000);

  ws.onopen = () => {
    ws.send(text);
    setTimeout(() => { clearTimeout(timer); try { ws.close(); } catch {} process.exit(0); }, 500);
  };
  ws.onerror = () => { clearTimeout(timer); process.exit(1); };
}
