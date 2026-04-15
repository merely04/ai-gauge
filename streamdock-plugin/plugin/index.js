'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');

const ACTION_UUID = 'com.ai-gauge.streamdock.display.action';
const RECONNECT_MS = 3000;

function parseArgs(argv) {
  const parsed = {};

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('-')) {
      continue;
    }

    const value = argv[index + 1];
    parsed[key.slice(1)] = value;
    index += 1;
  }

  return {
    port: parsed.port || argv[2],
    pluginUUID: parsed.pluginUUID || argv[3],
    registerEvent: parsed.registerEvent || argv[4],
    info: parsed.info || argv[5] || ''
  };
}

function tryCreateExternalWebSocket(url) {
  try {
    const Ws = require('ws');
    return new Ws(url);
  } catch (_) {
    return null;
  }
}

class MinimalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = new URL(url);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshakeComplete = false;
    this.closed = false;
    this.expectedAccept = '';
    this.connect();
  }

  connect() {
    const port = Number(this.url.port || 80);
    this.socket = net.createConnection({
      host: this.url.hostname,
      port
    });

    this.socket.on('connect', () => this.performHandshake());
    this.socket.on('data', (chunk) => this.handleData(chunk));
    this.socket.on('error', (error) => this.emit('error', error));
    this.socket.on('close', () => {
      this.closed = true;
      this.emit('close');
    });
  }

  performHandshake() {
    const key = crypto.randomBytes(16).toString('base64');
    this.expectedAccept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
      .digest('base64');

    const path = `${this.url.pathname || '/'}${this.url.search || ''}`;
    const request = [
      `GET ${path || '/'} HTTP/1.1`,
      `Host: ${this.url.hostname}:${this.url.port || 80}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      ''
    ].join('\r\n');

    this.socket.write(request);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (!this.handshakeComplete) {
      const separatorIndex = this.buffer.indexOf('\r\n\r\n');
      if (separatorIndex === -1) {
        return;
      }

      const headerText = this.buffer.slice(0, separatorIndex).toString('utf8');
      this.buffer = this.buffer.slice(separatorIndex + 4);

      if (!headerText.startsWith('HTTP/1.1 101')) {
        this.emit('error', new Error(`WebSocket handshake failed: ${headerText.split('\r\n')[0] || 'unknown response'}`));
        this.close();
        return;
      }

      const acceptLine = headerText
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'));

      if (!acceptLine || acceptLine.split(':').slice(1).join(':').trim() !== this.expectedAccept) {
        this.emit('error', new Error('WebSocket handshake accept mismatch'));
        this.close();
        return;
      }

      this.handshakeComplete = true;
      this.emit('open');
    }

    this.processFrames();
  }

  processFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      let offset = 2;
      let payloadLength = secondByte & 0x7f;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) {
          return;
        }
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) {
          return;
        }
        const bigLength = this.buffer.readBigUInt64BE(offset);
        payloadLength = Number(bigLength);
        offset += 8;
      }

      const masked = (secondByte & 0x80) !== 0;
      let mask;

      if (masked) {
        if (this.buffer.length < offset + 4) {
          return;
        }
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) {
        return;
      }

      let payload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      if (masked && mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x8) {
        this.close();
        return;
      } else if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  send(data) {
    const payload = Buffer.from(String(data), 'utf8');
    this.sendFrame(0x1, payload);
  }

  sendFrame(opcode, payload) {
    if (!this.socket || this.closed) {
      return;
    }

    const header = [];
    header.push(0x80 | opcode);

    if (payload.length < 126) {
      header.push(0x80 | payload.length);
    } else if (payload.length < 65536) {
      header.push(0x80 | 126);
      header.push((payload.length >> 8) & 0xff, payload.length & 0xff);
    } else {
      const lengthBuffer = Buffer.alloc(8);
      lengthBuffer.writeBigUInt64BE(BigInt(payload.length));
      header.push(0x80 | 127);
      for (const byte of lengthBuffer) {
        header.push(byte);
      }
    }

    const mask = crypto.randomBytes(4);
    const maskedPayload = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      maskedPayload[index] = payload[index] ^ mask[index % 4];
    }

    this.socket.write(Buffer.concat([Buffer.from(header), mask, maskedPayload]));
  }

  close() {
    if (!this.socket || this.closed) {
      return;
    }

    this.closed = true;
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch (_) {
      // ignore close send failures
    }
    this.socket.end();
    this.socket.destroy();
  }
}

function createWebSocket(url) {
  const externalSocket = tryCreateExternalWebSocket(url);
  if (externalSocket) {
    return externalSocket;
  }

  return new MinimalWebSocket(url);
}

class AIGaugePlugin {
  constructor(options) {
    this.port = options.port;
    this.pluginUUID = options.pluginUUID;
    this.registerEvent = options.registerEvent;
    this.info = options.info;
    this.contexts = new Set();
    this.ws = null;
    this.reconnectTimer = null;
    this.isStopping = false;
    this.cachedUsage = null;
    this.usageWs = null;
    this.usageReconnectTimer = null;
  }

  start() {
    this.connect();
    this.updateAllContexts();
    this.connectUsageServer();
  }

  connectUsageServer() {
    if (this.isStopping) {
      return;
    }

    this.usageWs = createWebSocket('ws://localhost:19876');

    this.usageWs.on('message', (message) => {
      try {
        const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
        this.cachedUsage = JSON.parse(text);
        this.updateAllContexts();
      } catch (_) {
        // ignore parse errors
      }
    });

    this.usageWs.on('error', () => {
      // Silent — server may not be running yet
    });

    this.usageWs.on('close', () => {
      if (this.isStopping) {
        return;
      }

      if (this.usageReconnectTimer) {
        clearTimeout(this.usageReconnectTimer);
      }

      this.usageReconnectTimer = setTimeout(() => this.connectUsageServer(), RECONNECT_MS);
    });
  }

  connect() {
    if (!this.port || !this.pluginUUID || !this.registerEvent) {
      throw new Error('Missing StreamDock connection arguments');
    }

    this.ws = createWebSocket(`ws://127.0.0.1:${this.port}`);

    this.ws.on('open', () => {
      this.send({
        event: this.registerEvent,
        uuid: this.pluginUUID
      });
      this.updateAllContexts();
    });

    this.ws.on('message', (message) => {
      const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
      this.handleMessage(text);
    });

    this.ws.on('error', () => {
      // Silent by design; StreamDock loads plugins without a console.
    });

    this.ws.on('close', () => {
      if (this.isStopping) {
        return;
      }

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  handleMessage(messageText) {
    let payload;
    try {
      payload = JSON.parse(messageText);
    } catch (_) {
      return;
    }

    if (payload.action && payload.action !== ACTION_UUID) {
      return;
    }

    if (payload.event === 'willAppear') {
      this.contexts.add(payload.context);
      this.updateContext(payload.context);
      return;
    }

    if (payload.event === 'willDisappear') {
      this.contexts.delete(payload.context);
      return;
    }

    if (payload.event === 'keyDown') {
      this.updateContext(payload.context);
    }
  }

  send(payload) {
    if (!this.ws) {
      return;
    }

    const readyState = this.ws.readyState;
    if (typeof readyState === 'number' && readyState !== 1) {
      return;
    }

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (_) {
      // ignore transient socket failures
    }
  }

  updateAllContexts() {
    for (const context of this.contexts) {
      this.updateContext(context);
    }
  }

  updateContext(context) {
    const usage = this.readUsage();
    const image = buildSvgDataUrl(usage);

    this.send({
      event: 'setImage',
      context,
      payload: {
        image,
        target: 0
      }
    });
  }

  readUsage() {
    const parsed = this.cachedUsage;
    if (!parsed) {
      return {
        fiveHourPercent: '--',
        weeklyPercent: '--',
        timeRemaining: '--',
        color: '#ff5555'
      };
    }

    try {
      const fiveHourPercent = normalizePercent(parsed?.five_hour?.utilization);
      const weeklyPercent = normalizePercent(parsed?.seven_day?.utilization);
      const resetsAt = parsed?.five_hour?.resets_at;

      return {
        fiveHourPercent,
        weeklyPercent,
        timeRemaining: formatTimeRemaining(resetsAt),
        color: selectColor(fiveHourPercent)
      };
    } catch (_) {
      return {
        fiveHourPercent: '--',
        weeklyPercent: '--',
        timeRemaining: '--',
        color: '#ff5555'
      };
    }
  }
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '--';
  }

  return Math.max(0, Math.round(numeric));
}

function selectColor(percent) {
  if (typeof percent !== 'number') {
    return '#ff5555';
  }

  if (percent >= 80) {
    return '#ff5555';
  }

  if (percent >= 50) {
    return '#ffaa33';
  }

  return '#ffffff';
}

function formatTimeRemaining(resetAt) {
  const resetDate = new Date(resetAt);
  if (Number.isNaN(resetDate.getTime())) {
    return '--';
  }

  const diffMs = Math.max(0, resetDate.getTime() - Date.now());
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSvgDataUrl(usage) {
  const large = typeof usage.fiveHourPercent === 'number' ? `${usage.fiveHourPercent}%` : String(usage.fiveHourPercent);
  const weekly = typeof usage.weeklyPercent === 'number' ? `${usage.weeklyPercent}%w` : '--%w';
  const footer = `${usage.timeRemaining} + ${weekly}`;
  const color = usage.color;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="transparent"/>
  <text x="72" y="68" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="50" font-weight="700" fill="${escapeXml(color)}">${escapeXml(large)}</text>
  <text x="72" y="103" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600" fill="${escapeXml(color)}">${escapeXml(footer)}</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

const plugin = new AIGaugePlugin(parseArgs(process.argv));
plugin.start();
