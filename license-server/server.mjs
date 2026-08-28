import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateManager } from './update-manager.mjs';

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
const MAX_BODY = 64 * 1024;
const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) throw new Error('GPTLOCK_LICENSE_ADMIN_PASSWORD must be at least 12 characters');
if (!SECRET || SECRET.length < 32) throw new Error('GPTLOCK_LICENSE_SECRET must be at least 32 characters');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid GPTLOCK_LICENSE_PORT');
mkdirSync(dirname(DB_PATH), { recursive: true });
const updateManager = createUpdateManager({ serverRoot: ROOT, dbPath: DB_PATH, env });

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
CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id);
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_window_leases_seen ON window_leases(last_seen_at);
`);

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function hmac(value) { return createHmac('sha256', SECRET).update(String(value)).digest('hex'); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function normalizeCode(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
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
  return {
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
  if (!origin.startsWith('chrome-extension://')) return {};
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

function createLicense(input) {
  const maxDevices = clampInt(input.maxDevices, 1, 10000, 1);
  const maxWindows = clampInt(input.maxWindows, 1, 10000, 1);
  const validFrom = parseIso(input.validFrom) || nowIso();
  const expiresAt = parseIso(input.expiresAt);
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(validFrom)) throw Object.assign(new Error('有效期结束时间必须晚于开始时间'), { status: 400 });
  let code;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    code = generateLicenseCode();
    if (!findLicenseByCode(code)) break;
  }
  const now = nowIso();
  const result = db.prepare(`INSERT INTO licenses(code_hash,code_hint,label,note,status,max_devices,max_windows,valid_from,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(hmac(code), `${code.slice(0,9)}…${code.slice(-4)}`, String(input.label || '').slice(0,120), String(input.note || '').slice(0,500), 'active', maxDevices, maxWindows, validFrom, expiresAt, now, now);
  audit('license_created', Number(result.lastInsertRowid), { maxDevices, maxWindows, expiresAt });
  return { code, license: licenseSummary(db.prepare('SELECT * FROM licenses WHERE id=?').get(Number(result.lastInsertRowid))) };
}

