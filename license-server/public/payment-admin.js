const $ = (id) => document.getElementById(id);
const app = $('app');
const message = $('paymentSettingsMessage');
let loaded = false;
let planRows = [];

function setMessage(value, tone = '') {
  if (!message) return;
  message.textContent = value || '';
  message.className = `message ${tone}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body.error?.code || null;
    throw error;
  }
  return body;
}

function byCode(rows, code) {
  return (rows || []).find((row) => row.code === code) || { code, enabled: false, payUrl: '', instructions: '', qrConfigured: false, crypto: null };
}

function renderQrState(code, method) {
  const state = $(`${code}QrState`);
  if (!state) return;
  state.replaceChildren();
  if (!method.qrConfigured || !method.qrUrl) {
    state.textContent = '未上传二维码';
    return;
  }
  state.append(document.createTextNode('二维码已配置 · '));
  const link = document.createElement('a');
  link.href = `${method.qrUrl}?t=${Date.now()}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '预览';
  state.append(link);
}

function renderPlanPrices(prices = {}) {
  const container = $('usdtPlanPrices');
  if (!container) return;
  container.replaceChildren();
  for (const plan of planRows) {
    const label = document.createElement('label');
    label.textContent = `${plan.name} · USDT`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0.000001';
    input.step = '0.000001';
    input.placeholder = '例如 3.00';
    input.value = prices[plan.code] || '';
    input.dataset.planCode = plan.code;
    label.append(input);
    container.append(label);
  }
  if (!planRows.length) container.textContent = '当前没有会员套餐。';
}

function okxStatusText(okx = {}) {
  const parts = [okx.configured ? `凭据已配置${okx.apiKeyHint ? `（${okx.apiKeyHint}）` : ''}` : '凭据未配置'];
  parts.push(okx.enabled ? '自动核对已启用' : '自动核对未启用');
  if (okx.lastSuccessAt) parts.push(`最近成功检查 ${new Date(okx.lastSuccessAt).toLocaleString()}`);
  else if (okx.lastCheckAt) parts.push(`最近检查 ${new Date(okx.lastCheckAt).toLocaleString()}`);
  if (okx.lastMatchedOrderId) parts.push(`最近自动匹配订单 #${okx.lastMatchedOrderId}`);
  if (okx.lastError) parts.push(`错误：${okx.lastError}`);
  return parts.join(' · ');
}

function render(data) {
  const rows = data.paymentMethods || [];
  for (const code of ['wechat', 'alipay', 'usdt']) {
    const method = byCode(rows, code);
    const enabled = $(`${code}Enabled`);
    const url = $(`${code}Url`);
    const instructions = $(`${code}Instructions`);
    if (enabled) enabled.checked = Boolean(method.enabled);
    if (url) url.value = method.payUrl || '';
    if (instructions) instructions.value = method.instructions || '';
    if (code !== 'usdt' && $(`${code}Provider`)) $(`${code}Provider`).value = method.provider === 'zpay' ? 'zpay' : 'manual';
    renderQrState(code, method);
    if (code === 'usdt') {
      $('usdtNetwork').value = method.crypto?.network || '';
      $('usdtAddress').value = method.crypto?.address || '';
      $('usdtMemo').value = method.crypto?.memo || '';
    }
  }
  renderPlanPrices(data.usdtPlanPrices || byCode(rows, 'usdt').planPrices || {});
  const okx = data.okx || {};
  if ($('okxAutoEnabled')) $('okxAutoEnabled').checked = Boolean(okx.enabled);
  if ($('okxPollSeconds')) $('okxPollSeconds').value = okx.pollSeconds || 15;
  if ($('usdtOrderTtlMinutes')) $('usdtOrderTtlMinutes').value = okx.orderTtlMinutes || 120;
  if ($('okxAllowInternalTransfers')) $('okxAllowInternalTransfers').checked = okx.allowInternalTransfers !== false;
  if ($('okxApiKey')) $('okxApiKey').value = '';
  if ($('okxSecretKey')) $('okxSecretKey').value = '';
  if ($('okxPassphrase')) $('okxPassphrase').value = '';
  if ($('okxState')) $('okxState').textContent = okxStatusText(okx);
  const zpay = data.zpay || {};
  if ($('zpayEnabled')) $('zpayEnabled').checked = Boolean(zpay.enabled);
  if ($('zpayPid')) $('zpayPid').value = '';
  if ($('zpayKey')) $('zpayKey').value = '';
  if ($('zpayAlipayCid')) $('zpayAlipayCid').value = zpay.alipayCid || '';
  if ($('zpayWechatCid')) $('zpayWechatCid').value = zpay.wechatCid || '';
  if ($('zpayState')) {
    const parts = [zpay.configured ? `凭据已配置${zpay.pidHint ? `（${zpay.pidHint}）` : ''}` : '凭据未配置', zpay.enabled ? '网关已启用' : '网关未启用'];
    if (zpay.lastTestAt) parts.push(`最近测试 ${new Date(zpay.lastTestAt).toLocaleString()}`);
    if (zpay.lastError) parts.push(`错误：${zpay.lastError}`);
    $('zpayState').textContent = parts.join(' · ');
  }
}

