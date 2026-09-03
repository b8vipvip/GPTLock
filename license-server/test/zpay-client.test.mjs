import test from 'node:test';
import assert from 'node:assert/strict';
import { centsFromZpayMoney, verifyZpaySignature, zpayMoneyFromCents, zpaySign } from '../zpay-client.mjs';

test('ZPAY MD5 signing follows ASCII key order and excludes sign/sign_type/empty values', () => {
  const params = { type: 'alipay', pid: '10001', money: '19.00', out_trade_no: '202609030001', empty: '', sign_type: 'MD5' };
  const sign = zpaySign(params, 'merchant-secret');
  const callback = new URLSearchParams({ ...params, sign, sign_type: 'MD5' });
  assert.equal(verifyZpaySignature(callback, 'merchant-secret'), true);
  callback.set('money', '19.01');
  assert.equal(verifyZpaySignature(callback, 'merchant-secret'), false);
});

test('ZPAY money conversion is exact to cents', () => {
  assert.equal(zpayMoneyFromCents(1900), '19.00');
  assert.equal(centsFromZpayMoney('19'), 1900);
  assert.equal(centsFromZpayMoney('19.0'), 1900);
  assert.equal(centsFromZpayMoney('19.00'), 1900);
  assert.equal(centsFromZpayMoney('19.001'), null);
});
