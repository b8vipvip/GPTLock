import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createOkxClient } from '../okx-client.mjs';

test('signs OKX private deposit-history requests with required headers', async () => {
  const timestamp = new Date('2026-09-03T01:00:00.000Z');
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      async json() { return { code: '0', msg: '', data: [{ ccy: 'USDT', state: '2' }] }; },
    };
  };
  const client = createOkxClient({
    apiKey: 'read-only-key',
    secretKey: 'super-secret',
    passphrase: 'passphrase',
    fetchImpl,
    now: () => timestamp,
  });

  const rows = await client.getDepositHistory({ ccy: 'USDT', limit: 100 });
  assert.equal(rows.length, 1);
  const requestPath = '/api/v5/asset/deposit-history?ccy=USDT&limit=100';
  assert.equal(captured.url, `https://www.okx.com${requestPath}`);
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['OK-ACCESS-KEY'], 'read-only-key');
  assert.equal(captured.init.headers['OK-ACCESS-PASSPHRASE'], 'passphrase');
  assert.equal(captured.init.headers['OK-ACCESS-TIMESTAMP'], timestamp.toISOString());
  const expected = createHmac('sha256', 'super-secret')
    .update(`${timestamp.toISOString()}GET${requestPath}`)
    .digest('base64');
  assert.equal(captured.init.headers['OK-ACCESS-SIGN'], expected);
});

test('rejects non-official or non-HTTPS OKX base URLs', () => {
  const common = { apiKey: 'k', secretKey: 's', passphrase: 'p', fetchImpl: async () => ({ ok: true, json: async () => ({ code: '0', data: [] }) }) };
  assert.throws(() => createOkxClient({ ...common, baseUrl: 'http://www.okx.com' }), /HTTPS/);
  assert.throws(() => createOkxClient({ ...common, baseUrl: 'https://okx.example.com' }), /official okx.com host/);
});
