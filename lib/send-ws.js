#!/usr/bin/env bun

const WS_URL = Bun.env.AIGAUGE_WS_URL || 'ws://localhost:19876';
const args = process.argv.slice(2);

const listenMode = args.includes('--listen');
const waitForIdx = args.indexOf('--wait-for');
const waitForType = waitForIdx !== -1 ? args[waitForIdx + 1] : null;

if (listenMode) {
  runListenMode();
} else if (waitForType) {
  runSendAndWaitMode();
} else {
  runSendMode();
}

function parseListenArgs() {
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;
  const timeoutIdx = args.indexOf('--timeout-ms');
  const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : 30000;
  const filterIdx = args.indexOf('--filter');
  const filterType = filterIdx !== -1 ? args[filterIdx + 1] : null;
  return { limit, timeoutMs, filterType };
}

function runListenMode() {
  const { limit, timeoutMs, filterType } = parseListenArgs();
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
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function runSendMode() {
  const text = await readStdin();
  if (!text) {
    process.stderr.write('[send-ws] empty stdin; nothing to send\n');
    process.exit(1);
  }

  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => { try { ws.close(); } catch {} process.exit(1); }, 5000);

  ws.onopen = () => {
    ws.send(text);
    setTimeout(() => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      process.exit(0);
    }, 500);
  };
  ws.onerror = () => { clearTimeout(timer); process.exit(1); };
}

async function runSendAndWaitMode() {
  const text = await readStdin();
  if (!text) {
    process.stderr.write('[send-ws] empty stdin; nothing to send\n');
    process.exit(1);
  }

  const timeoutIdx = args.indexOf('--timeout-ms');
  const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : 10000;

  const ws = new WebSocket(WS_URL);
  let sent = false;
  let exited = false;

  const exit = (code) => {
    if (exited) return;
    exited = true;
    try { ws.close(); } catch {}
    process.exit(code);
  };

  const timer = setTimeout(() => {
    process.stderr.write(`[send-ws] timed out waiting for type=${waitForType}\n`);
    exit(2);
  }, timeoutMs);

  ws.onopen = () => {
    ws.send(text);
    sent = true;
  };

  ws.onmessage = (event) => {
    if (!sent) return;
    try {
      const data = JSON.parse(event.data);
      if (data?.type === waitForType) {
        process.stdout.write(event.data + '\n');
        clearTimeout(timer);
        exit(0);
      }
    } catch {}
  };

  ws.onerror = () => {
    clearTimeout(timer);
    exit(1);
  };
}
