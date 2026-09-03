import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createPaymentSystem } from '../payment-system.mjs';

function request(method, body = null) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}
function responseCapture() {
  return {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(payload = Buffer.alloc(0)) { this.body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)); },
  };
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function legacyDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE payment_methods (
      code TEXT PRIMARY KEY CHECK(code IN ('wechat','alipay')),
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
      pay_url TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE membership_orders (
      id INTEGER PRIMARY KEY,
      payment_method TEXT NOT NULL REFERENCES payment_methods(code)
    ) STRICT;
    INSERT INTO payment_methods(code,name,enabled,pay_url,instructions,updated_at)
      VALUES('wechat','微信支付',1,'','legacy','2026-09-03T00:00:00.000Z');
    INSERT INTO membership_orders(id,payment_method) VALUES(1,'wechat');
  `);
  return db;
}

test('migrates legacy payment method constraint and preserves foreign keys', () => {
  const db = legacyDb();
  const payments = createPaymentSystem({ db, publicOrigin: 'https://gptlock.example', json });
  const codes = payments.list(false).map((row) => row.code);
  assert.deepEqual(codes, ['wechat', 'alipay', 'usdt']);
  assert.equal(db.prepare("SELECT instructions FROM payment_methods WHERE code='wechat'").get().instructions, 'legacy');
  assert.equal(db.prepare('SELECT payment_method FROM membership_orders WHERE id=1').get().payment_method, 'wechat');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('saves USDT link/network and serves uploaded QR', async () => {
  const db = legacyDb();
  const payments = createPaymentSystem({ db, publicOrigin: 'https://gptlock.example', json });

  const putRes = responseCapture();
  const putHandled = await payments.handleAdmin(request('PUT', {
    enabled: true,
    payUrl: 'https://www.okx.com/example-payment',
    instructions: 'Pay exact amount shown in the order.',
    crypto: { asset: 'USDT', network: 'USDT-TRC20', address: 'TExampleAddress', memo: '' },
  }), putRes, new URL('https://gptlock.example/admin/api/payments/usdt'));
  assert.equal(putHandled, true);
  assert.equal(putRes.status, 200);
  const usdt = payments.list(false).find((row) => row.code === 'usdt');
  assert.equal(usdt.enabled, true);
  assert.equal(usdt.crypto.network, 'USDT-TRC20');
  assert.equal(usdt.crypto.address, 'TExampleAddress');

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const uploadRes = responseCapture();
  await payments.handleAdmin(request('POST', { dataUrl: `data:image/png;base64,${png.toString('base64')}` }), uploadRes,
    new URL('https://gptlock.example/admin/api/payments/wechat/qr'));
  assert.equal(uploadRes.status, 200);
  const wechat = payments.list(false).find((row) => row.code === 'wechat');
  assert.equal(wechat.qrConfigured, true);
  assert.equal(wechat.payUrl, 'https://gptlock.example/site/api/payment-qr/wechat');

  const qrRes = responseCapture();
  const qrReq = request('GET');
  const qrHandled = await payments.handleSite(qrReq, qrRes, new URL('https://gptlock.example/site/api/payment-qr/wechat'));
  assert.equal(qrHandled, true);
  assert.equal(qrRes.status, 200);
  assert.equal(qrRes.headers['content-type'], 'image/png');
  assert.deepEqual(qrRes.body, png);
  db.close();
});
