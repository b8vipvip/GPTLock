import { createHmac } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://www.okx.com';

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('OKX API base URL must use HTTPS');
  const host = parsed.hostname.toLowerCase();
  if (!(host === 'okx.com' || host.endsWith('.okx.com'))) throw new Error('OKX API base URL must be an official okx.com host');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function asPositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function createOkxClient({
  apiKey,
  secretKey,
  passphrase,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  now = () => new Date(),
} = {}) {
  const key = String(apiKey || '').trim();
  const secret = String(secretKey || '');
  const phrase = String(passphrase || '');
  if (!key || !secret || !phrase) throw new Error('OKX API credentials are incomplete');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');
  const origin = normalizeBaseUrl(baseUrl);
  const timeout = asPositiveInt(timeoutMs, 10_000, 1_000, 30_000);

  async function privateGet(pathname, params = {}) {
    if (!String(pathname || '').startsWith('/api/')) throw new Error('Invalid OKX API path');
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '') continue;
      query.set(name, String(value));
    }
    const requestPath = `${pathname}${query.size ? `?${query.toString()}` : ''}`;
    const timestamp = now().toISOString();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}GET${requestPath}`)
      .digest('base64');
    const response = await fetchImpl(`${origin}${requestPath}`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'OK-ACCESS-KEY': key,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': phrase,
      },
      signal: AbortSignal.timeout(timeout),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = String(body?.msg || body?.message || `HTTP ${response.status}`).slice(0, 300);
      throw Object.assign(new Error(`OKX API request failed: ${message}`), { status: response.status });
    }
    if (!body || String(body.code) !== '0' || !Array.isArray(body.data)) {
      throw new Error(`OKX API rejected request: ${String(body?.msg || body?.code || 'invalid response').slice(0, 300)}`);
    }
    return body.data;
  }

  function getDepositHistory({ ccy = 'USDT', limit = 100, state = '' } = {}) {
    return privateGet('/api/v5/asset/deposit-history', {
      ccy: String(ccy || 'USDT').toUpperCase(),
      state: state === '' ? undefined : state,
      limit: asPositiveInt(limit, 100, 1, 100),
    });
  }

  return { privateGet, getDepositHistory, baseUrl: origin };
}

export const OKX_DEFAULT_BASE_URL = DEFAULT_BASE_URL;
