from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'pattern not unique in {path}: {text.count(old)} matches')
    write(path, text.replace(old, new, 1))


# 1) ZPAY protocol helper. Keep the gateway host fixed to the provider documented endpoint.
write('license-server/zpay-client.mjs', r'''import { createHash, timingSafeEqual } from 'node:crypto';

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
''')

# 2) Payment runtime: provider mode, encrypted ZPAY key, signed checkout, callback settlement.
replace_once(
    'license-server/payment-system.mjs',
    "import { createOkxClient, OKX_DEFAULT_BASE_URL } from './okx-client.mjs';\n",
    "import { createOkxClient, OKX_DEFAULT_BASE_URL } from './okx-client.mjs';\nimport { createZpayClient, centsFromZpayMoney, verifyZpaySignature, zpayMoneyFromCents, zpaySign, ZPAY_SUBMIT_URL } from './zpay-client.mjs';\n",
)

replace_once(
    'license-server/payment-system.mjs',
    "  const status = { lastCheckAt: null, lastSuccessAt: null, lastError: '', lastMatchedOrderId: null };\n",
    "  const status = { lastCheckAt: null, lastSuccessAt: null, lastError: '', lastMatchedOrderId: null };\n  const zpayStatus = { lastTestAt: null, lastError: '' };\n",
)

replace_once(
    'license-server/payment-system.mjs',
    "      CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_payment_tx_id ON usdt_order_payments(okx_tx_id) WHERE okx_tx_id<>'';\n",
    "      CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_payment_tx_id ON usdt_order_payments(okx_tx_id) WHERE okx_tx_id<>'';\n      CREATE TABLE IF NOT EXISTS zpay_order_payments (\n        order_id INTEGER PRIMARY KEY REFERENCES membership_orders(id) ON DELETE CASCADE,\n        merchant_trade_no TEXT NOT NULL UNIQUE,\n        channel TEXT NOT NULL CHECK(channel IN ('alipay','wxpay')),\n        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),\n        client_ip TEXT NOT NULL DEFAULT '',\n        user_agent TEXT NOT NULL DEFAULT '',\n        zpay_trade_no TEXT NOT NULL DEFAULT '',\n        status TEXT NOT NULL DEFAULT 'awaiting' CHECK(status IN ('awaiting','settled','error')),\n        paid_at TEXT,\n        last_error TEXT NOT NULL DEFAULT '',\n        updated_at TEXT NOT NULL\n      ) STRICT;\n      CREATE UNIQUE INDEX IF NOT EXISTS idx_zpay_trade_no ON zpay_order_payments(zpay_trade_no) WHERE zpay_trade_no<>'';\n",
)

