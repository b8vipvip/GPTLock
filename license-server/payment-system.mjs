const MAX_QR_BYTES = 1024 * 1024;
const MAX_PAYMENT_BODY = 2 * 1024 * 1024;
const PAYMENT_CODES = new Set(['wechat', 'alipay', 'usdt']);
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

function nowIso() { return new Date().toISOString(); }
function normalizeHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch { return null; }
}
function cleanText(value, max) { return String(value || '').trim().slice(0, max); }

function ensurePaymentMethodsSchema(db) {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='payment_methods'").get();
  if (!row) {
    db.exec(`
      CREATE TABLE payment_methods (
        code TEXT PRIMARY KEY CHECK(code IN ('wechat','alipay','usdt')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
        pay_url TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    return;
  }
  if (!/CHECK\s*\(\s*code\s+IN\s*\(\s*'wechat'\s*,\s*'alipay'\s*\)\s*\)/i.test(String(row.sql || ''))) return;

  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0);
  if (foreignKeys) db.exec('PRAGMA foreign_keys=OFF;');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE payment_methods_v2 (
        code TEXT PRIMARY KEY CHECK(code IN ('wechat','alipay','usdt')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
        pay_url TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO payment_methods_v2(code,name,enabled,pay_url,instructions,updated_at)
        SELECT code,name,enabled,pay_url,instructions,updated_at FROM payment_methods;
      DROP TABLE payment_methods;
      ALTER TABLE payment_methods_v2 RENAME TO payment_methods;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  } finally {
    if (foreignKeys) db.exec('PRAGMA foreign_keys=ON;');
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`payment_methods migration created ${violations.length} foreign key violation(s)`);
}

async function readJson(req, maxBytes = MAX_PAYMENT_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('上传内容过大'), { status: 413, code: 'PAYMENT_BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求 JSON 无效'), { status: 400, code: 'INVALID_JSON' }); }
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw Object.assign(new Error('二维码图片仅支持 PNG、JPEG 或 WebP'), { status: 400, code: 'INVALID_QR_IMAGE' });
  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME.has(mime)) throw Object.assign(new Error('二维码图片格式不支持'), { status: 400, code: 'INVALID_QR_IMAGE' });
  const blob = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!blob.length || blob.length > MAX_QR_BYTES) throw Object.assign(new Error('二维码图片必须小于 1 MB'), { status: 413, code: 'QR_IMAGE_TOO_LARGE' });
  return { mime, blob };
}

export function createPaymentSystem({ db, publicOrigin, json }) {
  ensurePaymentMethodsSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_method_details (
      code TEXT PRIMARY KEY REFERENCES payment_methods(code) ON DELETE CASCADE,
      qr_mime TEXT NOT NULL DEFAULT '',
      qr_blob BLOB,
      crypto_asset TEXT NOT NULL DEFAULT '',
      crypto_network TEXT NOT NULL DEFAULT '',
      crypto_address TEXT NOT NULL DEFAULT '',
      crypto_memo TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  const insertMethod = db.prepare(`INSERT OR IGNORE INTO payment_methods(code,name,enabled,pay_url,instructions,updated_at) VALUES(?,?,?,?,?,?)`);
  insertMethod.run('wechat', '微信支付 / WeChat Pay', 0, '', '请扫码付款；付款完成后等待管理员确认到账。', nowIso());
  insertMethod.run('alipay', '支付宝 / Alipay', 0, '', '请扫码付款；付款完成后等待管理员确认到账。', nowIso());
  insertMethod.run('usdt', 'USDT / Tether', 0, '', '请通过配置的欧易收款链接或指定链完成 USDT 支付；到账后等待确认。', nowIso());
  const insertDetail = db.prepare(`INSERT OR IGNORE INTO payment_method_details(code,crypto_asset,updated_at) VALUES(?,?,?)`);
  insertDetail.run('wechat', '', nowIso());
  insertDetail.run('alipay', '', nowIso());
  insertDetail.run('usdt', 'USDT', nowIso());

  function method(code, enabledOnly = false) {
    if (!PAYMENT_CODES.has(code)) return null;
    return db.prepare(`SELECT p.*,d.qr_mime,d.qr_blob,d.crypto_asset,d.crypto_network,d.crypto_address,d.crypto_memo
      FROM payment_methods p LEFT JOIN payment_method_details d ON d.code=p.code
      WHERE p.code=?${enabledOnly ? ' AND p.enabled=1' : ''}`).get(code);
  }
  function publicMethod(row) {
    const qrConfigured = Boolean(row?.qr_blob && row?.qr_mime);
    return {
      code: row.code,
      name: row.name,
      enabled: Boolean(row.enabled),
      payUrl: row.pay_url || '',
      instructions: row.instructions || '',
      qrConfigured,
      qrUrl: qrConfigured ? `${publicOrigin}/site/api/payment-qr/${row.code}` : '',
      crypto: row.code === 'usdt' ? {
        asset: row.crypto_asset || 'USDT',
        network: row.crypto_network || '',
        address: row.crypto_address || '',
        memo: row.crypto_memo || '',
      } : null,
    };
  }
  function list(enabledOnly = false) {
    return db.prepare(`SELECT p.*,d.qr_mime,d.qr_blob,d.crypto_asset,d.crypto_network,d.crypto_address,d.crypto_memo
      FROM payment_methods p LEFT JOIN payment_method_details d ON d.code=p.code
      ${enabledOnly ? 'WHERE p.enabled=1' : ''}
      ORDER BY CASE p.code WHEN 'wechat' THEN 10 WHEN 'alipay' THEN 20 WHEN 'usdt' THEN 30 ELSE 99 END,p.code`).all().map(publicMethod);
  }
  function replyFailure(res, error) {
    json(res, error.status || 500, { ok: false, error: { code: error.code || 'PAYMENT_ERROR', message: error.status ? error.message : '支付配置处理失败' } });
  }

  async function handleAdmin(req, res, url) {
    if (!url.pathname.startsWith('/admin/api/payments')) return false;
    try {
      if (url.pathname === '/admin/api/payments' && req.method === 'GET') {
        return json(res, 200, { ok: true, paymentMethods: list(false) }), true;
      }
      const match = url.pathname.match(/^\/admin\/api\/payments\/(wechat|alipay|usdt)$/);
      if (match && req.method === 'PUT') {
        const code = match[1];
        const input = await readJson(req, 128 * 1024);
        const current = method(code);
        if (!current) throw Object.assign(new Error('支付方式不存在'), { status: 404, code: 'PAYMENT_METHOD_NOT_FOUND' });
        const payUrl = input.payUrl === undefined ? current.pay_url : normalizeHttpsUrl(input.payUrl);
        if (payUrl === null) throw Object.assign(new Error('支付链接必须为空或 HTTPS 地址'), { status: 400, code: 'INVALID_PAYMENT_URL' });
        const enabled = input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0);
        const instructions = input.instructions === undefined ? current.instructions : cleanText(input.instructions, 1000);
        db.prepare('UPDATE payment_methods SET enabled=?,pay_url=?,instructions=?,updated_at=? WHERE code=?')
          .run(enabled, payUrl, instructions, nowIso(), code);
        if (code === 'usdt') {
          const crypto = input.crypto || {};
          const asset = cleanText(crypto.asset || current.crypto_asset || 'USDT', 24).toUpperCase() || 'USDT';
          if (asset !== 'USDT') throw Object.assign(new Error('当前仅支持 USDT 收款'), { status: 400, code: 'UNSUPPORTED_CRYPTO_ASSET' });
          db.prepare(`UPDATE payment_method_details SET crypto_asset=?,crypto_network=?,crypto_address=?,crypto_memo=?,updated_at=? WHERE code='usdt'`)
            .run(asset, cleanText(crypto.network ?? current.crypto_network, 80), cleanText(crypto.address ?? current.crypto_address, 256),
              cleanText(crypto.memo ?? current.crypto_memo, 160), nowIso());
        }
        return json(res, 200, { ok: true, paymentMethod: publicMethod(method(code)) }), true;
      }
      const qrMatch = url.pathname.match(/^\/admin\/api\/payments\/(wechat|alipay|usdt)\/qr$/);
      if (qrMatch && req.method === 'POST') {
        const code = qrMatch[1];
        const input = await readJson(req);
        const image = decodeDataUrl(input.dataUrl);
        db.prepare('UPDATE payment_method_details SET qr_mime=?,qr_blob=?,updated_at=? WHERE code=?')
          .run(image.mime, image.blob, nowIso(), code);
        const current = method(code);
        if (!current.pay_url && code !== 'usdt') {
          db.prepare('UPDATE payment_methods SET pay_url=?,updated_at=? WHERE code=?')
            .run(`${publicOrigin}/site/api/payment-qr/${code}`, nowIso(), code);
        }
        return json(res, 200, { ok: true, paymentMethod: publicMethod(method(code)) }), true;
      }
      if (qrMatch && req.method === 'DELETE') {
        const code = qrMatch[1];
        const qrUrl = `${publicOrigin}/site/api/payment-qr/${code}`;
        db.prepare("UPDATE payment_method_details SET qr_mime='',qr_blob=NULL,updated_at=? WHERE code=?").run(nowIso(), code);
        db.prepare("UPDATE payment_methods SET pay_url=CASE WHEN pay_url=? THEN '' ELSE pay_url END,updated_at=? WHERE code=?")
          .run(qrUrl, nowIso(), code);
        return json(res, 200, { ok: true, paymentMethod: publicMethod(method(code)) }), true;
      }
      return false;
    } catch (error) {
      replyFailure(res, error);
      return true;
    }
  }

  async function handleSite(req, res, url) {
    if (url.pathname === '/site/api/payments' && req.method === 'GET') {
      return json(res, 200, { ok: true, paymentMethods: list(true) }), true;
    }
    const qrMatch = url.pathname.match(/^\/site\/api\/payment-qr\/(wechat|alipay|usdt)$/);
    if (qrMatch && ['GET', 'HEAD'].includes(req.method || '')) {
      const row = method(qrMatch[1], true);
      if (!row?.qr_blob || !row?.qr_mime) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end('Payment QR not found'), true;
      }
      const payload = Buffer.from(row.qr_blob);
      res.writeHead(200, {
        'content-type': row.qr_mime,
        'content-length': payload.length,
        'cache-control': 'private, no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end(); else res.end(payload);
      return true;
    }
    return false;
  }

  return { handleAdmin, handleSite, list };
}
