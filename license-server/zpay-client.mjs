import { createHash, timingSafeEqual } from 'node:crypto';

export const ZPAY_ORIGIN = 'https://zpayz.cn';
export const ZPAY_SUBMIT_URL = `${ZPAY_ORIGIN}/submit.php`;
export const ZPAY_API_URL = `${ZPAY_ORIGIN}/api.php`;

function cleanEntries(input) {
  const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input || {});
  return entries
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => [String(key), String(value)])
    .sort(([a], [b]) => a.localeCompare(b, 'en'));
}

export function zpaySign(input, key) {
  const canonical = cleanEntries(input).map(([name, value]) => `${name}=${value}`).join('&');
  return createHash('md5').update(`${canonical}${String(key || '')}`, 'utf8').digest('hex');
}

export function verifyZpaySignature(input, key) {
  const provided = input instanceof URLSearchParams ? input.get('sign') : input?.sign;
  const signType = input instanceof URLSearchParams ? input.get('sign_type') : input?.sign_type;
  if (!provided || String(signType || '').toUpperCase() !== 'MD5') return false;
  const expected = zpaySign(input, key);
  const left = Buffer.from(String(provided).toLowerCase());
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function centsFromZpayMoney(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function zpayMoneyFromCents(value) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid payment amount');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function createZpayClient({ pid, key, fetchImpl = globalThis.fetch }) {
  const merchantId = String(pid || '').trim();
  const merchantKey = String(key || '');
  if (!merchantId || !merchantKey) throw new Error('ZPAY merchant credentials are incomplete');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  async function request(params) {
    const url = new URL(ZPAY_API_URL);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || Number(body.code) !== 1) {
      const error = new Error(body?.msg || `ZPAY API HTTP ${response.status}`);
      error.code = 'ZPAY_API_ERROR';
      error.status = 502;
      throw error;
    }
    return body;
  }

  return {
    queryBalance() { return request({ act: 'balance', pid: merchantId, key: merchantKey }); },
    queryOrder(outTradeNo) { return request({ act: 'order', pid: merchantId, key: merchantKey, out_trade_no: String(outTradeNo) }); },
  };
}