async function loadPayments(force = false) {
  if (loaded && !force) return;
  try {
    const [data, plans] = await Promise.all([
      api('/admin/api/payments'),
      api('/admin/api/account/plans'),
    ]);
    planRows = plans.plans || [];
    loaded = true;
    render(data);
  } catch (error) {
    if (!app?.hidden) setMessage(`支付配置读取失败：${error.message}`, 'bad');
  }
}

async function saveMethod(code) {
  const body = {
    enabled: Boolean($(`${code}Enabled`)?.checked),
    payUrl: $(`${code}Url`)?.value.trim() || '',
    instructions: $(`${code}Instructions`)?.value.trim() || '',
    ...(code !== 'usdt' ? { provider: $(`${code}Provider`)?.value || 'manual' } : {}),
  };
  if (code === 'usdt') {
    body.crypto = {
      asset: 'USDT',
      network: $('usdtNetwork').value.trim(),
      address: $('usdtAddress').value.trim(),
      memo: $('usdtMemo').value.trim(),
    };
  }
  return api(`/admin/api/payments/${code}`, { method: 'PUT', body: JSON.stringify(body) });
}

function collectUsdtPrices() {
  const prices = {};
  for (const input of document.querySelectorAll('#usdtPlanPrices input[data-plan-code]')) {
    prices[input.dataset.planCode] = input.value.trim();
  }
  return prices;
}

