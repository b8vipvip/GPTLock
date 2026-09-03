const $ = (id) => document.getElementById(id);
const app = $('app');
const message = $('paymentSettingsMessage');
let loaded = false;

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
  if (!response.ok || body.ok === false) throw new Error(body.error?.message || `HTTP ${response.status}`);
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
    renderQrState(code, method);
    if (code === 'usdt') {
      $('usdtNetwork').value = method.crypto?.network || '';
      $('usdtAddress').value = method.crypto?.address || '';
      $('usdtMemo').value = method.crypto?.memo || '';
    }
  }
}

async function loadPayments(force = false) {
  if (loaded && !force) return;
  try {
    const data = await api('/admin/api/payments');
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

async function savePayments() {
  const button = $('saveAdvancedPayments');
  button.disabled = true;
  setMessage('正在保存支付配置…');
  try {
    await Promise.all(['wechat', 'alipay', 'usdt'].map(saveMethod));
    loaded = false;
    await loadPayments(true);
    setMessage('支付配置已保存。新订单将使用最新配置。', 'good');
  } catch (error) {
    setMessage(`保存失败：${error.message}`, 'bad');
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
for (const code of ['wechat', 'alipay', 'usdt']) {
  $(`${code}QrUpload`)?.addEventListener('click', () => void uploadQr(code));
  $(`${code}QrDelete`)?.addEventListener('click', () => void deleteQr(code));
}

if (app) {
  const observer = new MutationObserver(() => { if (!app.hidden) void loadPayments(true); });
  observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
  if (!app.hidden) void loadPayments(true);
}