okx_anchor = """  function method(code, enabledOnly = false) {\n"""
zpay_helpers = r'''  function paymentProvider(code) {
    if (!['wechat', 'alipay'].includes(code)) return code === 'usdt' ? 'okx' : 'manual';
    const value = getSetting(`payment_provider_${code}`, 'manual');
    return value === 'zpay' ? 'zpay' : 'manual';
  }
  function cleanChannelIds(value) {
    const raw = cleanText(value, 240).replace(/\s+/g, '');
    if (!raw) return '';
    if (!/^\d+(?:,\d+)*$/.test(raw)) throw Object.assign(new Error('ZPAY 支付渠道 ID 只能填写数字，多个 ID 使用英文逗号分隔'), { status: 400, code: 'INVALID_ZPAY_CID' });
    return raw;
  }
  function zpayConfig() {
    const pid = getSetting('zpay_pid', '');
    const key = getSecureSetting('zpay_key');
    return {
      enabled: getSetting('zpay_enabled', '0') === '1',
      configured: Boolean(pid && key),
      pid,
      key,
      pidHint: pid ? `${pid.slice(0, 4)}…${pid.slice(-4)}` : '',
      alipayCid: getSetting('zpay_alipay_cid', ''),
      wechatCid: getSetting('zpay_wechat_cid', ''),
      submitUrl: ZPAY_SUBMIT_URL,
    };
  }
  function zpayChannelForPayment(code) {
    return code === 'alipay' ? 'alipay' : code === 'wechat' ? 'wxpay' : '';
  }
  function zpayAvailableForPayment(code) {
    if (paymentProvider(code) !== 'zpay') return false;
    const config = zpayConfig();
    return Boolean(config.enabled && config.configured && zpayChannelForPayment(code));
  }
  function zpayClient() {
    const config = zpayConfig();
    if (!config.configured) throw Object.assign(new Error('ZPAY 商户 ID / 商户密钥尚未配置完整'), { status: 409, code: 'ZPAY_NOT_CONFIGURED' });
    return createZpayClient({ pid: config.pid, key: config.key, fetchImpl });
  }
  function createZpayTradeNo(orderId) {
    const base = `${Date.now()}${String(Number(orderId)).padStart(10, '0')}`;
    return base.slice(0, 32);
  }
  function zpayOrderDetails(orderId) {
    ensureRuntimeTables();
    const row = db.prepare('SELECT * FROM zpay_order_payments WHERE order_id=?').get(Number(orderId));
    if (!row) return null;
    return {
      provider: 'zpay', merchantTradeNo: row.merchant_trade_no, tradeNo: row.zpay_trade_no || '',
      channel: row.channel, status: row.status, paidAt: row.paid_at, lastError: row.last_error || '',
    };
  }
  function prepareOrder(order, context = {}) {
    if (!order || !['wechat', 'alipay'].includes(order.payment_method) || paymentProvider(order.payment_method) !== 'zpay') return order;
    ensureRuntimeTables();
    if (!zpayAvailableForPayment(order.payment_method)) {
      throw Object.assign(new Error('ZPAY 尚未启用或商户凭据未配置完整'), { status: 409, code: 'ZPAY_NOT_READY' });
    }
    const existing = db.prepare('SELECT * FROM zpay_order_payments WHERE order_id=?').get(order.id);
    if (!existing) {
      const channel = zpayChannelForPayment(order.payment_method);
      let tradeNo = createZpayTradeNo(order.id);
      while (db.prepare('SELECT 1 FROM zpay_order_payments WHERE merchant_trade_no=?').get(tradeNo)) {
        tradeNo = `${Date.now()}${String(order.id).padStart(10, '0')}`.slice(0, 32);
      }
      db.prepare(`INSERT INTO zpay_order_payments(order_id,merchant_trade_no,channel,amount_cents,client_ip,user_agent,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(order.id, tradeNo, channel, Number(order.amount_cents), cleanText(context.clientIp, 64), cleanText(context.userAgent, 240), nowIso());
    }
    const payUrl = `${publicOrigin}/site/api/zpay/checkout/${order.id}`;
    db.prepare('UPDATE membership_orders SET pay_url=? WHERE id=?').run(payUrl, order.id);
    return db.prepare('SELECT * FROM membership_orders WHERE id=?').get(order.id);
  }
  function zpayCheckoutParams(orderId) {
    ensureRuntimeTables();
    const detail = db.prepare(`SELECT z.*,o.status AS order_status,o.amount_cents,o.plan_snapshot_json
      FROM zpay_order_payments z JOIN membership_orders o ON o.id=z.order_id WHERE z.order_id=?`).get(Number(orderId));
    if (!detail) throw Object.assign(new Error('ZPAY 订单不存在'), { status: 404, code: 'ZPAY_ORDER_NOT_FOUND' });
    if (detail.order_status !== 'pending') throw Object.assign(new Error('该订单已不是待支付状态'), { status: 409, code: 'ORDER_NOT_PENDING' });
    const config = zpayConfig();
    if (!config.enabled || !config.configured) throw Object.assign(new Error('ZPAY 当前不可用'), { status: 409, code: 'ZPAY_NOT_READY' });
    let snapshot = {};
    try { snapshot = JSON.parse(detail.plan_snapshot_json || '{}'); } catch {}
    const planName = cleanText(snapshot.name || snapshot.code || '会员', 60).replace(/[<>]/g, '');
    const params = {
      pid: config.pid,
      type: detail.channel,
      out_trade_no: detail.merchant_trade_no,
      notify_url: `${publicOrigin}/site/api/zpay/notify`,
      return_url: `${publicOrigin}/site/api/zpay/return`,
      name: `GPTWork ${planName} 会员服务`.slice(0, 100),
      money: zpayMoneyFromCents(detail.amount_cents),
      param: `order-${detail.order_id}`,
    };
    const cid = detail.channel === 'alipay' ? config.alipayCid : config.wechatCid;
    if (cid) params.cid = cid;
    params.sign = zpaySign(params, config.key);
    params.sign_type = 'MD5';
    return params;
  }
  function htmlEscape(value) {
    return String(value).replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[char]);
  }
  function writePlain(res, statusCode, value) {
    const payload = Buffer.from(String(value), 'utf8');
    res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(payload);
  }
  async function settleZpayCallback(url) {
    ensureRuntimeTables();
    const config = zpayConfig();
    if (!config.configured) throw Object.assign(new Error('ZPAY 凭据未配置'), { status: 503, code: 'ZPAY_NOT_CONFIGURED' });
    if (!verifyZpaySignature(url.searchParams, config.key)) throw Object.assign(new Error('ZPAY 回调签名校验失败'), { status: 400, code: 'ZPAY_BAD_SIGNATURE' });
    if (url.searchParams.get('pid') !== config.pid) throw Object.assign(new Error('ZPAY 回调商户 ID 不匹配'), { status: 400, code: 'ZPAY_PID_MISMATCH' });
    if (url.searchParams.get('trade_status') !== 'TRADE_SUCCESS') throw Object.assign(new Error('ZPAY 回调尚未支付成功'), { status: 409, code: 'ZPAY_NOT_PAID' });
    const merchantTradeNo = cleanText(url.searchParams.get('out_trade_no'), 32);
    const detail = db.prepare(`SELECT z.*,o.status AS order_status,o.amount_cents,o.payment_method
      FROM zpay_order_payments z JOIN membership_orders o ON o.id=z.order_id WHERE z.merchant_trade_no=?`).get(merchantTradeNo);
    if (!detail) throw Object.assign(new Error('ZPAY 商户订单号不存在'), { status: 404, code: 'ZPAY_ORDER_NOT_FOUND' });
    const callbackCents = centsFromZpayMoney(url.searchParams.get('money'));
    if (callbackCents === null || callbackCents !== Number(detail.amount_cents)) throw Object.assign(new Error('ZPAY 回调金额与订单金额不一致'), { status: 400, code: 'ZPAY_AMOUNT_MISMATCH' });
    if (url.searchParams.get('type') !== detail.channel) throw Object.assign(new Error('ZPAY 回调支付渠道不匹配'), { status: 400, code: 'ZPAY_CHANNEL_MISMATCH' });
    if (detail.status === 'settled' || detail.order_status === 'paid') return detail.order_id;
    if (!settleOrderById) throw Object.assign(new Error('会员自动开通回调尚未就绪'), { status: 503, code: 'SETTLEMENT_NOT_READY' });
    const providerTradeNo = cleanText(url.searchParams.get('trade_no'), 160);
    try {
      await Promise.resolve(settleOrderById(detail.order_id, {
        source: 'zpay_auto', tradeNo: providerTradeNo, merchantTradeNo, channel: detail.channel, amount: url.searchParams.get('money') || '',
      }));
      const paidAt = nowIso();
      db.prepare(`UPDATE zpay_order_payments SET zpay_trade_no=?,status='settled',paid_at=?,last_error='',updated_at=? WHERE order_id=?`)
        .run(providerTradeNo, paidAt, paidAt, detail.order_id);
      return detail.order_id;
    } catch (error) {
      db.prepare(`UPDATE zpay_order_payments SET status='error',last_error=?,updated_at=? WHERE order_id=?`)
        .run(cleanText(error?.message || error, 500), nowIso(), detail.order_id);
      throw error;
    }
  }

'''
replace_once('license-server/payment-system.mjs', okx_anchor, zpay_helpers + okx_anchor)

