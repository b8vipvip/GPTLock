import { createHash } from 'node:crypto';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_BATCH = 100;
const MAX_DETAILS_CHARS = 16000;
const MAX_TEXT = 2000;

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function clip(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated:${text.length}]`;
}
function parseTimestamp(value, fallback) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}
function normalizeLevel(value) {
  return ['debug', 'info', 'warn', 'error'].includes(value) ? value : 'info';
}
function normalizeDetails(value) {
  const details = value && typeof value === 'object' ? value : { value: clip(value) };
  let raw;
  try { raw = JSON.stringify(details); } catch { raw = JSON.stringify({ value: '[unserializable]' }); }
  if (raw.length <= MAX_DETAILS_CHARS) return raw;
  return JSON.stringify({
    _truncatedOnServer: true,
    originalChars: raw.length,
    preview: raw.slice(0, MAX_DETAILS_CHARS),
  });
}
function parseDetails(value) {
  try { return JSON.parse(value || '{}'); } catch { return { value: String(value || '') }; }
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Client runtime log batch too large'), { status: 413, code: 'LOG_BATCH_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400, code: 'INVALID_JSON' }); }
}

export function createClientRuntimeLogManager({ db, env = process.env, json }) {
  const retentionDays = clampInt(env.GPTLOCK_CLIENT_LOG_RETENTION_DAYS, 1, 3650, 30);
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_runtime_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_log_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES user_sessions(id) ON DELETE SET NULL,
      device_id TEXT NOT NULL DEFAULT '',
      browser_instance_id TEXT NOT NULL DEFAULT '',
      extension_version TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      client_timestamp TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
      component TEXT NOT NULL,
      event TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      received_at TEXT NOT NULL,
      UNIQUE(user_id, client_log_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_client_runtime_logs_received ON client_runtime_logs(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_runtime_logs_user ON client_runtime_logs(user_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_runtime_logs_level ON client_runtime_logs(level, received_at DESC);
  `);

  function purgeExpired() {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM client_runtime_logs WHERE received_at < ?').run(cutoff);
  }

  function sessionFromRequest(req) {
    const token = bearer(req);
    if (!token) return null;
    const row = db.prepare(`SELECT s.*,u.email FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(sha256(token));
    if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  }

  function replyError(res, status, code, message, extra = {}) {
    return json(res, status, { ok: false, error: { code, message } }, extra);
  }

  function queryFilters(url) {
    const userId = Number(url.searchParams.get('userId'));
    const level = String(url.searchParams.get('level') || '').trim();
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 160);
    return {
      userId: Number.isInteger(userId) && userId > 0 ? userId : null,
      level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : '',
      q,
    };
  }

  function whereFor(filters) {
    const clauses = [];
    const args = [];
    if (filters.userId) { clauses.push('l.user_id=?'); args.push(filters.userId); }
    if (filters.level) { clauses.push('l.level=?'); args.push(filters.level); }
    if (filters.q) {
      clauses.push(`(LOWER(u.email) LIKE ? OR LOWER(l.device_id) LIKE ? OR LOWER(l.component) LIKE ? OR LOWER(l.event) LIKE ?)`);
      const like = `%${filters.q.replace(/[%_]/g, '')}%`;
      args.push(like, like, like, like);
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', args };
  }

  function publicRow(row) {
    return {
      id: row.id,
      clientLogId: row.client_log_id,
      userId: row.user_id,
      email: row.email,
      sessionId: row.session_id,
      deviceId: row.device_id,
      browserInstanceId: row.browser_instance_id,
      extensionVersion: row.extension_version,
      platform: row.platform,
      timestamp: row.client_timestamp,
      receivedAt: row.received_at,
      level: row.level,
      component: row.component,
      event: row.event,
      details: parseDetails(row.details_json),
    };
  }

  async function handleApi(req, res, url, cors = {}) {
    if (url.pathname !== '/api/v1/account/runtime-logs') return false;
    if (req.method !== 'POST') {
      replyError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', cors);
      return true;
    }
    try {
      const session = sessionFromRequest(req);
      if (!session) {
        replyError(res, 401, 'AUTH_REQUIRED', '登录已失效，请重新登录 / Sign in again', cors);
        return true;
      }
      const input = await readJson(req);
      if (input.extensionId && String(input.extensionId) !== String(session.extension_id)) {
        replyError(res, 403, 'EXTENSION_MISMATCH', '扩展身份与登录会话不一致', cors);
        return true;
      }
      const logs = Array.isArray(input.logs) ? input.logs.slice(0, MAX_BATCH) : [];
      if (!logs.length) {
        json(res, 200, { ok: true, accepted: 0, duplicates: 0, acknowledgedIds: [], retentionDays }, cors);
        return true;
      }
      purgeExpired();
      const receivedAt = nowIso();
      const insert = db.prepare(`INSERT OR IGNORE INTO client_runtime_logs(
        client_log_id,user_id,session_id,device_id,browser_instance_id,extension_version,platform,
        client_timestamp,level,component,event,details_json,received_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let accepted = 0;
      const acknowledgedIds = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const entry of logs) {
          const clientLogId = clip(entry?.id, 220);
          if (!/^log:[A-Za-z0-9._:-]{8,210}$/.test(clientLogId)) continue;
          const result = insert.run(
            clientLogId,
            session.user_id,
            session.id,
            clip(session.device_id, 180),
            clip(session.browser_instance_id, 180),
            clip(input.extensionVersion || session.extension_version, 40),
            clip(session.platform, 120),
            parseTimestamp(entry?.timestamp, receivedAt),
            normalizeLevel(entry?.level),
            clip(entry?.component || 'extension', 200),
            clip(entry?.event || 'unknown', 240),
            normalizeDetails(entry?.details),
            receivedAt,
          );
          acknowledgedIds.push(clientLogId);
          if (Number(result.changes || 0) > 0) accepted += 1;
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      json(res, 202, {
        ok: true,
        accepted,
        duplicates: Math.max(0, acknowledgedIds.length - accepted),
        acknowledgedIds,
        retentionDays,
      }, cors);
      return true;
    } catch (error) {
      replyError(res, error.status || 500, error.code || 'CLIENT_LOG_STORE_FAILED', error.status ? error.message : '客户端运行日志保存失败', cors);
      return true;
    }
  }

  async function handleAdmin(req, res, url) {
    if (url.pathname !== '/admin/api/client-runtime-logs') return false;
    purgeExpired();
    const filters = queryFilters(url);
    const where = whereFor(filters);
    if (req.method === 'GET') {
      const limit = clampInt(url.searchParams.get('limit'), 1, 2000, 500);
      const rows = db.prepare(`SELECT l.*,u.email FROM client_runtime_logs l JOIN users u ON u.id=l.user_id${where.sql}
        ORDER BY l.id DESC LIMIT ?`).all(...where.args, limit);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM client_runtime_logs l JOIN users u ON u.id=l.user_id${where.sql}`).get(...where.args).count;
      json(res, 200, { ok: true, retentionDays, total, logs: rows.map(publicRow) });
      return true;
    }
    if (req.method === 'DELETE') {
      const result = db.prepare(`DELETE FROM client_runtime_logs AS l${where.sql.replaceAll('l.', '').replaceAll('u.email', '(SELECT email FROM users WHERE users.id=user_id)')}`).run(...where.args);
      json(res, 200, { ok: true, deleted: Number(result.changes || 0), retentionDays });
      return true;
    }
    replyError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return true;
  }

  return { handleApi, handleAdmin, purgeExpired, retentionDays };
}