async function savePayments() {
  const button = $('saveAdvancedPayments');
  button.disabled = true;
  setMessage('正在保存支付配置与 USDT 套餐价格…');
  try {
    await Promise.all(['wechat', 'alipay', 'usdt'].map(saveMethod));
    await api('/admin/api/payments/usdt/prices', { method: 'PUT', body: JSON.stringify({ prices: collectUsdtPrices() }) });
    loaded = false;
    await loadPayments(true);
    setMessage('支付配置与 USDT 套餐价格已保存。新订单将冻结对应支付参数。', 'good');
  } catch (error) {
    setMessage(`保存失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function saveZpaySettings() {
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

async function saveOkxSettings() {
  const button = $('saveOkxSettings');
  button.disabled = true;
  setMessage('正在加密保存 OKX 只读 API 配置…');
  try {
    const body = {
      enabled: $('okxAutoEnabled').checked,
      pollSeconds: Number($('okxPollSeconds').value),
      orderTtlMinutes: Number($('usdtOrderTtlMinutes').value),
      allowInternalTransfers: $('okxAllowInternalTransfers').checked,
      ...($('okxApiKey').value.trim() ? { apiKey: $('okxApiKey').value.trim() } : {}),
      ...($('okxSecretKey').value ? { secretKey: $('okxSecretKey').value } : {}),
      ...($('okxPassphrase').value ? { passphrase: $('okxPassphrase').value } : {}),
    };
    const data = await api('/admin/api/payments/usdt/okx', { method: 'PUT', body: JSON.stringify(body) });
    $('okxApiKey').value = '';
    $('okxSecretKey').value = '';
    $('okxPassphrase').value = '';
    $('okxState').textContent = okxStatusText(data.okx || {});
    setMessage('OKX 配置已保存。只有凭据完整且“自动核对”启用时才会自动开通。', 'good');
  } catch (error) {
    setMessage(`OKX 配置保存失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function testOkxConnection() {
  const button = $('testOkxConnection');
  button.disabled = true;
  setMessage('正在通过只读 API 读取一条 USDT 充值记录…');
  try {
    const data = await api('/admin/api/payments/usdt/okx/test', { method: 'POST', body: '{}' });
    $('okxState').textContent = okxStatusText(data.okx || {});
    setMessage(`OKX API 连接成功，返回 ${Number(data.sampleCount || 0)} 条样本记录。`, 'good');
  } catch (error) {
    setMessage(`OKX API 测试失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function checkOkxNow() {
  const button = $('checkOkxNow');
  button.disabled = true;
  setMessage('正在立即核对待支付 USDT 订单…');
  try {
    const data = await api('/admin/api/payments/usdt/okx/check', { method: 'POST', body: '{}' });
    setMessage(`检查完成：待核对 ${Number(data.checkedOrders || 0)} 个订单，读取 ${Number(data.deposits || 0)} 笔充值，自动开通 ${Number(data.settled || 0)} 个，歧义 ${Number(data.ambiguous || 0)} 个。`, 'good');
    loaded = false;
    await loadPayments(true);
  } catch (error) {
    setMessage(`立即检查失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function clearOkxCredentials() {
  if (!window.confirm('清除服务端已保存的 OKX API Key、Secret Key 与 Passphrase？自动核对将同时关闭。')) return;
  const button = $('clearOkxCredentials');
  button.disabled = true;
  try {
    const data = await api('/admin/api/payments/usdt/okx', { method: 'PUT', body: JSON.stringify({ clearCredentials: true, enabled: false }) });
    $('okxAutoEnabled').checked = false;
    $('okxState').textContent = okxStatusText(data.okx || {});
    setMessage('OKX 凭据已清除，自动核对已关闭。', 'good');
  } catch (error) {
    setMessage(`清除失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('请先选择二维码图片'));
    if (file.size > 1024 * 1024) return reject(new Error('二维码图片必须小于 1 MB'));
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return reject(new Error('仅支持 PNG、JPEG 或 WebP 图片'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取二维码图片失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadQr(code) {
  const button = $(`${code}QrUpload`);
  button.disabled = true;
  setMessage('正在上传二维码…');
  try {
    const dataUrl = await fileAsDataUrl($(`${code}QrFile`)?.files?.[0]);
    await api(`/admin/api/payments/${code}/qr`, { method: 'POST', body: JSON.stringify({ dataUrl }) });
    $(`${code}QrFile`).value = '';
    loaded = false;
    await loadPayments(true);
    setMessage('二维码已保存到服务端。', 'good');
  } catch (error) {
    setMessage(`二维码上传失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function deleteQr(code) {
  if (!window.confirm('删除这个支付方式的收款二维码？')) return;
  const button = $(`${code}QrDelete`);
  button.disabled = true;
  try {
    await api(`/admin/api/payments/${code}/qr`, { method: 'DELETE', body: '{}' });
    loaded = false;
    await loadPayments(true);
    setMessage('二维码已删除。', 'good');
  } catch (error) {
    setMessage(`删除失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

$('saveAdvancedPayments')?.addEventListener('click', () => void savePayments());
$('saveZpaySettings')?.addEventListener('click', () => void saveZpaySettings());
$('testZpayConnection')?.addEventListener('click', () => void testZpayConnection());
$('clearZpayCredentials')?.addEventListener('click', () => void clearZpayCredentials());
$('saveOkxSettings')?.addEventListener('click', () => void saveOkxSettings());
$('testOkxConnection')?.addEventListener('click', () => void testOkxConnection());
$('checkOkxNow')?.addEventListener('click', () => void checkOkxNow());
$('clearOkxCredentials')?.addEventListener('click', () => void clearOkxCredentials());
for (const code of ['wechat', 'alipay', 'usdt']) {
  $(`${code}QrUpload`)?.addEventListener('click', () => void uploadQr(code));
  $(`${code}QrDelete`)?.addEventListener('click', () => void deleteQr(code));
}

if (app) {
  const observer = new MutationObserver(() => { if (!app.hidden) void loadPayments(true); });
  observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
  if (!app.hidden) void loadPayments(true);
}
