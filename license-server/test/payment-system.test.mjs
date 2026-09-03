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

function paymentRuntimeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  return db;
}

function createRuntimeSchema(db) {
  db.exec(`
    CREATE TABLE membership_plans (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      max_devices INTEGER NOT NULL,
      max_windows INTEGER NOT NULL,
      benefits_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE membership_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_code TEXT NOT NULL REFERENCES membership_plans(code),
      payment_method TEXT NOT NULL REFERENCES payment_methods(code),
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled','expired')),
      pay_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      paid_at TEXT,
      membership_id INTEGER,
      plan_snapshot_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    INSERT INTO membership_plans(code,name,price_cents,duration_days,max_devices,max_windows,benefits_json,enabled,sort_order,created_at,updated_at)
      VALUES('monthly','月卡',2900,30,2,10,'[]',1,10,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
  `);
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
  payments.close();
  db.close();
});

test('freezes unique USDT amounts and settles only final successful exact OKX deposits', async () => {
  const db = paymentRuntimeDb();
  let depositRows = [];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() { return { code: '0', msg: '', data: depositRows }; },
  });
  const payments = createPaymentSystem({
    db,
    publicOrigin: 'https://gptlock.example',
    json,
    secret: 'test-secret-at-least-thirty-two-characters-long',
    fetchImpl,
    logger: { warn() {} },
  });
  createRuntimeSchema(db);

  let res = responseCapture();
  await payments.handleAdmin(request('PUT', {
    enabled: true,
    payUrl: 'https://www.okx.com/pay/example',
    crypto: { asset: 'USDT', network: 'USDT-TRC20', address: 'TExampleAddress', memo: '' },
  }), res, new URL('https://gptlock.example/admin/api/payments/usdt'));
  assert.equal(res.status, 200);

  res = responseCapture();
  await payments.handleAdmin(request('PUT', { prices: { monthly: '4.5' } }), res,
    new URL('https://gptlock.example/admin/api/payments/usdt/prices'));
  assert.equal(res.status, 200);

  res = responseCapture();
  await payments.handleAdmin(request('PUT', {
    enabled: true,
    apiKey: 'read-key',
    secretKey: 'read-secret',
    passphrase: 'read-passphrase',
    pollSeconds: 300,
    orderTtlMinutes: 120,
    allowInternalTransfers: true,
  }), res, new URL('https://gptlock.example/admin/api/payments/usdt/okx'));
  assert.equal(res.status, 200);

  const now = Date.now();
  const createdAt = new Date(now - 1_000).toISOString();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`INSERT INTO membership_orders(user_id,plan_code,payment_method,amount_cents,status,pay_url,created_at,expires_at,plan_snapshot_json)
    VALUES(1,'monthly','usdt',2900,'pending','https://www.okx.com/pay/example',?,?, '{}')`);
  const id1 = Number(insert.run(createdAt, expiresAt).lastInsertRowid);
  const id2 = Number(insert.run(createdAt, expiresAt).lastInsertRowid);
  payments.attachUsdtOrder(id1, payments.usdtQuote('monthly'));
  payments.attachUsdtOrder(id2, payments.usdtQuote('monthly'));
  const p1 = payments.orderPaymentDetails(id1);
  const p2 = payments.orderPaymentDetails(id2);
  assert.equal(p1.amount, '4.5');
  assert.equal(p2.amount, '4.500001');

  const settled = [];
  payments.attachSettlement((orderId, context) => {
    settled.push({ orderId, context });
    db.prepare("UPDATE membership_orders SET status='paid',paid_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(), orderId);
  });
  payments.close();

  depositRows = [{
    ccy: 'USDT', chain: 'USDT-TRC20', amt: p1.amount, to: 'TExampleAddress', txId: 'tx-1', depId: 'dep-1',
    ts: String(now), state: '1', type: '4', actualDepBlkConfirm: '20',
  }];
  let check = await payments.runAutoSettlement({ force: true });
  assert.equal(check.settled, 0);
  assert.equal(settled.length, 0);
  assert.equal(payments.orderPaymentDetails(id1).matchStatus, 'confirming');
  assert.equal(db.prepare('SELECT status FROM membership_orders WHERE id=?').get(id1).status, 'pending');

  depositRows[0] = { ...depositRows[0], state: '2' };
  check = await payments.runAutoSettlement({ force: true });
  assert.equal(check.settled, 1);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].orderId, id1);
  assert.equal(settled[0].context.depositId, 'dep-1');
  assert.equal(payments.orderPaymentDetails(id1).matchStatus, 'settled');
  assert.equal(db.prepare('SELECT status FROM membership_orders WHERE id=?').get(id1).status, 'paid');
  assert.equal(db.prepare('SELECT status FROM membership_orders WHERE id=?').get(id2).status, 'pending');

  depositRows = [{
    ccy: 'USDT', chain: 'USDT-TRC20', amt: p2.amount, to: 'TExampleAddress', txId: 'tx-2', depId: 'dep-2',
    ts: String(now + 1_000), state: '2', type: '4', actualDepBlkConfirm: '20',
  }];
  check = await payments.runAutoSettlement({ force: true });
  assert.equal(check.settled, 1);
  assert.equal(settled.length, 2);
  assert.equal(settled[1].orderId, id2);
  assert.equal(db.prepare('SELECT status FROM membership_orders WHERE id=?').get(id2).status, 'paid');

  payments.close();
  db.close();
});
