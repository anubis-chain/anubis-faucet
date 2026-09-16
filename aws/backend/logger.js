const SAFE_FIELDS = new Set([
  'requestId', 'claimId', 'txHash', 'status', 'code', 'operation', 'outcome',
  'durationMs', 'method', 'path', 'attempt', 'reason',
]);

function safeValue(value) {
  if (typeof value === 'string') return value.slice(0, 256);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

export function createLogger(sink = console, now = () => new Date().toISOString()) {
  function write(level, event, fields = {}) {
    const record = { timestamp: now(), level, event: String(event).slice(0, 80) };
    for (const [key, value] of Object.entries(fields)) {
      if (!SAFE_FIELDS.has(key)) continue;
      const safe = safeValue(value);
      if (safe !== undefined) record[key] = safe;
    }
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    sink[method](record);
  }
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