replace_once(
    'license-server/payment-system.mjs',
    """  function publicMethod(row) {\n    const qrConfigured = Boolean(row?.qr_blob && row?.qr_mime);\n    const config = row.code === 'usdt' ? okxConfig() : null;\n    return {\n      code: row.code,\n      name: row.name,\n      enabled: Boolean(row.enabled),\n      payUrl: row.pay_url || '',\n      instructions: row.instructions || '',\n      qrConfigured,\n      qrUrl: qrConfigured ? `${publicOrigin}/site/api/payment-qr/${row.code}` : '',\n""",
    """  function publicMethod(row) {\n    const provider = paymentProvider(row.code);\n    const zpay = provider === 'zpay' ? zpayConfig() : null;\n    const qrConfigured = provider === 'zpay' ? false : Boolean(row?.qr_blob && row?.qr_mime);\n    const config = row.code === 'usdt' ? okxConfig() : null;\n    return {\n      code: row.code,\n      name: row.name,\n      enabled: Boolean(row.enabled),\n      provider,\n      payUrl: provider === 'zpay' ? '' : (row.pay_url || ''),\n      instructions: row.instructions || '',\n      qrConfigured,\n      qrUrl: qrConfigured ? `${publicOrigin}/site/api/payment-qr/${row.code}` : '',\n""",
)
replace_once(
    'license-server/payment-system.mjs',
    """      autoConfirm: row.code === 'usdt' ? Boolean(config.enabled && config.configured) : false,\n    };\n  }\n  function list(enabledOnly = false) {\n    return db.prepare(`SELECT p.*,d.qr_mime,d.qr_blob,d.crypto_asset,d.crypto_network,d.crypto_address,d.crypto_memo\n      FROM payment_methods p LEFT JOIN payment_method_details d ON d.code=p.code\n      ${enabledOnly ? 'WHERE p.enabled=1' : ''}\n      ORDER BY CASE p.code WHEN 'wechat' THEN 10 WHEN 'alipay' THEN 20 WHEN 'usdt' THEN 30 ELSE 99 END,p.code`).all().map(publicMethod);\n  }\n""",
    """      autoConfirm: row.code === 'usdt' ? Boolean(config.enabled && config.configured) : (provider === 'zpay' ? Boolean(zpay.enabled && zpay.configured) : false),\n    };\n  }\n  function list(enabledOnly = false) {\n    const methods = db.prepare(`SELECT p.*,d.qr_mime,d.qr_blob,d.crypto_asset,d.crypto_network,d.crypto_address,d.crypto_memo\n      FROM payment_methods p LEFT JOIN payment_method_details d ON d.code=p.code\n      ${enabledOnly ? 'WHERE p.enabled=1' : ''}\n      ORDER BY CASE p.code WHEN 'wechat' THEN 10 WHEN 'alipay' THEN 20 WHEN 'usdt' THEN 30 ELSE 99 END,p.code`).all().map(publicMethod);\n    return enabledOnly ? methods.filter((item) => item.provider !== 'zpay' || item.autoConfirm) : methods;\n  }\n""",
)

replace_once(
    'license-server/payment-system.mjs',
    """      ...status,\n    };\n  }\n\n  async function handleAdmin(req, res, url) {\n""",
    """      ...status,\n    };\n  }\n  function adminZpayPublic() {\n    const config = zpayConfig();\n    return {\n      enabled: config.enabled, configured: config.configured, pidHint: config.pidHint,\n      alipayCid: config.alipayCid, wechatCid: config.wechatCid, submitUrl: config.submitUrl, ...zpayStatus,\n    };\n  }\n\n  async function handleAdmin(req, res, url) {\n""",
)

