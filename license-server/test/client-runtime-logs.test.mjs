import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createClientRuntimeLogManager } from '../client-runtime-logs.mjs';

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function json(res, status, body, extra = {}) { Object.assign(res, { status, body, extra }); }
function request(body, token = 'session-token') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { authorization: `Bearer ${token}` };
  return req;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      device_id TEXT NOT NULL,
      browser_instance_id TEXT NOT NULL,
      extension_id TEXT NOT NULL,
      extension_version TEXT NOT NULL,
      platform TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
  `);
  db.prepare('INSERT INTO users(id,email) VALUES(1,?)').run('user@example.com');
  db.prepare(`INSERT INTO user_sessions(id,user_id,token_hash,device_id,browser_instance_id,extension_id,extension_version,platform,expires_at)
    VALUES(1,1,?,?,?,?,?,?,?)`).run(
      sha256('session-token'), 'device-12345678', 'browser-12345678', 'bhchcpeodphgjfjoookncemnamdbfcof', '0.5.16', 'win',
      new Date(Date.now() + 60_000).toISOString(),
    );
  return { db, manager: createClientRuntimeLogManager({ db, env: { GPTLOCK_CLIENT_LOG_RETENTION_DAYS: '14' }, json }) };
}

test('authenticated client batches are stored once and duplicate IDs are acknowledged', async () => {
  const { manager } = setup();
  const payload = {
    extensionId: 'bhchcpeodphgjfjoookncemnamdbfcof',
    extensionVersion: '0.5.16',
    logs: [{ id: 'log:12345678', timestamp: '2026-08-30T08:00:00.000Z', level: 'warn', component: 'native', event: 'disconnect', details: { reason: 'test' } }],
  };
  const first = {};
  assert.equal(await manager.handleApi(request(payload), first, new URL('https://gptlock.mv3.cn/api/v1/account/runtime-logs'), {}), true);
  assert.equal(first.status, 202);
  assert.equal(first.body.accepted, 1);
  assert.deepEqual(first.body.acknowledgedIds, ['log:12345678']);

  const second = {};
  await manager.handleApi(request(payload), second, new URL('https://gptlock.mv3.cn/api/v1/account/runtime-logs'), {});
  assert.equal(second.body.accepted, 0);
  assert.equal(second.body.duplicates, 1);

  const admin = {};
  await manager.handleAdmin({ method: 'GET' }, admin, new URL('https://gptlock.mv3.cn/admin/api/client-runtime-logs?level=warn'));
  assert.equal(admin.status, 200);
  assert.equal(admin.body.total, 1);
  assert.equal(admin.body.retentionDays, 14);
  assert.equal(admin.body.logs[0].email, 'user@example.com');
  assert.equal(admin.body.logs[0].event, 'disconnect');
});

test('client log endpoint rejects missing sessions and admin can clear filtered logs', async () => {
  const { manager } = setup();
  const denied = {};
  await manager.handleApi(request({ logs: [] }, 'wrong-token'), denied, new URL('https://gptlock.mv3.cn/api/v1/account/runtime-logs'), {});
  assert.equal(denied.status, 401);

  const stored = {};
  await manager.handleApi(request({
    extensionId: 'bhchcpeodphgjfjoookncemnamdbfcof',
    logs: [
      { id: 'log:error-12345678', level: 'error', component: 'network', event: 'failed', details: {} },
      { id: 'log:info-12345678', level: 'info', component: 'network', event: 'ok', details: {} },
    ],
  }), stored, new URL('https://gptlock.mv3.cn/api/v1/account/runtime-logs'), {});
  assert.equal(stored.body.accepted, 2);

  const cleared = {};
  await manager.handleAdmin({ method: 'DELETE' }, cleared, new URL('https://gptlock.mv3.cn/admin/api/client-runtime-logs?level=error'));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.deleted, 1);

  const remaining = {};
  await manager.handleAdmin({ method: 'GET' }, remaining, new URL('https://gptlock.mv3.cn/admin/api/client-runtime-logs'));
  assert.equal(remaining.body.total, 1);
  assert.equal(remaining.body.logs[0].level, 'info');
});