async function handleApi(req, res, url) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-max-age': '600' });
    return res.end();
  }
  if (url.pathname === '/api/v1/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'gptlock-license', time: nowIso() }, cors);

  if (url.pathname === '/api/v1/licenses/activate' && req.method === 'POST') {
    const input = await bodyJson(req);
    const code = normalizeCode(input.code);
    if (!code || !validId(input.deviceId) || !validId(input.browserInstanceId)) return apiError(res, 400, 'INVALID_REQUEST', '授权码、设备标识或浏览器标识无效');
    const row = findLicenseByCode(code);
    const validity = licenseValidity(row);
    if (!validity.ok) return apiError(res, 403, validity.code, validity.message);
    const existingDevice = db.prepare('SELECT * FROM devices WHERE license_id=? AND device_id=?').get(row.id, input.deviceId);
    if (!existingDevice) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM devices WHERE license_id=?').get(row.id).count;
      if (count >= row.max_devices) return apiError(res, 409, 'DEVICE_LIMIT', `设备数量已达到上限 ${row.max_devices}`);
      db.prepare('INSERT INTO devices(license_id,device_id,first_seen_at,last_seen_at,platform) VALUES(?,?,?,?,?)')
        .run(row.id, input.deviceId, nowIso(), nowIso(), String(input.platform || '').slice(0,80));
      audit('device_bound', row.id, { deviceId: input.deviceId });
    } else {
      db.prepare('UPDATE devices SET last_seen_at=?, platform=? WHERE id=?').run(nowIso(), String(input.platform || '').slice(0,80), existingDevice.id);
    }
    const previous = db.prepare('SELECT * FROM activations WHERE license_id=? AND device_id=? AND browser_instance_id=?').get(row.id, input.deviceId, input.browserInstanceId);
    const token = generateToken();
    const now = nowIso();
    if (previous) {
      db.prepare('UPDATE activations SET token_hash=?,extension_id=?,extension_version=?,last_seen_at=?,revoked_at=NULL WHERE id=?')
        .run(sha256(token), String(input.extensionId || '').slice(0,80), String(input.extensionVersion || '').slice(0,40), now, previous.id);
      db.prepare('DELETE FROM window_leases WHERE activation_id=?').run(previous.id);
    } else {
      db.prepare(`INSERT INTO activations(license_id,device_id,browser_instance_id,token_hash,extension_id,extension_version,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(row.id, input.deviceId, input.browserInstanceId, sha256(token), String(input.extensionId || '').slice(0,80), String(input.extensionVersion || '').slice(0,40), now, now);
    }
    audit('activation_issued', row.id, { deviceId: input.deviceId, browserInstanceId: input.browserInstanceId });
    return json(res, 200, { ok: true, activationToken: token, license: licenseSummary(row), heartbeatSeconds: 60, windowLeaseTtlSeconds: WINDOW_TTL_SECONDS }, cors);
  }

  if (url.pathname === '/api/v1/licenses/heartbeat' && req.method === 'POST') {
    const activation = activationFromToken(bearer(req));
    if (!activation) return apiError(res, 401, 'ACTIVATION_INVALID', '授权会话无效，请重新输入授权码');
    const validity = licenseValidity(activation);
    if (!validity.ok) return apiError(res, 403, validity.code, validity.message);
    const input = await bodyJson(req);
    const requested = [...new Set(Array.isArray(input.windowKeys) ? input.windowKeys.filter((key) => validId(key, 220)).slice(0, 128) : [])];
    purgeWindowLeases();
    const existingRows = db.prepare('SELECT window_key FROM window_leases WHERE activation_id=? ORDER BY first_seen_at').all(activation.id);
    const existing = existingRows.map((row) => row.window_key).filter((key) => requested.includes(key));
    const otherCount = db.prepare(`SELECT COUNT(*) AS count FROM window_leases wl JOIN activations a ON a.id=wl.activation_id WHERE a.license_id=? AND a.revoked_at IS NULL AND a.id<>?`).get(activation.license_id, activation.id).count;
    const capacity = Math.max(0, activation.max_windows - otherCount);
    const allowed = [...existing];
    for (const key of requested) if (!allowed.includes(key) && allowed.length < capacity) allowed.push(key);
    const now = nowIso();
    db.prepare('DELETE FROM window_leases WHERE activation_id=?').run(activation.id);
    const insertLease = db.prepare('INSERT INTO window_leases(activation_id,window_key,first_seen_at,last_seen_at) VALUES(?,?,?,?)');
    for (const key of allowed) insertLease.run(activation.id, key, now, now);
    db.prepare('UPDATE activations SET last_seen_at=?,extension_version=? WHERE id=?').run(now, String(input.extensionVersion || activation.extension_version).slice(0,40), activation.id);
    db.prepare('UPDATE devices SET last_seen_at=? WHERE license_id=? AND device_id=?').run(now, activation.license_id, activation.device_id);
    const license = db.prepare('SELECT * FROM licenses WHERE id=?').get(activation.license_id);
    return json(res, 200, { ok: true, authorized: true, allowedWindowKeys: allowed, deniedWindowKeys: requested.filter((key) => !allowed.includes(key)), license: licenseSummary(license), heartbeatSeconds: 60, windowLeaseTtlSeconds: WINDOW_TTL_SECONDS }, cors);
  }

  if (url.pathname === '/api/v1/licenses/deactivate' && req.method === 'POST') {
    const activation = activationFromToken(bearer(req));
    if (!activation) return json(res, 200, { ok: true }, cors);
    db.prepare('UPDATE activations SET revoked_at=? WHERE id=?').run(nowIso(), activation.id);
    db.prepare('DELETE FROM window_leases WHERE activation_id=?').run(activation.id);
    audit('activation_revoked_by_client', activation.license_id, { activationId: activation.id });
    return json(res, 200, { ok: true }, cors);
  }

  return apiError(res, 404, 'NOT_FOUND', 'Not found');
}

async function handleAdmin(req, res, url) {
  if (url.pathname === '/admin/api/login' && req.method === 'POST') {
    const input = await bodyJson(req);
    if (!safeEqual(input.password || '', ADMIN_PASSWORD)) return apiError(res, 401, 'LOGIN_FAILED', '密码错误');
    const token = adminToken(Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000);
    return json(res, 200, { ok: true }, { 'set-cookie': `gptlock_admin=${encodeURIComponent(token)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_HOURS * 3600}` });
  }
  if (url.pathname === '/admin/api/logout' && req.method === 'POST') {
    return json(res, 200, { ok: true }, { 'set-cookie': 'gptlock_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (!isAdmin(req)) return apiError(res, 401, 'ADMIN_REQUIRED', '需要管理员登录');

  if (url.pathname === '/admin/api/update' && req.method === 'GET') {
    return json(res, 200, updateManager.info());
  }
  if (url.pathname === '/admin/api/update' && req.method === 'POST') {
    const result = updateManager.request();
    audit('server_update_requested', null, { requestId: result.requestId, ref: env.GPTLOCK_UPDATE_REF || 'main' });
    return json(res, 202, result);
  }
  if (url.pathname === '/admin/api/licenses' && req.method === 'GET') {
    purgeWindowLeases();
    const rows = db.prepare('SELECT * FROM licenses ORDER BY id DESC LIMIT 1000').all();
    return json(res, 200, { ok: true, licenses: rows.map(licenseSummary) });
  }
  if (url.pathname === '/admin/api/licenses' && req.method === 'POST') {
    const created = createLicense(await bodyJson(req));
    return json(res, 201, { ok: true, ...created });
  }
  const match = url.pathname.match(/^\/admin\/api\/licenses\/(\d+)$/);
  if (match && req.method === 'PATCH') {
    const id = Number(match[1]);
    const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(id);
    if (!row) return apiError(res, 404, 'LICENSE_NOT_FOUND', '授权不存在');
    const input = await bodyJson(req);
    const next = {
      label: input.label === undefined ? row.label : String(input.label).slice(0,120),
      note: input.note === undefined ? row.note : String(input.note).slice(0,500),
      status: input.status === undefined ? row.status : (input.status === 'active' ? 'active' : 'revoked'),
      maxDevices: input.maxDevices === undefined ? row.max_devices : clampInt(input.maxDevices, 1, 10000, row.max_devices),
      maxWindows: input.maxWindows === undefined ? row.max_windows : clampInt(input.maxWindows, 1, 10000, row.max_windows),
      validFrom: input.validFrom === undefined ? row.valid_from : parseIso(input.validFrom),
      expiresAt: input.expiresAt === undefined ? row.expires_at : parseIso(input.expiresAt),
    };
    if (!next.validFrom || !next.expiresAt || Date.parse(next.expiresAt) <= Date.parse(next.validFrom)) return apiError(res, 400, 'INVALID_EXPIRY', '有效期设置无效');
    db.prepare('UPDATE licenses SET label=?,note=?,status=?,max_devices=?,max_windows=?,valid_from=?,expires_at=?,updated_at=? WHERE id=?')
      .run(next.label, next.note, next.status, next.maxDevices, next.maxWindows, next.validFrom, next.expiresAt, nowIso(), id);
    if (next.status === 'revoked') {
      db.prepare('UPDATE activations SET revoked_at=? WHERE license_id=? AND revoked_at IS NULL').run(nowIso(), id);
      db.prepare('DELETE FROM window_leases WHERE activation_id IN (SELECT id FROM activations WHERE license_id=?)').run(id);
    }
    audit('license_updated', id, next);
    return json(res, 200, { ok: true, license: licenseSummary(db.prepare('SELECT * FROM licenses WHERE id=?').get(id)) });
  }
  const releaseMatch = url.pathname.match(/^\/admin\/api\/licenses\/(\d+)\/release-devices$/);
  if (releaseMatch && req.method === 'POST') {
    const id = Number(releaseMatch[1]);
    db.prepare('DELETE FROM devices WHERE license_id=?').run(id);
    db.prepare('DELETE FROM activations WHERE license_id=?').run(id);
    audit('devices_released', id, {});
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/admin/api/audit' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
    return json(res, 200, { ok: true, audit: rows });
  }
  return apiError(res, 404, 'NOT_FOUND', 'Not found');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', PUBLIC_ORIGIN);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/admin/api/')) return await handleAdmin(req, res, url);
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') return staticFile(res, join(PUBLIC, 'admin.html'));
    if (url.pathname === '/admin.js') return staticFile(res, join(PUBLIC, 'admin.js'));
    if (url.pathname === '/admin.css') return staticFile(res, join(PUBLIC, 'admin.css'));
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  } catch (error) {
    console.error(error);
    apiError(res, error.status || 500, error.status ? 'BAD_REQUEST' : 'SERVER_ERROR', error.status ? error.message : '服务器内部错误');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GPTLock license server listening on http://${HOST}:${PORT}`);
  console.log(`Public origin: ${PUBLIC_ORIGIN}`);
  console.log(`Window lease TTL: ${WINDOW_TTL_SECONDS}s`);
});
