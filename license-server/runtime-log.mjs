import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MIN_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 50 * 1024 * 1024;
const MAX_DETAIL_DEPTH = 5;
const MAX_ARRAY_ITEMS = 128;
const MAX_STRING_LENGTH = 2000;
const SENSITIVE_KEY = /(?:password|secret|authorization|cookie|activation.?token|bearer|license.?code|token.?hash|code.?hash|code.?cipher)/i;

function clampBytes(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_MAX_BYTES && parsed <= MAX_MAX_BYTES
    ? parsed
    : DEFAULT_MAX_BYTES;
}

function safeString(value) {
  const text = String(value ?? '');
  return text.length <= MAX_STRING_LENGTH ? text : `${text.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (depth >= MAX_DETAIL_DEPTH) return '[depth-limit]';
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: safeString(value.name),
      message: safeString(value.message),
      code: value.code ? safeString(value.code) : null,
    };
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return out;
  }
  return safeString(value);
}

function readLines(path) {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function createRuntimeLogger({ dbPath, env = process.env }) {
  const path = env.GPTLOCK_LICENSE_RUNTIME_LOG || join(dirname(dbPath), 'runtime.log');
  const archivePath = `${path}.1`;
  const maxBytes = clampBytes(env.GPTLOCK_LICENSE_RUNTIME_LOG_MAX_BYTES);
  mkdirSync(dirname(path), { recursive: true });

  function rotateFor(extraBytes) {
    try {
      const current = existsSync(path) ? statSync(path).size : 0;
      if (current + extraBytes <= maxBytes) return;
      try { unlinkSync(archivePath); } catch {}
      if (existsSync(path)) renameSync(path, archivePath);
    } catch (error) {
      console.error('[runtime-log] rotate failed', error);
    }
  }

  function log(level, event, detail = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      event: safeString(event || 'event'),
      detail: sanitize(detail),
    };
    const line = `${JSON.stringify(entry)}\n`;
    try {
      rotateFor(Buffer.byteLength(line));
      appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
      chmodSync(path, 0o600);
    } catch (error) {
      console.error('[runtime-log] write failed', error);
    }
    return entry;
  }

  function tail(limit = 300) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(2000, parsedLimit)) : 300;
    const lines = [...readLines(archivePath), ...readLines(path)].slice(-safeLimit);
    return lines.map((line) => {
      try { return JSON.parse(line); }
      catch { return { timestamp: null, level: 'warn', event: 'unparseable_log_line', detail: { line: safeString(line) } }; }
    });
  }

  function exportText() {
    const lines = [...readLines(archivePath), ...readLines(path)];
    return lines.length ? `${lines.join('\n')}\n` : '';
  }

  return { path, archivePath, maxBytes, log, tail, exportText };
}
