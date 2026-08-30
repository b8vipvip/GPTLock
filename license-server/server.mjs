import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeLogger } from './runtime-log.mjs';
import { createUpdateManager } from './update-manager.mjs';
import { createAccountSystem } from './account-system.mjs';
import { createClientRuntimeLogManager } from './client-runtime-logs.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const env = process.env;
const HOST = env.GPTLOCK_LICENSE_HOST || '127.0.0.1';
const PORT = Number(env.GPTLOCK_LICENSE_PORT || 3188);
const DB_PATH = env.GPTLOCK_LICENSE_DB || join(ROOT, 'data', 'gptlock-license.sqlite3');
const PUBLIC_ORIGIN = (env.GPTLOCK_LICENSE_PUBLIC_ORIGIN || 'https://gptlock.mv3.cn').replace(/\/$/, '');
const ADMIN_PASSWORD = env.GPTLOCK_LICENSE_ADMIN_PASSWORD || '';
const SECRET = env.GPTLOCK_LICENSE_SECRET || '';
const WINDOW_TTL_SECONDS = Math.max(60, Number(env.GPTLOCK_LICENSE_WINDOW_TTL_SECONDS || 150));
const ADMIN_SESSION_HOURS = Math.max(1, Number(env.GPTLOCK_LICENSE_ADMIN_SESSION_HOURS || 12));
const DEFAULT_EXTENSION_ID = 'bhchcpeodphgjfjoookncemnamdbfcof';
const ALLOWED_EXTENSION_IDS = new Set(String(env.GPTLOCK_LICENSE_ALLOWED_EXTENSION_IDS || DEFAULT_EXTENSION_ID)
  .split(',').map((value) => value.trim().toLowerCase()).filter((value) => /^[a-z]{32}$/.test(value)));
