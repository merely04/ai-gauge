import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

let capturedLines = [];
let originalWrite;

beforeEach(() => {
  capturedLines = [];
  originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    capturedLines.push(chunk.toString());
    return true;
  };
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

async function loadLoggerWithEnv(envValue) {
  const originalEnv = Bun.env.AIGAUGE_LOG_FORMAT;
  if (envValue === undefined) {
    delete Bun.env.AIGAUGE_LOG_FORMAT;
  } else {
    Bun.env.AIGAUGE_LOG_FORMAT = envValue;
  }
  const module = await import('./logger.js?' + Math.random());
  if (originalEnv === undefined) {
    delete Bun.env.AIGAUGE_LOG_FORMAT;
  } else {
    Bun.env.AIGAUGE_LOG_FORMAT = originalEnv;
  }
  return module;
}

describe('logger — text format (default)', () => {
  test('info writes plain text line', async () => {
    const { createLogger } = await loadLoggerWithEnv(undefined);
    const log = createLogger('test');
    log.info('startup');
    expect(capturedLines.some((l) => l.includes('[test] startup'))).toBe(true);
  });

  test('includes fields as key=value', async () => {
    const { createLogger } = await loadLoggerWithEnv(undefined);
    const log = createLogger('test');
    log.warn('slow', { duration_ms: 1234, url: 'https://x' });
    const line = capturedLines.find((l) => l.includes('slow'));
    expect(line).toMatch(/duration_ms=1234/);
    expect(line).toMatch(/url=https:\/\/x/);
  });
});

describe('logger — JSON format', () => {
  test('info writes structured JSON line', async () => {
    const { createLogger } = await loadLoggerWithEnv('json');
    const log = createLogger('update');
    log.info('check_complete', { latestVersion: '1.0.0' });
    const line = capturedLines.find((l) => l.includes('check_complete'));
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.component).toBe('update');
    expect(parsed.event).toBe('check_complete');
    expect(parsed.latestVersion).toBe('1.0.0');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('error level is captured', async () => {
    const { createLogger } = await loadLoggerWithEnv('json');
    const log = createLogger('server');
    log.error('crash', { reason: 'eaddrinuse' });
    const line = capturedLines.find((l) => l.includes('crash'));
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.reason).toBe('eaddrinuse');
  });
});
