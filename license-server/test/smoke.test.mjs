import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

async function waitForHealth(port, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`license server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('license server did not become healthy');
}

test('license server enforces device and window limits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptlock-license-test-'));
  const port = 32000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GPTLOCK_LICENSE_HOST: '127.0.0.1',
      GPTLOCK_LICENSE_PORT: String(port),
      GPTLOCK_LICENSE_DB: join(dir, 'license.sqlite3'),
      GPTLOCK_LICENSE_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      GPTLOCK_LICENSE_ADMIN_PASSWORD: 'test-password-12345',
      GPTLOCK_LICENSE_SECRET: '0123456789abcdef0123456789abcdef',
    },
  });
  try {
    await waitForHealth(port, child);
    const login = await fetch(`http://127.0.0.1:${port}/admin/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password-12345' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const create = await fetch(`http://127.0.0.1:${port}/admin/api/licenses`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ maxDevices: 1, maxWindows: 2, expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
    const created = await create.json();
    assert.equal(created.ok, true);
    assert.match(created.code, /^GPTL-/);

    const activate = await fetch(`http://127.0.0.1:${port}/api/v1/licenses/activate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://testextensionid' }, body: JSON.stringify({ code: created.code, deviceId: 'device-12345678', browserInstanceId: 'browser-12345678', extensionId: 'testextensionid', extensionVersion: 'test' }) });
    const activated = await activate.json();
    assert.equal(activated.ok, true);

    const heartbeat = await fetch(`http://127.0.0.1:${port}/api/v1/licenses/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${activated.activationToken}`, origin: 'chrome-extension://testextensionid' }, body: JSON.stringify({ windowKeys: ['browser-12345678:1', 'browser-12345678:2', 'browser-12345678:3'] }) });
    const beat = await heartbeat.json();
    assert.deepEqual(beat.allowedWindowKeys, ['browser-12345678:1', 'browser-12345678:2']);
    assert.deepEqual(beat.deniedWindowKeys, ['browser-12345678:3']);

    const secondDevice = await fetch(`http://127.0.0.1:${port}/api/v1/licenses/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: created.code, deviceId: 'device-87654321', browserInstanceId: 'browser-87654321' }) });
    assert.equal(secondDevice.status, 409);
    assert.equal((await secondDevice.json()).error.code, 'DEVICE_LIMIT');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