const ADMIN_LOGIN_MAX_ATTEMPTS = Math.max(3, Number(env.GPTLOCK_LICENSE_ADMIN_LOGIN_MAX_ATTEMPTS || 8));
const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number(env.GPTLOCK_LICENSE_ADMIN_LOGIN_WINDOW_MS || 15 * 60 * 1000));
const ACTIVATE_MAX_ATTEMPTS = Math.max(10, Number(env.GPTLOCK_LICENSE_ACTIVATE_MAX_ATTEMPTS || 60));
const ACTIVATE_WINDOW_MS = Math.max(60_000, Number(env.GPTLOCK_LICENSE_ACTIVATE_WINDOW_MS || 60 * 1000));
const MAX_BODY = 64 * 1024;
const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) throw new Error('GPTLOCK_LICENSE_ADMIN_PASSWORD must be at least 12 characters');
if (!SECRET || SECRET.length < 32) throw new Error('GPTLOCK_LICENSE_SECRET must be at least 32 characters');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid GPTLOCK_LICENSE_PORT');
mkdirSync(dirname(DB_PATH), { recursive: true });
const updateManager = createUpdateManager({ serverRoot: ROOT, dbPath: DB_PATH, env });
const runtimeLogger = createRuntimeLogger({ dbPath: DB_PATH, env });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  max_devices INTEGER NOT NULL CHECK(max_devices >= 1),
  max_windows INTEGER NOT NULL CHECK(max_windows >= 1),
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS license_secrets (
  license_id INTEGER PRIMARY KEY REFERENCES licenses(id) ON DELETE CASCADE,
  code_ciphertext TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  UNIQUE(license_id, device_id)
) STRICT;
CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  browser_instance_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  extension_id TEXT NOT NULL DEFAULT '',
  extension_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(license_id, device_id, browser_instance_id)
) STRICT;
CREATE TABLE IF NOT EXISTS window_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activation_id INTEGER NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
  window_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(activation_id, window_key)
) STRICT;
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  license_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id);
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_window_leases_seen ON window_leases(last_seen_at);
`);

const LICENSE_CODE_KEY = createHmac('sha256', SECRET).update('gptlock-license-code-encryption:v1').digest();
const LICENSE_CODE_AAD_PREFIX = 'gptlock-license-code:v1:';

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function hmac(value) { return createHmac('sha256', SECRET).update(String(value)).digest('hex'); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function normalizeCode(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
function normalizeHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch { return null; }
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, String(value), nowIso());
}
function purchaseUrl() {
  const stored = getSetting('purchase_url');
  const raw = stored === null ? (env.GPTLOCK_LICENSE_PURCHASE_URL || '') : stored;
  return normalizeHttpsUrl(raw) || '';
}
function extensionIdFromOrigin(originValue) {
  const match = String(originValue || '').match(/^chrome-extension:\/\/([a-z]{32})$/i);
  return match ? match[1].toLowerCase() : null;
}
function clientIp(req) {
  const remote = String(req.socket?.remoteAddress || 'unknown');
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (loopback) {
    const validProxyIp = (value) => /^[0-9A-Fa-f:.]{3,64}$/.test(String(value || '').trim());
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    if (validProxyIp(realIp)) return realIp;
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(validProxyIp);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return remote.slice(0, 64);
}
const rateWindows = new Map();
function rateKey(scope, req) { return `${scope}:${clientIp(req)}`; }
function rateStatus(scope, req, windowMs) {
  const now = Date.now();
  const key = rateKey(scope, req);
  const previous = rateWindows.get(key);
  if (!previous || previous.resetAt <= now) {
    if (previous) rateWindows.delete(key);
    return { key, count: 0, resetAt: now + windowMs };
  }
  return { key, ...previous };
}
function rateRetryAfter(scope, req, maxAttempts, windowMs) {
  const entry = rateStatus(scope, req, windowMs);
  return entry.count >= maxAttempts ? Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) : 0;
}
function recordRateFailure(scope, req, windowMs) {
  const entry = rateStatus(scope, req, windowMs);
  rateWindows.set(entry.key, { count: entry.count + 1, resetAt: entry.resetAt });
  if (rateWindows.size > 4096) {
    const now = Date.now();
    for (const [candidate, value] of rateWindows) if (value.resetAt <= now) rateWindows.delete(candidate);
  }
}
function clearRateLimit(scope, req) { rateWindows.delete(rateKey(scope, req)); }
function extensionClientAllowed(req, extensionId) {
  const claimed = String(extensionId || '').trim().toLowerCase();
  if (!ALLOWED_EXTENSION_IDS.has(claimed)) return false;
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const originId = extensionIdFromOrigin(origin);
  return Boolean(originId && originId === claimed && ALLOWED_EXTENSION_IDS.has(originId));
}
function encryptLicenseCode(code, licenseId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', LICENSE_CODE_KEY, iv);
  cipher.setAAD(Buffer.from(`${LICENSE_CODE_AAD_PREFIX}${licenseId}`));
  const ciphertext = Buffer.concat([cipher.update(normalizeCode(code), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function decryptLicenseCode(value, licenseId) {
  if (!value) return null;
  try {
    const [version, ivText, tagText, ciphertextText] = String(value).split('.');
    if (version !== 'v1' || !ivText || !tagText || !ciphertextText) return null;
    const decipher = createDecipheriv('aes-256-gcm', LICENSE_CODE_KEY, Buffer.from(ivText, 'base64url'));
    decipher.setAAD(Buffer.from(`${LICENSE_CODE_AAD_PREFIX}${licenseId}`));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
function validId(value, max = 160) { return typeof value === 'string' && value.length >= 8 && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value); }
function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function parseIso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function generateLicenseCode() {
  const bytes = randomBytes(20);
  let chars = '';
  for (const byte of bytes) chars += LICENSE_ALPHABET[byte % LICENSE_ALPHABET.length];
  return `GPTL-${chars.slice(0,4)}-${chars.slice(4,8)}-${chars.slice(8,12)}-${chars.slice(12,16)}-${chars.slice(16,20)}`;
}
function generateToken() { return randomBytes(32).toString('base64url'); }
function audit(event, licenseId = null, detail = {}) {
  db.prepare('INSERT INTO audit_log(event,license_id,detail,created_at) VALUES(?,?,?,?)')
    .run(event, licenseId, JSON.stringify(detail).slice(0, 4000), nowIso());
}
function purgeWindowLeases() {
  const cutoff = new Date(Date.now() - WINDOW_TTL_SECONDS * 1000).toISOString();
  db.prepare('DELETE FROM window_leases WHERE last_seen_at < ?').run(cutoff);
}
function licenseValidity(row) {
  if (!row) return { ok: false, code: 'LICENSE_NOT_FOUND', message: '授权码无效 / Invalid license code' };
  if (row.status !== 'active') return { ok: false, code: 'LICENSE_REVOKED', message: '授权码已停用 / License revoked' };
  const now = Date.now();
  if (Date.parse(row.valid_from) > now) return { ok: false, code: 'LICENSE_NOT_STARTED', message: '授权尚未生效 / License not active yet' };
  if (Date.parse(row.expires_at) <= now) return { ok: false, code: 'LICENSE_EXPIRED', message: '授权码已过期 / License expired' };
  return { ok: true };
}
function licenseSummary(row) {
  purgeWindowLeases();
  const devices = db.prepare('SELECT COUNT(*) AS count FROM devices WHERE license_id=?').get(row.id).count;
  const windows = db.prepare(`SELECT COUNT(*) AS count FROM window_leases wl JOIN activations a ON a.id=wl.activation_id WHERE a.license_id=? AND a.revoked_at IS NULL`).get(row.id).count;
  const summary = {
    id: row.id,
    hint: row.code_hint,
    label: row.label,
    note: row.note,
    status: row.status,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    limits: { devices: row.max_devices, windows: row.max_windows },
    usage: { devices, windows },
  };
  if (Object.prototype.hasOwnProperty.call(row, 'code_available')) summary.codeAvailable = Boolean(row.code_available);
  return summary;
}
function findLicenseByCode(code) {
  return db.prepare('SELECT * FROM licenses WHERE code_hash=?').get(hmac(normalizeCode(code)));
}
function activationFromToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT a.*, l.status, l.max_devices, l.max_windows, l.valid_from, l.expires_at,
           l.code_hint, l.label, l.note
    FROM activations a JOIN licenses l ON l.id=a.license_id
    WHERE a.token_hash=? AND a.revoked_at IS NULL
  `).get(sha256(token));
}
function adminToken(expMs) {
  const payload = Buffer.from(JSON.stringify({ exp: expMs })).toString('base64url');
  return `${payload}.${hmac(`admin:${payload}`)}`;
}
function verifyAdminToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(`admin:${payload}`))) return false;
  try { return Number(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp) > Date.now(); } catch { return false; }
}
function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function cookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function isAdmin(req) { return verifyAdminToken(cookie(req, 'gptlock_admin')); }
function adminMutationOriginAllowed(req) {
  const origin = String(req.headers.origin || '');
  return !origin || origin === PUBLIC_ORIGIN;
}
function json(res, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}
function download(res, content, filename) {
  const payload = Buffer.from(content, 'utf8');
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'content-length': payload.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}
function apiError(res, status, code, message) { json(res, status, { ok: false, error: { code, message } }); }
async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function corsHeaders(req) {
  const origin = String(req.headers.origin || '');
  const extensionId = extensionIdFromOrigin(origin);
  if (!extensionId || !ALLOWED_EXTENSION_IDS.has(extensionId)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'POST,GET,OPTIONS',
    'vary': 'Origin',
  };
}
function staticFile(res, path) {
  const map = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  try {
    const content = readFileSync(path);
    res.writeHead(200, {
      'content-type': map[extname(path)] || 'application/octet-stream',
      'content-length': content.length,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    });
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
}

const accountSystem = createAccountSystem({
  db, env, secret: SECRET, publicOrigin: PUBLIC_ORIGIN, allowedExtensionIds: ALLOWED_EXTENSION_IDS,
  windowTtlSeconds: WINDOW_TTL_SECONDS, json, bodyJson, clientIp,
});
const clientRuntimeLogs = createClientRuntimeLogManager({ db, env, json });

async function handleApi(req, res, url) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-max-age': '600' });
    return res.end();
  }
  if (url.pathname === '/api/v1/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'gptlock-license', time: nowIso() }, cors);
  if (url.pathname === '/api/v1/config' && req.method === 'GET') {
    return json(res, 200, { ok: true, accountRequired: true, licenseRequired: false }, cors);
  }
  const accountHandled = await accountSystem.handleApi(req, res, url, cors);
  if (accountHandled) return;
  const clientLogHandled = await clientRuntimeLogs.handleApi(req, res, url, cors);
  if (clientLogHandled) return;
  if (url.pathname.startsWith('/api/v1/licenses/')) {
    return apiError(res, 410, 'LICENSE_API_REMOVED', '授权码验证已停用，请使用 GPTLock 账号登录');
  }

  return apiError(res, 404, 'NOT_FOUND', 'Not found');
}