replace_once(
    'license-server/payment-system.mjs',
    """        return json(res, 200, { ok: true, paymentMethods: list(false), okx: adminOkxPublic(), usdtPlanPrices: planPriceMap() }), true;\n      }\n      const match = url.pathname.match(/^\\/admin\\/api\\/payments\\/(wechat|alipay|usdt)$/);\n""",
    """        return json(res, 200, { ok: true, paymentMethods: list(false), okx: adminOkxPublic(), zpay: adminZpayPublic(), usdtPlanPrices: planPriceMap() }), true;\n      }\n      if (url.pathname === '/admin/api/payments/zpay' && req.method === 'PUT') {\n        const input = await readJson(req, 128 * 1024);\n        if (input.clearCredentials === true) {\n          setSetting('zpay_pid', '');\n          setSecureSetting('zpay_key', '');\n          setSetting('zpay_enabled', '0');\n        } else {\n          if (input.pid !== undefined) {\n            const pid = cleanText(input.pid, 128);\n            if (pid && !/^[A-Za-z0-9]+$/.test(pid)) throw Object.assign(new Error('ZPAY 商户 ID 格式无效'), { status: 400, code: 'INVALID_ZPAY_PID' });\n            setSetting('zpay_pid', pid);\n          }\n          if (input.key !== undefined && String(input.key)) setSecureSetting('zpay_key', String(input.key).slice(0, 512));\n          if (input.enabled !== undefined) setSetting('zpay_enabled', input.enabled ? '1' : '0');\n        }\n        if (input.alipayCid !== undefined) setSetting('zpay_alipay_cid', cleanChannelIds(input.alipayCid));\n        if (input.wechatCid !== undefined) setSetting('zpay_wechat_cid', cleanChannelIds(input.wechatCid));\n        zpayStatus.lastError = '';\n        return json(res, 200, { ok: true, zpay: adminZpayPublic() }), true;\n      }\n      if (url.pathname === '/admin/api/payments/zpay/test' && req.method === 'POST') {\n        try {\n          const result = await zpayClient().queryBalance();\n          zpayStatus.lastTestAt = nowIso();\n          zpayStatus.lastError = '';\n          return json(res, 200, { ok: true, connected: true, balance: String(result.balance ?? ''), zpay: adminZpayPublic() }), true;\n        } catch (error) {\n          zpayStatus.lastTestAt = nowIso();\n          zpayStatus.lastError = cleanText(error?.message || error, 500);\n          throw error;\n        }\n      }\n      const match = url.pathname.match(/^\\/admin\\/api\\/payments\\/(wechat|alipay|usdt)$/);\n""",
)

replace_once(
    'license-server/payment-system.mjs',
    """        const instructions = input.instructions === undefined ? current.instructions : cleanText(input.instructions, 1000);\n        db.prepare('UPDATE payment_methods SET enabled=?,pay_url=?,instructions=?,updated_at=? WHERE code=?')\n          .run(enabled, payUrl, instructions, nowIso(), code);\n        if (code === 'usdt') {\n""",
    """        const instructions = input.instructions === undefined ? current.instructions : cleanText(input.instructions, 1000);\n        db.prepare('UPDATE payment_methods SET enabled=?,pay_url=?,instructions=?,updated_at=? WHERE code=?')\n          .run(enabled, payUrl, instructions, nowIso(), code);\n        if (code !== 'usdt' && input.provider !== undefined) {\n          if (!['manual', 'zpay'].includes(String(input.provider))) throw Object.assign(new Error('支付提供方仅支持 manual 或 zpay'), { status: 400, code: 'INVALID_PAYMENT_PROVIDER' });\n          setSetting(`payment_provider_${code}`, String(input.provider));\n        }\n        if (code === 'usdt') {\n""",
)

site_anchor = """  async function handleSite(req, res, url) {\n    if (url.pathname === '/site/api/payments' && req.method === 'GET') {\n"""
site_new = r'''  async function handleSite(req, res, url) {
    const checkoutMatch = url.pathname.match(/^\/site\/api\/zpay\/checkout\/(\d+)$/);
    if (checkoutMatch && req.method === 'GET') {
      try {
        const params = zpayCheckoutParams(Number(checkoutMatch[1]));
        const nonce = randomBytes(18).toString('base64url');
        const fields = Object.entries(params).map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}">`).join('');
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在前往 ZPAY</title></head><body><main><p>正在前往 ZPAY 安全收银台…</p><form id="zpay" method="post" action="${ZPAY_SUBMIT_URL}">${fields}<button type="submit">继续支付</button></form></main><script nonce="${nonce}">document.getElementById('zpay').submit();</script></body></html>`;
        const payload = Buffer.from(html, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; form-action https://zpayz.cn; base-uri 'none'; frame-ancestors 'none'`,
          'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
        });
        res.end(payload);
      } catch (error) { writePlain(res, error.status || 500, error.status ? error.message : 'ZPAY checkout failed'); }
      return true;
    }
    if (url.pathname === '/site/api/zpay/notify' && req.method === 'GET') {
      try {
        await settleZpayCallback(url);
        writePlain(res, 200, 'success');
      } catch (error) {
        logger.warn?.('GPTWork ZPAY notify rejected:', error.code || '', error.message);
        writePlain(res, error.status || 500, 'fail');
      }
      return true;
    }
    if (url.pathname === '/site/api/zpay/return' && req.method === 'GET') {
      let result = 'pending';
      try { await settleZpayCallback(url); result = 'success'; }
      catch (error) { logger.warn?.('GPTWork ZPAY return not settled:', error.code || '', error.message); }
      res.writeHead(302, { location: `${publicOrigin}/account?zpay=${result}`, 'cache-control': 'no-store' });
      res.end();
      return true;
    }
    if (url.pathname === '/site/api/payments' && req.method === 'GET') {
'''
replace_once('license-server/payment-system.mjs', site_anchor, site_new)

