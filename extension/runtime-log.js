export const RUNTIME_LOG_STORAGE_KEY = 'runtimeLogs';
export const MAX_RUNTIME_LOG_ENTRIES = 1200;

const MAX_STRING_LENGTH = 800;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;
const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|api[_-]?key|token|password|secret|prompt|postdata|requestbody|responsebody|chat(?:text|content)|message(?:text|content)|answer(?:text|content)|inputtext|outputtext)/i;

let writeQueue = Promise.resolve();

function clipString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated:${value.length}]`;
}

export function sanitizeLogValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return clipString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return clipString(String(value));
  if (depth >= MAX_DEPTH) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) result.push(`[truncated:${value.length}]`);
    return result;
  }

  const result = {};
  const entries = Object.entries(value);
  for (const [key, child] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[redacted]'
      : sanitizeLogValue(child, depth + 1, seen);
  }
  if (entries.length > MAX_OBJECT_KEYS) result._truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  return result;
}

export function boundRuntimeLogs(entries, limit = MAX_RUNTIME_LOG_ENTRIES) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-Math.max(1, limit));
}

function createEntry(level, component, event, details) {
  return {
    timestamp: new Date().toISOString(),
    level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    component: clipString(String(component || 'extension')),
    event: clipString(String(event || 'unknown')),
    details: sanitizeLogValue(details ?? {}),
  };
}

export function appendRuntimeLog(level, component, event, details = {}) {
  const entry = createEntry(level, component, event, details);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get(RUNTIME_LOG_STORAGE_KEY);
      const logs = boundRuntimeLogs([
        ...(Array.isArray(stored[RUNTIME_LOG_STORAGE_KEY]) ? stored[RUNTIME_LOG_STORAGE_KEY] : []),
        entry,
      ]);
      await chrome.storage.local.set({ [RUNTIME_LOG_STORAGE_KEY]: logs });
    });
  return writeQueue;
}

export async function getRuntimeLogs() {
  await writeQueue.catch(() => {});
  const stored = await chrome.storage.local.get(RUNTIME_LOG_STORAGE_KEY);
  return boundRuntimeLogs(stored[RUNTIME_LOG_STORAGE_KEY]);
}

export async function clearRuntimeLogs() {
  await writeQueue.catch(() => {});
  await chrome.storage.local.set({ [RUNTIME_LOG_STORAGE_KEY]: [] });
}