async function handleAdmin(req, res, url) {
  if (url.pathname === '/admin/api/login' && req.method === 'POST') {
    const retryAfter = rateRetryAfter('admin-login', req, ADMIN_LOGIN_MAX_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS);
    if (retryAfter) return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: '登录失败次数过多，请稍后再试' } }, { 'retry-after': String(retryAfter) });
    const input = await bodyJson(req);
    if (!safeEqual(input.password || '', ADMIN_PASSWORD)) {
      recordRateFailure('admin-login', req, ADMIN_LOGIN_WINDOW_MS);
      return apiError(res, 401, 'LOGIN_FAILED', '密码错误');
    }
    clearRateLimit('admin-login', req);
    const token = adminToken(Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000);
    return json(res, 200, { ok: true }, { 'set-cookie': `gptlock_admin=${encodeURIComponent(token)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_HOURS * 3600}` });
  }
  if (url.pathname === '/admin/api/logout' && req.method === 'POST') {
    return json(res, 200, { ok: true }, { 'set-cookie': 'gptlock_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (!isAdmin(req)) return apiError(res, 401, 'ADMIN_REQUIRED', '需要管理员登录');
  if (!['GET','HEAD'].includes(req.method || '') && !adminMutationOriginAllowed(req)) {
    return apiError(res, 403, 'ADMIN_ORIGIN_MISMATCH', '后台写操作来源校验失败');
  }
  const accountAdminHandled = await accountSystem.handleAdmin(req, res, url);
  if (accountAdminHandled) return;
  const clientLogAdminHandled = await clientRuntimeLogs.handleAdmin(req, res, url);
  if (clientLogAdminHandled) return;
  if (url.pathname.startsWith('/admin/api/licenses')) {
    return apiError(res, 410, 'LICENSE_ADMIN_REMOVED', '授权码管理已停用，请使用用户账户管理');
  }

  if (url.pathname === '/admin/api/runtime-logs' && req.method === 'GET') {
    const limit = clampInt(url.searchParams.get('limit'), 1, 2000, 300);
    return json(res, 200, { ok: true, path: runtimeLogger.path, logs: runtimeLogger.tail(limit) });
  }
  if (url.pathname === '/admin/api/runtime-logs/export' && req.method === 'GET') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return download(res, runtimeLogger.exportText(), `gptlock-server-runtime-${stamp}.jsonl`);
  }
  if (url.pathname === '/admin/api/update' && req.method === 'GET') {
    return json(res, 200, updateManager.info());
  }
  if (url.pathname === '/admin/api/update' && req.method === 'POST') {
    const result = updateManager.request();
    audit('server_update_requested', null, { requestId: result.requestId, ref: env.GPTLOCK_UPDATE_REF || 'main' });
    return json(res, 202, result);
  }
  return apiError(res, 404, 'NOT_FOUND', 'Not found');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', PUBLIC_ORIGIN);
  const started = Date.now();
  res.once('finish', () => {
    runtimeLogger.log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request', {
      method: req.method || 'GET',
      path: url.pathname,
      status: res.statusCode,
      durationMs: Date.now() - started,
      origin: String(req.headers.origin || '').slice(0, 200) || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    });
  });
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/admin/api/')) return await handleAdmin(req, res, url);
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') return staticFile(res, join(PUBLIC, 'admin.html'));
    if (url.pathname === '/admin.js') return staticFile(res, join(PUBLIC, 'admin.js'));
    if (url.pathname === '/client-runtime-admin.js') return staticFile(res, join(PUBLIC, 'client-runtime-admin.js'));
    if (url.pathname === '/admin.css') return staticFile(res, join(PUBLIC, 'admin.css'));
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  } catch (error) {
    runtimeLogger.log('error', 'request_exception', {
      method: req.method || 'GET',
      path: url.pathname,
      status: error.status || 500,
      error,
    });
    console.error(error);
    apiError(res, error.status || 500, error.status ? 'BAD_REQUEST' : 'SERVER_ERROR', error.status ? error.message : '服务器内部错误');
  }
});

server.listen(PORT, HOST, () => {
  runtimeLogger.log('info', 'server_started', {
    pid: process.pid,
    host: HOST,
    port: PORT,
    publicOrigin: PUBLIC_ORIGIN,
    database: DB_PATH,
    runtimeLog: runtimeLogger.path,
    windowLeaseTtlSeconds: WINDOW_TTL_SECONDS,
  });
  console.log(`GPTLock license server listening on http://${HOST}:${PORT}`);
  console.log(`Public origin: ${PUBLIC_ORIGIN}`);
  console.log(`Window lease TTL: ${WINDOW_TTL_SECONDS}s`);
});