replace_once(
    'license-server/payment-system.mjs',
    """    orderPaymentDetails,\n    usdtOrderTtlMs,\n""",
    """    orderPaymentDetails,\n    prepareOrder,\n    zpayOrderDetails,\n    usdtOrderTtlMs,\n""",
)

# 3) Website order creation gets an order-specific signed ZPAY checkout URL.
replace_once(
    'license-server/site-account.mjs',
    """        const order = db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(result.lastInsertRowid));\n        if (usdtQuote) paymentSystem.attachUsdtOrder(order.id, usdtQuote);\n        return json(res, 201, { ok: true, order: orderPublic(order), instructions: method.instructions || '' }), true;\n""",
    """        let order = db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(result.lastInsertRowid));\n        if (usdtQuote) paymentSystem.attachUsdtOrder(order.id, usdtQuote);\n        order = paymentSystem.prepareOrder(order, { clientIp: clientIp(req), userAgent: req.headers['user-agent'] || '' });\n        return json(res, 201, { ok: true, order: orderPublic(order), instructions: method.instructions || '' }), true;\n""",
)
replace_once(
    'license-server/site-account.mjs',
    """      payment: row.payment_method === 'usdt' ? paymentSystem.orderPaymentDetails(row.id) : null };\n""",
    """      payment: row.payment_method === 'usdt' ? paymentSystem.orderPaymentDetails(row.id) : paymentSystem.zpayOrderDetails(row.id) };\n""",
)

# 4) Extension account order flow uses the same provider-aware preparation.
replace_once(
    'license-server/account-system.mjs',
    """  clientIp,\n}) {\n""",
    """  clientIp,\n  paymentSystem = null,\n}) {\n""",
)
replace_once(
    'license-server/account-system.mjs',
    """        const order = db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(result.lastInsertRowid));\n        audit('order_created', session.user_id, { orderId: order.id, planCode: plan.code, paymentMethod: method.code, amountCents: plan.price_cents });\n        return json(res, 201, { ok: true, order: orderPublic(order), instructions: method.instructions }, cors), true;\n""",
    """        let order = db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(result.lastInsertRowid));\n        if (paymentSystem) order = paymentSystem.prepareOrder(order, { clientIp: clientIp(req), userAgent: req.headers['user-agent'] || '' });\n        audit('order_created', session.user_id, { orderId: order.id, planCode: plan.code, paymentMethod: method.code, amountCents: plan.price_cents });\n        return json(res, 201, { ok: true, order: orderPublic(order), instructions: method.instructions }, cors), true;\n""",
)
replace_once(
    'license-server/account-system.mjs',
    """      const paid = markOrderPaid(db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(orderId)), { allowExpiredPending: context?.source === 'okx_auto' });\n      if (context?.source === 'okx_auto') {\n""",
    """      const autoSource = context?.source === 'okx_auto' || context?.source === 'zpay_auto';\n      const paid = markOrderPaid(db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(orderId)), { allowExpiredPending: autoSource });\n      if (context?.source === 'okx_auto') {\n""",
)
replace_once(
    'license-server/account-system.mjs',
    """      }\n      return orderPublic(paid);\n""",
    """      }\n      if (context?.source === 'zpay_auto') {\n        audit('order_auto_paid_zpay', paid.user_id, {\n          orderId: paid.id, tradeNo: context.tradeNo || '', merchantTradeNo: context.merchantTradeNo || '',\n          channel: context.channel || '', amount: context.amount || '',\n        });\n      }\n      return orderPublic(paid);\n""",
)

# 5) Wire provider-aware order creation into account system.
replace_once(
    'license-server/server.mjs',
    """  db, env, secret: SECRET, publicOrigin: PUBLIC_ORIGIN, allowedExtensionIds: ALLOWED_EXTENSION_IDS,\n  windowTtlSeconds: WINDOW_TTL_SECONDS, json, bodyJson, clientIp,\n});\n""",
    """  db, env, secret: SECRET, publicOrigin: PUBLIC_ORIGIN, allowedExtensionIds: ALLOWED_EXTENSION_IDS,\n  windowTtlSeconds: WINDOW_TTL_SECONDS, json, bodyJson, clientIp, paymentSystem,\n});\n""",
)

