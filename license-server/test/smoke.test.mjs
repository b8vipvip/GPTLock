import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

async function jsonRequest(url, { method = 'GET', body, headers = {} } = {}) {
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
    extensionVersion: 'test',
    deviceId: 'device-12345678',
    browserInstanceId: 'browser-12345678',
    platform: 'test/linux',
    ...extra,
  };
}

async function testOutbox(base, cookie) {
  const { response, data } = await jsonRequest(`${base}/admin/api/account/test-outbox`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return data.messages || [];
}

function latestCode(messages, email, purpose) {
  const row = [...messages].reverse().find((item) => item.to === email && item.purpose === purpose);
  assert.ok(row, `missing ${purpose} email for ${email}`);
  assert.match(row.code, /^\d{6}$/);
  return row.code;
}

test('account system verifies email, enforces entitlements, manages membership, and protects credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptlock-account-test-'));
  const dbPath = join(dir, 'account.sqlite3');
  const runtimeLogPath = join(dir, 'runtime.log');
  const port = 33000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const adminPassword = 'test-admin-password-12345';
  const initialPassword = 'AccountPassword-12345';
  const resetPassword = 'ResetPassword-67890';
  const email = 'member@example.com';

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
      GPTLOCK_LICENSE_ADMIN_LOGIN_MAX_ATTEMPTS: '3',
      GPTLOCK_ACCOUNT_LOGIN_MAX_ATTEMPTS: '4',
      GPTLOCK_ACCOUNT_EMAIL_MAX_ATTEMPTS: '5',
      GPTLOCK_ACCOUNT_EMAIL_TEST_MODE: '1',
      GPTLOCK_UPDATE_DATA_DIR: dir,
      GPTLOCK_UPDATE_ALLOW_WITHOUT_SYSTEMD: '1',
    },
  });

  let inspectDb;
  try {
    await waitForHealth(port, child);

    // Admin brute-force protection remains active.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await jsonRequest(`${base}/admin/api/login`, {
        method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' }, body: { password: 'wrong-password' },
      });
      assert.equal(failed.response.status, 401);
    }
    const limited = await jsonRequest(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' }, body: { password: 'wrong-password' },
    });
    assert.equal(limited.response.status, 429);

    const loginAdmin = await jsonRequest(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'x-forwarded-for': '203.0.113.11' }, body: { password: adminPassword },
    });
    assert.equal(loginAdmin.response.status, 200);
    const cookie = loginAdmin.response.headers.get('set-cookie').split(';')[0];

    // Public config advertises account auth and old license APIs are retired.
    const config = await jsonRequest(`${base}/api/v1/config`, { headers: { origin: ORIGIN } });
    assert.equal(config.response.status, 200);
    assert.equal(config.data.accountRequired, true);
    assert.equal(config.data.licenseRequired, false);
    assert.equal(config.response.headers.get('access-control-allow-origin'), ORIGIN);

    const accountConfig = await jsonRequest(`${base}/api/v1/account/config`, { headers: { origin: ORIGIN } });
    assert.equal(accountConfig.response.status, 200);
    assert.equal(accountConfig.data.emailVerificationRequired, true);
    assert.equal(accountConfig.data.free.days, 7);
    assert.equal(accountConfig.data.free.maxDevices, 1);
    assert.equal(accountConfig.data.free.maxWindows, 1);
    assert.deepEqual(accountConfig.data.plans.map((plan) => plan.code), ['monthly', 'quarterly', 'yearly']);

    const legacy = await jsonRequest(`${base}/api/v1/licenses/activate`, {
      method: 'POST', headers: { origin: ORIGIN }, body: extensionBody({ code: 'GPTL-AAAA-BBBB-CCCC-DDDD-EEEE' }),
    });
    assert.equal(legacy.response.status, 410);
    assert.equal(legacy.data.error.code, 'LICENSE_API_REMOVED');

    const legacyAdmin = await jsonRequest(`${base}/admin/api/licenses`, { headers: { cookie } });
    assert.equal(legacyAdmin.response.status, 410);
    assert.equal(legacyAdmin.data.error.code, 'LICENSE_ADMIN_REMOVED');

    // A foreign extension cannot register.
    const rejectedExtension = await jsonRequest(`${base}/api/v1/auth/register`, {
      method: 'POST',
      headers: { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      body: { ...extensionBody({ email: 'foreign@example.com', password: initialPassword }), extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(rejectedExtension.response.status, 403);
    assert.equal(rejectedExtension.data.error.code, 'EXTENSION_NOT_ALLOWED');

    // Register -> email verification.
    const register = await jsonRequest(`${base}/api/v1/auth/register`, {
      method: 'POST', headers: { origin: ORIGIN }, body: extensionBody({ email, password: initialPassword }),
    });
    assert.equal(register.response.status, 201);
    assert.equal(register.data.verificationRequired, true);
    assert.equal(register.data.email, email);

    const verifyCode = latestCode(await testOutbox(base, cookie), email, 'verify_email');
    const verify = await jsonRequest(`${base}/api/v1/auth/verify-email`, {
      method: 'POST', headers: { origin: ORIGIN }, body: extensionBody({ email, code: verifyCode }),
    });
    assert.equal(verify.response.status, 200);
    assert.equal(verify.data.verified, true);
    assert.ok(Date.parse(verify.data.freeExpiresAt) > Date.now());

    // Wrong credentials do not expose account-specific detail.
    const wrongLogin = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.20' }, body: extensionBody({ email, password: 'WrongPassword-12345' }),
    });
    assert.equal(wrongLogin.response.status, 401);
    assert.equal(wrongLogin.data.error.code, 'LOGIN_FAILED');

    // First device logs in and free tier allows only one simultaneous Chrome window.
    const userLogin = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.21' }, body: extensionBody({ email, password: initialPassword }),
    });
    assert.equal(userLogin.response.status, 200);
    assert.ok(userLogin.data.sessionToken.length >= 40);
    assert.equal(userLogin.data.account.authenticated, true);
    assert.equal(userLogin.data.account.entitlement.source, 'free');
    const firstToken = userLogin.data.sessionToken;

    const heartbeat = await jsonRequest(`${base}/api/v1/account/heartbeat`, {
      method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${firstToken}` },
      body: extensionBody({ windowKeys: ['chrome:10000001', 'chrome:10000002'] }),
    });
    assert.equal(heartbeat.response.status, 200);
    assert.deepEqual(heartbeat.data.allowedWindowKeys, ['chrome:10000001']);
    assert.deepEqual(heartbeat.data.deniedWindowKeys, ['chrome:10000002']);
    assert.equal(heartbeat.data.account.entitlement.usage.windows, 1);

    const secondDevice = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.22' },
      body: extensionBody({ email, password: initialPassword, deviceId: 'device-87654321', browserInstanceId: 'browser-87654321' }),
    });
    assert.equal(secondDevice.response.status, 409);
    assert.equal(secondDevice.data.error.code, 'DEVICE_LIMIT');

    // Admin can find the user, override limits, and cross-origin browser writes are rejected.
    const listUsers = await jsonRequest(`${base}/admin/api/account/users?q=member%40example.com`, { headers: { cookie } });
    assert.equal(listUsers.response.status, 200);
    assert.equal(listUsers.data.users.length, 1);
    const user = listUsers.data.users[0];
    assert.equal(user.email, email);

    const csrfBlocked = await jsonRequest(`${base}/admin/api/account/users/${user.id}`, {
      method: 'PATCH', headers: { cookie, origin: 'https://evil.example' }, body: { maxDevicesOverride: 99 },
    });
    assert.equal(csrfBlocked.response.status, 403);
    assert.equal(csrfBlocked.data.error.code, 'ADMIN_ORIGIN_MISMATCH');

    const override = await jsonRequest(`${base}/admin/api/account/users/${user.id}`, {
      method: 'PATCH', headers: { cookie }, body: { maxDevicesOverride: 2, maxWindowsOverride: 2 },
    });
    assert.equal(override.response.status, 200);
    assert.equal(override.data.user.entitlement.limits.devices, 2);
    assert.equal(override.data.user.entitlement.limits.windows, 2);

    const secondDeviceAllowed = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.23' },
      body: extensionBody({ email, password: initialPassword, deviceId: 'device-87654321', browserInstanceId: 'browser-87654321' }),
    });
    assert.equal(secondDeviceAllowed.response.status, 200);

    // Configure encrypted SMTP credential and WeChat payment entry.
    const saveSettings = await jsonRequest(`${base}/admin/api/account/settings`, {
      method: 'PUT', headers: { cookie }, body: {
        free: { days: 7, maxDevices: 1, maxWindows: 1 },
        sessionDays: 30,
        smtp: {
          host: 'smtp.example.com', port: 465, secure: true, username: 'mailer@example.com',
          password: 'smtp-secret-should-not-be-plaintext', fromEmail: 'mailer@example.com', fromName: 'GPTLock',
        },
        paymentMethods: [
          { code: 'wechat', enabled: true, payUrl: 'https://pay.example.com/wechat#ignored', instructions: '付款后等待确认' },
          { code: 'alipay', enabled: false, payUrl: '', instructions: '' },
        ],
      },
    });
    assert.equal(saveSettings.response.status, 200);
    assert.equal(saveSettings.data.settings.smtp.passwordConfigured, true);
    assert.equal(saveSettings.data.settings.paymentMethods.find((item) => item.code === 'wechat').payUrl, 'https://pay.example.com/wechat');

    inspectDb = new DatabaseSync(dbPath);
    const smtpSecret = inspectDb.prepare(`SELECT ciphertext FROM secure_settings WHERE key='smtp_password'`).get();
    assert.ok(smtpSecret?.ciphertext);
    assert.equal(smtpSecret.ciphertext.includes('smtp-secret-should-not-be-plaintext'), false);
    assert.equal(inspectDb.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash.includes(initialPassword), false);

    // Admin can configure plans; client sees only enabled payment methods and public benefits.
    const planUpdate = await jsonRequest(`${base}/admin/api/account/plans/monthly`, {
      method: 'PUT', headers: { cookie }, body: {
        name: '月卡 Pro', priceCents: 1999, durationDays: 30, maxDevices: 4, maxWindows: 4,
        benefits: ['30 天会员', '4 台设备', '4 个同时窗口'], enabled: true,
      },
    });
    assert.equal(planUpdate.response.status, 200);

    const clientConfig = await jsonRequest(`${base}/api/v1/account/config`, { headers: { origin: ORIGIN } });
    const monthly = clientConfig.data.plans.find((plan) => plan.code === 'monthly');
    assert.equal(monthly.priceCents, 1999);
    assert.equal(monthly.limits.devices, 4);
    assert.deepEqual(clientConfig.data.paymentMethods.map((method) => method.code), ['wechat']);

    // User creates order; admin marks paid; membership becomes active and raises benefits.
    const createOrder = await jsonRequest(`${base}/api/v1/account/orders`, {
      method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${firstToken}` }, body: { planCode: 'monthly', paymentMethod: 'wechat' },
    });
    assert.equal(createOrder.response.status, 201);
    assert.equal(createOrder.data.order.amountCents, 1999);
    assert.equal(createOrder.data.order.payUrl, 'https://pay.example.com/wechat');
    assert.equal(createOrder.data.order.status, 'pending');
    assert.equal(createOrder.data.order.planSnapshot.name, '月卡 Pro');
    assert.equal(createOrder.data.order.planSnapshot.maxDevices, 4);

    // Existing orders must keep the purchased terms even if the administrator changes the plan before payment confirmation.
    const futurePlanUpdate = await jsonRequest(`${base}/admin/api/account/plans/monthly`, {
      method: 'PUT', headers: { cookie }, body: {
        name: '月卡 Future', priceCents: 2999, durationDays: 45, maxDevices: 8, maxWindows: 8,
        benefits: ['45 天会员', '8 台设备', '8 个同时窗口'], enabled: true,
      },
    });
    assert.equal(futurePlanUpdate.response.status, 200);

    const markPaid = await jsonRequest(`${base}/admin/api/account/orders/${createOrder.data.order.id}/mark-paid`, {
      method: 'POST', headers: { cookie }, body: {},
    });
    assert.equal(markPaid.response.status, 200);
    assert.equal(markPaid.data.order.status, 'paid');

    const meAfterMembership = await jsonRequest(`${base}/api/v1/account/me`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${firstToken}` },
    });
    assert.equal(meAfterMembership.response.status, 200);
    assert.equal(meAfterMembership.data.account.membership.planCode, 'monthly');
    assert.equal(meAfterMembership.data.account.membership.name, '月卡 Pro');
    assert.deepEqual(meAfterMembership.data.account.membership.limits, { devices: 4, windows: 4 });
    // Per-user overrides intentionally remain stronger than the frozen purchased plan defaults.
    assert.equal(meAfterMembership.data.account.entitlement.limits.devices, 2);
    assert.equal(meAfterMembership.data.account.entitlement.limits.windows, 2);

    // Forgot-password does not reveal account existence, and reset revokes old sessions.
    const forgotUnknown = await jsonRequest(`${base}/api/v1/auth/forgot-password`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.30' }, body: extensionBody({ email: 'unknown@example.com' }),
    });
    assert.equal(forgotUnknown.response.status, 200);
    const forgotKnown = await jsonRequest(`${base}/api/v1/auth/forgot-password`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.31' }, body: extensionBody({ email }),
    });
    assert.equal(forgotKnown.response.status, 200);
    assert.equal(forgotKnown.data.message, forgotUnknown.data.message);

    const resetCode = latestCode(await testOutbox(base, cookie), email, 'reset_password');
    const reset = await jsonRequest(`${base}/api/v1/auth/reset-password`, {
      method: 'POST', headers: { origin: ORIGIN }, body: extensionBody({ email, code: resetCode, newPassword: resetPassword }),
    });
    assert.equal(reset.response.status, 200);

    const oldSession = await jsonRequest(`${base}/api/v1/account/me`, { headers: { origin: ORIGIN, authorization: `Bearer ${firstToken}` } });
    assert.equal(oldSession.response.status, 401);
    assert.equal(oldSession.data.error.code, 'AUTH_REQUIRED');

    const loginWithOldPassword = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.32' }, body: extensionBody({ email, password: initialPassword }),
    });
    assert.equal(loginWithOldPassword.response.status, 401);

    const newLogin = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.33' }, body: extensionBody({ email, password: resetPassword }),
    });
    assert.equal(newLogin.response.status, 200);
    const newToken = newLogin.data.sessionToken;

    // Account disable immediately revokes all sessions.
    const disable = await jsonRequest(`${base}/admin/api/account/users/${user.id}`, {
      method: 'PATCH', headers: { cookie }, body: { status: 'disabled' },
    });
    assert.equal(disable.response.status, 200);
    const disabledSession = await jsonRequest(`${base}/api/v1/account/me`, { headers: { origin: ORIGIN, authorization: `Bearer ${newToken}` } });
    assert.equal(disabledSession.response.status, 401);

    // Runtime logs never include raw credentials/codes/session tokens.
    const runtime = await jsonRequest(`${base}/admin/api/runtime-logs?limit=500`, { headers: { cookie } });
    assert.equal(runtime.response.status, 200);
    assert.ok(runtime.data.logs.some((entry) => entry.event === 'server_started'));
    const serializedRuntime = JSON.stringify(runtime.data.logs);
    for (const secret of [adminPassword, initialPassword, resetPassword, verifyCode, resetCode, firstToken, newToken, 'smtp-secret-should-not-be-plaintext']) {
      assert.equal(serializedRuntime.includes(secret), false, `runtime log leaked: ${secret.slice(0, 8)}`);
    }
    const rawRuntime = await readFile(runtimeLogPath, 'utf8');
    assert.equal(rawRuntime.includes(initialPassword), false);
    assert.equal(rawRuntime.includes(firstToken), false);
    assert.equal(rawRuntime.includes(verifyCode), false);

    // Existing update control-plane remains available.
    const updateInfo = await jsonRequest(`${base}/admin/api/update`, { headers: { cookie } });
    assert.equal(updateInfo.response.status, 200);
    assert.equal(updateInfo.data.ok, true);
    assert.equal(updateInfo.data.serverVersion, '0.2.0');
    const update = await jsonRequest(`${base}/admin/api/update`, { method: 'POST', headers: { cookie }, body: {} });
    assert.equal(update.response.status, 202);
    assert.equal(update.data.status.status, 'queued');
  } finally {
    inspectDb?.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
