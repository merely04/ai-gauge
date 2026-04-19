const clients = new Set();

export function addClient(ws) {
  clients.add(ws);
}

export function removeClient(ws) {
  clients.delete(ws);
}

export function clientCount() {
  return clients.size;
}

export function broadcast(data) {
  if (!data) return;
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {}
  }
}

export function sendToClient(ws, data) {
  if (!ws || !data) return;
  try {
    ws.send(JSON.stringify(data));
  } catch {}
}