# 6) Admin UI: choose manual/ZPAY per channel and configure shared ZPAY credentials.
replace_once(
    'license-server/public/admin-settings.html',
    """            <label class=\"check\"><input id=\"wechatEnabled\" type=\"checkbox\"> 启用微信支付</label>\n            <label>HTTPS 支付页 / 二维码地址<input id=\"wechatUrl\" type=\"url\" placeholder=\"上传二维码后可自动生成\"></label>\n""",
    """            <label class=\"check\"><input id=\"wechatEnabled\" type=\"checkbox\"> 启用微信支付</label>\n            <label>收款模式<select id=\"wechatProvider\"><option value=\"manual\">静态收款码 / 人工确认</option><option value=\"zpay\">ZPAY · 自动回调确认</option></select></label>\n            <label>HTTPS 支付页 / 二维码地址<input id=\"wechatUrl\" type=\"url\" placeholder=\"静态模式使用；上传二维码后可自动生成\"></label>\n""",
)
replace_once(
    'license-server/public/admin-settings.html',
    """            <label class=\"check\"><input id=\"alipayEnabled\" type=\"checkbox\"> 启用支付宝</label>\n            <label>HTTPS 支付页 / 二维码地址<input id=\"alipayUrl\" type=\"url\" placeholder=\"上传二维码后可自动生成\"></label>\n""",
    """            <label class=\"check\"><input id=\"alipayEnabled\" type=\"checkbox\"> 启用支付宝</label>\n            <label>收款模式<select id=\"alipayProvider\"><option value=\"manual\">静态收款码 / 人工确认</option><option value=\"zpay\">ZPAY · 自动回调确认</option></select></label>\n            <label>HTTPS 支付页 / 二维码地址<input id=\"alipayUrl\" type=\"url\" placeholder=\"静态模式使用；上传二维码后可自动生成\"></label>\n""",
)
replace_once(
    'license-server/public/admin-settings.html',
    """        <h3>USDT 套餐价格</h3>\n""",
    """        <div class=\"section-title\"><div><h3>ZPAY 自动收款</h3><p class=\"muted\">兼容易支付协议。商户密钥仅加密保存在服务端；用户创建订单后由 GPTWork 生成订单级签名并 POST 到 ZPAY，异步回调必须通过 MD5 签名、商户 ID、金额、渠道和订单号校验后才自动开通会员。</p></div></div>\n        <div class=\"grid three\">\n          <label class=\"check\"><input id=\"zpayEnabled\" type=\"checkbox\"> 启用 ZPAY 网关</label>\n          <label>ZPAY 商户 ID / PID<input id=\"zpayPid\" autocomplete=\"off\" placeholder=\"支付渠道 → API安全\"></label>\n          <label>ZPAY 商户密钥 / KEY<input id=\"zpayKey\" type=\"password\" autocomplete=\"new-password\" placeholder=\"留空表示不修改\"></label>\n          <label>支付宝渠道 ID / CID（可选）<input id=\"zpayAlipayCid\" autocomplete=\"off\" placeholder=\"多个用英文逗号分隔；留空随机渠道\"></label>\n          <label>微信渠道 ID / CID（可选）<input id=\"zpayWechatCid\" autocomplete=\"off\" placeholder=\"多个用英文逗号分隔；留空随机渠道\"></label>\n        </div>\n        <div class=\"inline\">\n          <button id=\"saveZpaySettings\" type=\"button\" class=\"primary\">保存 ZPAY 配置</button>\n          <button id=\"testZpayConnection\" type=\"button\">测试 ZPAY API</button>\n          <button id=\"clearZpayCredentials\" type=\"button\" class=\"danger\">清除 ZPAY 凭据</button>\n        </div>\n        <p id=\"zpayState\" class=\"muted\">尚未读取 ZPAY 状态</p>\n\n        <h3>USDT 套餐价格</h3>\n""",
)
replace_once(
    'license-server/public/admin-settings.html',
    """        <p class=\"muted\">微信/支付宝静态个人收款码保持“创建订单 → 扫码付款 → 管理员确认实际到账 → 开通会员”，不会因为用户点击“已付款”而自动开通。</p>\n""",
    """        <p class=\"muted\">微信/支付宝选择“静态收款码”时仍保持人工确认；选择 ZPAY 时只有服务端验证 ZPAY 官方回调签名、商户号、订单号、金额和渠道全部一致后才自动开通。</p>\n""",
)

# 7) Admin behavior.
replace_once(
    'license-server/public/payment-admin.js',
    """    if (instructions) instructions.value = method.instructions || '';\n    renderQrState(code, method);\n""",
    """    if (instructions) instructions.value = method.instructions || '';\n    if (code !== 'usdt' && $(`${code}Provider`)) $(`${code}Provider`).value = method.provider === 'zpay' ? 'zpay' : 'manual';\n    renderQrState(code, method);\n""",
)
replace_once(
    'license-server/public/payment-admin.js',
    """  if ($('okxState')) $('okxState').textContent = okxStatusText(okx);\n}\n""",
    """  if ($('okxState')) $('okxState').textContent = okxStatusText(okx);\n  const zpay = data.zpay || {};\n  if ($('zpayEnabled')) $('zpayEnabled').checked = Boolean(zpay.enabled);\n  if ($('zpayPid')) $('zpayPid').value = '';\n  if ($('zpayKey')) $('zpayKey').value = '';\n  if ($('zpayAlipayCid')) $('zpayAlipayCid').value = zpay.alipayCid || '';\n  if ($('zpayWechatCid')) $('zpayWechatCid').value = zpay.wechatCid || '';\n  if ($('zpayState')) {\n    const parts = [zpay.configured ? `凭据已配置${zpay.pidHint ? `（${zpay.pidHint}）` : ''}` : '凭据未配置', zpay.enabled ? '网关已启用' : '网关未启用'];\n    if (zpay.lastTestAt) parts.push(`最近测试 ${new Date(zpay.lastTestAt).toLocaleString()}`);\n    if (zpay.lastError) parts.push(`错误：${zpay.lastError}`);\n    $('zpayState').textContent = parts.join(' · ');\n  }\n}\n""",
)
replace_once(
    'license-server/public/payment-admin.js',
    """    instructions: $(`${code}Instructions`)?.value.trim() || '',\n  };\n""",
    """    instructions: $(`${code}Instructions`)?.value.trim() || '',\n    ...(code !== 'usdt' ? { provider: $(`${code}Provider`)?.value || 'manual' } : {}),\n  };\n""",
)

