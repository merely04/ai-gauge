const STRUCTURED = Bun.env.AIGAUGE_LOG_FORMAT === 'json';

export function createLogger(component) {
  if (STRUCTURED) {
    return {
      info: (event, fields) => writeJSON('info', component, event, fields),
      warn: (event, fields) => writeJSON('warn', component, event, fields),
      error: (event, fields) => writeJSON('error', component, event, fields),
    };
  }

  return {
    info: (event, fields) => writeText('INFO', component, event, fields),
    warn: (event, fields) => writeText('WARN', component, event, fields),
    error: (event, fields) => writeText('ERROR', component, event, fields),
  };
}

function writeJSON(level, component, event, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...(fields || {}),
  };
  process.stderr.write(JSON.stringify(record) + '\n');
}

function writeText(level, component, event, fields) {
  let line = `[${component}] ${event}`;
  if (fields && Object.keys(fields).length > 0) {
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${formatValue(v)}`);
    line += ' ' + parts.join(' ');
  }
  process.stderr.write(line + '\n');
  void level;
}

function formatValue(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
