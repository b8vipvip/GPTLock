import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const EXTENSION_ID = 'bhchcpeodphgjfjoookncemnamdbfcof';
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`account server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('account server did not become healthy');
}

async function request(url, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function extensionBody(extra = {}) {
  return {
    extensionId: EXTENSION_ID,
    extensionVersion: 'deletion-test',
    deviceId: 'delete-device-12345678',
    browserInstanceId: 'delete-browser-12345678',
    platform: 'test/linux',
    ...extra,
  };
}

test('public privacy pages obey CSP and self-service deletion removes account-linked data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptlock-delete-test-'));
  const dbPath = join(dir, 'account.sqlite3');
  const runtimeLogPath = join(dir, 'runtime.log');
  const port = 35000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const adminPassword = 'test-admin-password-12345';
  const password = 'DeleteAccount-12345';
  const email = 'delete-me@example.com';

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GPTLOCK_LICENSE_HOST: '127.0.0.1',
      GPTLOCK_LICENSE_PORT: String(port),
      GPTLOCK_LICENSE_DB: dbPath,
      GPTLOCK_LICENSE_RUNTIME_LOG: runtimeLogPath,
      GPTLOCK_LICENSE_PUBLIC_ORIGIN: base,
      GPTLOCK_LICENSE_ADMIN_PASSWORD: adminPassword,
      GPTLOCK_LICENSE_SECRET: '0123456789abcdef0123456789abcdef',
      GPTLOCK_LICENSE_ALLOWED_EXTENSION_IDS: EXTENSION_ID,
      GPTLOCK_ACCOUNT_EMAIL_TEST_MODE: '1',
      GPTLOCK_UPDATE_DATA_DIR: dir,
      GPTLOCK_UPDATE_ALLOW_WITHOUT_SYSTEMD: '1',
    },
  });

  let db;
  try {
    await waitForHealth(port, child);

    for (const path of ['/privacy', '/terms', '/support', '/data-deletion']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} should be public`);
      assert.match(response.headers.get('content-security-policy') || '', /style-src 'self'/);
      const html = await response.text();
      assert.doesNotMatch(html, /<style(?:\s|>)/i, `${path} must not rely on CSP-blocked inline styles`);
    }

    const adminLogin = await request(`${base}/admin/api/login`, {
      method: 'POST', body: { password: adminPassword },
    });
    assert.equal(adminLogin.response.status, 200);
    const adminCookie = adminLogin.response.headers.get('set-cookie').split(';')[0];

    const created = await request(`${base}/admin/api/account/users`, {
      method: 'POST', headers: { cookie: adminCookie }, body: {
        email, password, emailAccess: 'verified', freeDays: 7,
      },
    });
    assert.equal(created.response.status, 201);
    const userId = created.data.user.id;
    assert.ok(Number.isInteger(userId));

    const extensionLogin = await request(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN }, body: extensionBody({ email, password }),
    });
    assert.equal(extensionLogin.response.status, 200);
    const extensionToken = extensionLogin.data.sessionToken;

    const logUpload = await request(`${base}/api/v1/account/runtime-logs`, {
      method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${extensionToken}` },
      body: {
        extensionId: EXTENSION_ID,
        extensionVersion: 'deletion-test',
        logs: [{
          id: 'log:delete-test-12345678',
          timestamp: new Date().toISOString(),
          level: 'info',
          component: 'privacy-test',
          event: 'before_account_delete',
          details: { safe: true },
        }],
      },
    });
    assert.equal(logUpload.response.status, 202);
    assert.equal(logUpload.data.accepted, 1);

    const siteLogin = await request(`${base}/site/api/auth/login`, {
      method: 'POST', body: { email, password },
    });
    assert.equal(siteLogin.response.status, 200);
    const siteCookie = siteLogin.response.headers.get('set-cookie').split(';')[0];

    const wrongPassword = await request(`${base}/site/api/account/delete`, {
      method: 'POST', headers: { cookie: siteCookie }, body: { currentPassword: 'WrongPassword-12345', confirmText: 'DELETE' },
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.data.error.code, 'PASSWORD_MISMATCH');

    const missingConfirmation = await request(`${base}/site/api/account/delete`, {
      method: 'POST', headers: { cookie: siteCookie }, body: { currentPassword: password, confirmText: 'delete' },
    });
    assert.equal(missingConfirmation.response.status, 400);
    assert.equal(missingConfirmation.data.error.code, 'DELETE_CONFIRMATION_REQUIRED');

    const deleted = await request(`${base}/site/api/account/delete`, {
      method: 'POST', headers: { cookie: siteCookie }, body: { currentPassword: password, confirmText: 'DELETE' },
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.data.deleted, true);
    assert.match(deleted.response.headers.get('set-cookie') || '', /Max-Age=0/);

    const siteAfterDelete = await request(`${base}/site/api/account/me`, { headers: { cookie: siteCookie } });
    assert.equal(siteAfterDelete.response.status, 401);
    const extensionAfterDelete = await request(`${base}/api/v1/account/me`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${extensionToken}` },
    });
    assert.equal(extensionAfterDelete.response.status, 401);

    db = new DatabaseSync(dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE id=?').get(userId).count, 0);
    for (const table of ['user_devices', 'user_sessions', 'user_window_leases', 'email_tokens', 'memberships', 'membership_orders', 'site_sessions', 'client_runtime_logs', 'account_audit_log']) {
      const column = table === 'user_window_leases'
        ? null
        : table === 'account_audit_log' || table === 'client_runtime_logs' || table === 'site_sessions' || table.startsWith('user_') || table === 'email_tokens' || table === 'memberships' || table === 'membership_orders'
          ? 'user_id'
          : null;
      if (column) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`).get(userId).count, 0, `${table} should be deleted`);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_window_leases').get().count, 0);
  } finally {
    db?.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