insert_before_okx = """async function saveOkxSettings() {\n"""
zpay_admin_functions = r'''async function saveZpaySettings() {
  const button = $('saveZpaySettings');
  button.disabled = true;
  setMessage('正在加密保存 ZPAY 配置…');
  try {
    const body = {
      enabled: $('zpayEnabled').checked,
      alipayCid: $('zpayAlipayCid').value.trim(),
      wechatCid: $('zpayWechatCid').value.trim(),
      ...($('zpayPid').value.trim() ? { pid: $('zpayPid').value.trim() } : {}),
      ...($('zpayKey').value ? { key: $('zpayKey').value } : {}),
    };
    const data = await api('/admin/api/payments/zpay', { method: 'PUT', body: JSON.stringify(body) });
    $('zpayPid').value = '';
    $('zpayKey').value = '';
    loaded = false;
    await loadPayments(true);
    setMessage(data.zpay?.configured ? 'ZPAY 配置已保存。现在可把支付宝/微信的“收款模式”切换为 ZPAY。' : 'ZPAY 基础设置已保存，但商户 ID / 密钥尚未配置完整。', data.zpay?.configured ? 'good' : '');
  } catch (error) { setMessage(`ZPAY 配置保存失败：${error.message}`, 'bad'); }
  finally { button.disabled = false; }
}

async function testZpayConnection() {
  const button = $('testZpayConnection');
  button.disabled = true;
  setMessage('正在读取 ZPAY 商户余额以验证 API 凭据…');
  try {
    const data = await api('/admin/api/payments/zpay/test', { method: 'POST', body: '{}' });
    loaded = false;
    await loadPayments(true);
    setMessage(`ZPAY API 连接成功${data.balance !== '' ? `，账户余额 ${data.balance}` : ''}。`, 'good');
  } catch (error) { setMessage(`ZPAY API 测试失败：${error.message}`, 'bad'); }
  finally { button.disabled = false; }
}

async function clearZpayCredentials() {
  if (!window.confirm('清除服务端保存的 ZPAY 商户 ID 与商户密钥，并关闭 ZPAY 网关？')) return;
  const button = $('clearZpayCredentials');
  button.disabled = true;
  try {
    await api('/admin/api/payments/zpay', { method: 'PUT', body: JSON.stringify({ clearCredentials: true }) });
    loaded = false;
    await loadPayments(true);
    setMessage('ZPAY 凭据已清除，网关已关闭。', 'good');
  } catch (error) { setMessage(`清除 ZPAY 凭据失败：${error.message}`, 'bad'); }
  finally { button.disabled = false; }
}

'''
replace_once('license-server/public/payment-admin.js', insert_before_okx, zpay_admin_functions + insert_before_okx)
replace_once(
    'license-server/public/payment-admin.js',
    """$('saveOkxSettings')?.addEventListener('click', () => void saveOkxSettings());\n""",
    """$('saveZpaySettings')?.addEventListener('click', () => void saveZpaySettings());\n$('testZpayConnection')?.addEventListener('click', () => void testZpayConnection());\n$('clearZpayCredentials')?.addEventListener('click', () => void clearZpayCredentials());\n$('saveOkxSettings')?.addEventListener('click', () => void saveOkxSettings());\n""",
)

# 8) Account checkout copy and ZPAY return status.
replace_once(
    'license-server/public/site.js',
    """function paymentMethodLabel(method) {\n  if (method.code === 'wechat') return '微信支付';\n  if (method.code === 'alipay') return '支付宝';\n""",
    """function paymentMethodLabel(method) {\n  if (method.code === 'wechat') return method.provider === 'zpay' ? '微信支付（ZPAY）' : '微信支付';\n  if (method.code === 'alipay') return method.provider === 'zpay' ? '支付宝（ZPAY）' : '支付宝';\n""",
)
replace_once(
    'license-server/public/site.js',
    """  } else {\n    box.append(node('small', '', '微信/支付宝静态收款码没有可信服务器回调：付款后订单保持待支付，由管理员核对实际到账并确认后开通会员。'));\n  }\n}\n""",
    """  } else if (method.provider === 'zpay') {\n    box.append(node('small', '', '点击“打开支付页面”后将进入 ZPAY 收银台。只有服务端验证 ZPAY 回调签名、商户号、订单号、金额与支付渠道全部一致后，才会自动确认订单并开通会员。'));\n  } else {\n    box.append(node('small', '', '微信/支付宝静态收款码没有可信服务器回调：付款后订单保持待支付，由管理员核对实际到账并确认后开通会员。'));\n  }\n}\n""",
)
replace_once(
    'license-server/public/site.js',
    """  let config = { plans: [], paymentMethods: [] };\n""",
    """  let config = { plans: [], paymentMethods: [] };\n  const zpayReturn = new URLSearchParams(location.search).get('zpay');\n""",
)
replace_once(
    'license-server/public/site.js',
    """      renderAccount(data, config, refresh);\n      return true;\n""",
    """      renderAccount(data, config, refresh);\n      if (zpayReturn) {\n        const box = document.getElementById('paymentBox');\n        notice(box, zpayReturn === 'success' ? 'ZPAY 已返回支付成功，会员权益已刷新。' : '已从 ZPAY 返回；如果刚完成付款，请稍候几秒等待异步回调并自动刷新。', zpayReturn === 'success' ? 'good' : '');\n        history.replaceState(null, '', location.pathname);\n      }\n      return true;\n""",
)

