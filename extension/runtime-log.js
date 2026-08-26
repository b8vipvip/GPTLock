export const RUNTIME_LOG_STORAGE_KEY = 'runtimeLogs';
export const MAX_RUNTIME_LOG_ENTRIES = 2000;

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 250;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|prompt|postdata|requestbody|responsebody|chat(?:text|content)|message(?:text|content)|answer(?:text|content)|inputtext|outputtext)$/i;

export const MAX_DIAGNOSTIC_SSE_BYTES = 10 * 1024 * 1024;
export const MAX_DIAGNOSTIC_STREAM_BYTES = MAX_DIAGNOSTIC_SSE_BYTES;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

export function createDiagnosticSseCapture({ tabId = null, startedAt = null } = {}) {
  return {
    schemaVersion: 2,
    captureScope: 'auto_verification_stream_only',
    maxBytes: MAX_DIAGNOSTIC_STREAM_BYTES,
    tabId,
    startedAt: startedAt || new Date().toISOString(),
    completedAt: null,
    totalBytes: 0,
    includedBytes: 0,
    overflowed: false,
    omittedResponses: 0,
    omittedBytes: 0,
    entries: [],
    omitted: [],
  };
}

export function appendDiagnosticSseCapture(capture, entry, maxBytes = MAX_DIAGNOSTIC_STREAM_BYTES) {
  const base = capture && typeof capture === 'object' ? capture : createDiagnosticSseCapture();
  const next = {
    ...base,
    schemaVersion: 2,
    captureScope: 'auto_verification_stream_only',
    maxBytes,
    totalBytes: Number(base.totalBytes || 0),
    includedBytes: Number(base.includedBytes || 0),
    overflowed: Boolean(base.overflowed),
    omittedResponses: Number(base.omittedResponses || 0),
    omittedBytes: Number(base.omittedBytes || 0),
    entries: Array.isArray(base.entries) ? [...base.entries] : [],
    omitted: Array.isArray(base.omitted) ? [...base.omitted] : [],
  };
  const rawData = typeof entry?.rawData === 'string'
    ? entry.rawData
    : typeof entry?.rawSse === 'string'
      ? entry.rawSse
      : typeof entry?.rawFrame === 'string'
        ? entry.rawFrame
        : '';
  const bodyBytes = utf8ByteLength(rawData);
  next.totalBytes += bodyBytes;
  if (!rawData || bodyBytes === 0) return next;

  const projected = next.includedBytes + bodyBytes;
  if (projected > maxBytes) {
    next.overflowed = true;
    next.omittedResponses += 1;
    next.omittedBytes += bodyBytes;
    next.omitted.push({
      attempt: entry?.attempt ?? null,
      requestId: entry?.requestId ?? null,
      capturedAt: entry?.capturedAt ?? null,
      endpoint: entry?.endpoint ?? null,
      httpStatus: entry?.httpStatus ?? null,
      mimeType: entry?.mimeType ?? null,
      bodyFormat: entry?.bodyFormat ?? null,
      transport: entry?.transport ?? null,
      direction: entry?.direction ?? null,
      stage: entry?.stage ?? null,
      bodyBytes,
      reason: 'diagnostic_stream_size_limit',
    });
    return next;
  }

  const transport = entry?.transport || (/event-stream/i.test(entry?.mimeType || '') ? 'sse' : 'unknown');
  const stored = {
    attempt: entry?.attempt ?? null,
    requestId: entry?.requestId ?? null,
    capturedAt: entry?.capturedAt ?? null,
    endpoint: entry?.endpoint ?? null,
    httpStatus: entry?.httpStatus ?? null,
    mimeType: entry?.mimeType ?? null,
    bodyFormat: entry?.bodyFormat ?? null,
    transport,
    direction: entry?.direction ?? 'received',
    stage: entry?.stage ?? null,
    requestModel: entry?.requestModel ?? null,
    rewriteReason: entry?.rewriteReason ?? null,
    streamContext: entry?.streamContext ?? null,
    bodyBytes,
  };
  if (transport === 'websocket') stored.rawFrame = rawData;
  else stored.rawSse = rawData;
  next.entries.push(stored);
  next.includedBytes = projected;
  return next;
}

export function finalizeDiagnosticSseCapture(capture, completedAt = null) {
  if (!capture || typeof capture !== 'object') return null;
  return { ...capture, completedAt: completedAt || new Date().toISOString() };
}

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
    const omitted = Math.max(0, value.length - MAX_ARRAY_ITEMS);
    const result = value
      .slice(-MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, depth + 1, seen));
    if (omitted > 0) result.unshift(`[truncated:${value.length};omitted:${omitted};kept:last]`);
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