# 9) Tests for protocol signing, callback integrity and provider-aware checkout.
write('license-server/test/zpay-client.test.mjs', r'''import test from 'node:test';
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
''')

# Extend payment-system tests with an end-to-end signed callback check.
payment_test = read('license-server/test/payment-system.test.mjs')
payment_test += r'''

test('ZPAY checkout signs order-specific POST and settles only an exact verified callback', async () => {
  const db = paymentRuntimeDb();
  const payments = createPaymentSystem({ db, publicOrigin: 'https://gptlock.example', json, secret: 'test-secret-at-least-thirty-two-characters-long', logger: { warn() {} } });
  createRuntimeSchema(db);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT; INSERT INTO users(id,email) VALUES(1,'buyer@example.com');`);

  let res = responseCapture();
  await payments.handleAdmin(request('PUT', { enabled: true, pid: '10001', key: 'merchant-secret', alipayCid: '1234' }), res,
    new URL('https://gptlock.example/admin/api/payments/zpay'));
  assert.equal(res.status, 200);
  res = responseCapture();
  await payments.handleAdmin(request('PUT', { enabled: true, provider: 'zpay', instructions: 'ZPAY 自动确认' }), res,
    new URL('https://gptlock.example/admin/api/payments/alipay'));
  assert.equal(res.status, 200);
  assert.equal(payments.list(true).find((row) => row.code === 'alipay').provider, 'zpay');

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const result = db.prepare(`INSERT INTO membership_orders(user_id,plan_code,payment_method,amount_cents,status,pay_url,created_at,expires_at,plan_snapshot_json)
    VALUES(1,'monthly','alipay',2900,'pending','',?,?,?)`).run(createdAt, expiresAt, JSON.stringify({ code: 'monthly', name: '月卡' }));
  let order = db.prepare('SELECT * FROM membership_orders WHERE id=?').get(Number(result.lastInsertRowid));
  order = payments.prepareOrder(order, { clientIp: '203.0.113.8', userAgent: 'test' });
  assert.match(order.pay_url, /\/site\/api\/zpay\/checkout\//);

  const checkoutRes = responseCapture();
  await payments.handleSite(request('GET'), checkoutRes, new URL(order.pay_url));
  assert.equal(checkoutRes.status, 200);
  const checkoutHtml = checkoutRes.body.toString('utf8');
  assert.match(checkoutHtml, /action="https:\/\/zpayz\.cn\/submit\.php"/);
  assert.match(checkoutHtml, /name="money" value="29\.00"/);
  assert.match(checkoutHtml, /name="cid" value="1234"/);

  const detail = payments.zpayOrderDetails(order.id);
  const settled = [];
  payments.attachSettlement((orderId, context) => {
    settled.push({ orderId, context });
    db.prepare("UPDATE membership_orders SET status='paid',paid_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(), orderId);
  });
  payments.close();

  const callback = new URL('https://gptlock.example/site/api/zpay/notify');
  const params = {
    pid: '10001', name: 'GPTWork 月卡 会员服务', money: '29.00', out_trade_no: detail.merchantTradeNo,
    trade_no: 'ZPAY-TRADE-1', param: `order-${order.id}`, trade_status: 'TRADE_SUCCESS', type: 'alipay', sign_type: 'MD5',
  };
  const { zpaySign } = await import('../zpay-client.mjs');
  params.sign = zpaySign(params, 'merchant-secret');
  for (const [key, value] of Object.entries(params)) callback.searchParams.set(key, value);
  const notifyRes = responseCapture();
  await payments.handleSite(request('GET'), notifyRes, callback);
  assert.equal(notifyRes.status, 200);
  assert.equal(notifyRes.body.toString(), 'success');
  assert.equal(settled.length, 1);
  assert.equal(settled[0].context.source, 'zpay_auto');
  assert.equal(payments.zpayOrderDetails(order.id).status, 'settled');

  const duplicateRes = responseCapture();
  await payments.handleSite(request('GET'), duplicateRes, callback);
  assert.equal(duplicateRes.body.toString(), 'success');
  assert.equal(settled.length, 1);

  const tampered = new URL(callback);
  tampered.searchParams.set('money', '0.01');
  const badRes = responseCapture();
  await payments.handleSite(request('GET'), badRes, tampered);
  assert.equal(badRes.status, 400);
  assert.equal(badRes.body.toString(), 'fail');
  db.close();
});
'''
write('license-server/test/payment-system.test.mjs', payment_test)

print('ZPAY integration patch applied successfully')
