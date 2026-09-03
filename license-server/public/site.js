const page = document.body.dataset.page || '';

function text(value, fallback = '—') { return value === null || value === undefined || value === '' ? fallback : String(value); }
function dateText(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '—';
}
function money(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function sizeText(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}
function safeHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}
async function api(path, options = {}) {
  const init = { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } };
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `请求失败 (${response.status})`), { status: response.status, code: data?.error?.code });
  return data;
}
function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}
function notice(el, message, tone = '') {
  if (!el) return;
  el.textContent = message;
  el.className = `notice${tone ? ` ${tone}` : ''}`;
}

async function loadReleaseFeed() {
  const data = await api('/site/api/releases');
  const latest = data.releases?.[0];
  const badge = document.getElementById('latestBadge');
  if (badge && latest?.tag) badge.textContent = `${latest.tag} · Windows / Linux`;
  const feed = document.getElementById('releaseFeed');
  if (!feed) return;
  feed.replaceChildren();
  if (!data.releases?.length) {
    feed.append(node('div', 'loading', `当前服务端版本 ${text(data.currentVersion)}。暂时无法读取 GitHub 发布记录，请稍后刷新。`));
    return;
  }
  for (const release of data.releases) {
    const card = node('article', 'release-card');
    const top = node('div', 'release-top');
    const left = node('div');
    left.append(node('span', 'release-tag', release.tag || 'Release'));
    left.append(node('h2', '', release.name || release.tag));
    left.append(node('div', 'release-date', `发布于 ${dateText(release.publishedAt)}`));
    const releaseUrl = safeHttps(release.url);
    if (releaseUrl) {
      const source = node('a', 'btn btn-small btn-soft', 'GitHub 原始发布页');
      source.href = releaseUrl; source.target = '_blank'; source.rel = 'noopener noreferrer';
      top.append(left, source);
    } else top.append(left);
    card.append(top);
    if (release.notes) card.append(node('div', 'release-notes', release.notes));
    const assets = node('div', 'asset-row');
    for (const asset of release.assets || []) {
      const url = safeHttps(asset.url);
      if (!url) continue;
      const link = node('a', 'asset-link', `${asset.name}${asset.size ? ` · ${sizeText(asset.size)}` : ''}`);
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      assets.append(link);
    }
    if (assets.childElementCount) card.append(assets);
    feed.append(card);
  }
}

function listEmpty(container, message) { container.replaceChildren(node('div', 'loading', message)); }
function actionButton(label, onClick) {
  const button = node('button', 'btn btn-small btn-soft', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

async function initAccount() {
  const loading = document.getElementById('accountLoading');
  const guest = document.getElementById('accountGuest');
  const dashboard = document.getElementById('accountDashboard');
  const loginCard = document.getElementById('loginCard');
  let config = { plans: [], paymentMethods: [] };
  try { config = await api('/site/api/account/config'); } catch {}
  try {
    const paymentConfig = await api('/site/api/payments');
    config.paymentMethods = paymentConfig.paymentMethods || config.paymentMethods || [];
  } catch {}

  async function refresh() {
    loading.classList.remove('hidden');
    try {
      const data = await api('/site/api/account/me');
      loading.classList.add('hidden'); guest.classList.add('hidden'); dashboard.classList.remove('hidden'); loginCard.classList.add('hidden');
      renderAccount(data, config, refresh);
      return true;
    } catch (error) {
      loading.classList.add('hidden'); dashboard.classList.add('hidden'); guest.classList.remove('hidden'); loginCard.classList.remove('hidden');
      if (error.status !== 401) notice(document.getElementById('loginNotice'), error.message, 'error');
      return false;
    }
  }

  document.getElementById('siteLogin')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const out = document.getElementById('loginNotice');
    notice(out, '正在登录…');
    try {
      await api('/site/api/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
      notice(out, '登录成功', 'good');
      await refresh();
    } catch (error) { notice(out, error.message, 'error'); }
  });
  document.getElementById('siteLogout')?.addEventListener('click', async () => {
    await api('/site/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    location.reload();
  });
  document.getElementById('changePasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const out = document.getElementById('passwordNotice');
    notice(out, '正在更新密码…');
    try {
      await api('/site/api/account/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') }) });
      event.currentTarget.reset();
      notice(out, '密码已更新，其他插件与网页登录已注销。', 'good');
      await refresh();
    } catch (error) { notice(out, error.message, 'error'); }
  });
  document.getElementById('deleteAccountForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const out = document.getElementById('deleteAccountNotice');
    const confirmText = String(form.get('confirmText') || '');
    if (confirmText !== 'DELETE') return notice(out, '请输入 DELETE 确认永久删除账户。', 'error');
    if (!window.confirm('永久删除 GPTLock 账户与关联数据？此操作不可撤销。')) return;
    notice(out, '正在永久删除账户与关联数据…');
    try {
      await api('/site/api/account/delete', { method: 'POST', body: JSON.stringify({ currentPassword: form.get('currentPassword'), confirmText }) });
      event.currentTarget.reset();
      window.alert('GPTLock 账户与关联数据已删除。');
      location.href = '/data-deletion';
    } catch (error) { notice(out, error.message, 'error'); }
  });
  document.getElementById('revokeAllExtensionSessions')?.addEventListener('click', async () => {
    await api('/site/api/account/sessions/revoke-all', { method: 'POST', body: '{}' });
    await refresh();
  });
  await refresh();
}

function paymentMethodLabel(method) {
  if (method.code === 'wechat') return '微信支付';
  if (method.code === 'alipay') return '支付宝';
  if (method.code === 'usdt') return 'USDT';
  return method.name || method.code;
}

function renderPaymentBox(result, method) {
  const box = document.getElementById('paymentBox');
  box.className = 'notice good payment-box';
  box.replaceChildren();
  box.append(node('strong', '', `订单 #${result.order.id} · ${paymentMethodLabel(method)}`));
  if (result.instructions) box.append(node('p', '', result.instructions));
  if (method.code === 'usdt' && method.crypto) {
    const parts = [];
    if (method.crypto.network) parts.push(`网络：${method.crypto.network}`);
    if (method.crypto.address) parts.push(`地址：${method.crypto.address}`);
    if (method.crypto.memo) parts.push(`Memo/Tag：${method.crypto.memo}`);
    if (parts.length) box.append(node('p', 'payment-crypto', parts.join('\n')));
  }
  const qr = safeHttps(method.qrUrl);
  if (qr) {
    const image = document.createElement('img');
    image.className = 'payment-qr';
    image.src = `${qr}${qr.includes('?') ? '&' : '?'}t=${Date.now()}`;
    image.alt = `${paymentMethodLabel(method)} 收款二维码`;
    box.append(image);
  }
  const pay = safeHttps(result.order.payUrl || method.payUrl);
  if (pay && pay !== qr) {
    const link = node('a', 'btn btn-small btn-soft', method.code === 'usdt' ? '打开 USDT 收款链接 →' : '打开支付页面 →');
    link.href = pay; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
  }
  box.append(node('small', '', '付款后订单仍会保持“待支付”，只有管理员核对实际到账并确认后才会开通会员。'));
}

function renderAccount(data, config, refresh) {
  const account = data.account || {};
  const entitlement = account.entitlement || {};
  document.getElementById('accountEmail').textContent = text(account.user?.email);
  document.getElementById('entitlementSource').textContent = entitlement.source === 'membership' ? '会员' : entitlement.source === 'free' ? '免费权益' : '未激活';
  document.getElementById('entitlementExpiry').textContent = dateText(entitlement.expiresAt);
  document.getElementById('deviceUsage').textContent = `${Number(entitlement.usage?.devices || 0)} / ${Number(entitlement.limits?.devices || 0)}`;

  const deviceList = document.getElementById('deviceList'); deviceList.replaceChildren();
  for (const device of data.security?.devices || []) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-main'); main.append(node('b', '', text(device.platform, '未知设备')), node('small', '', `最近活动 ${dateText(device.lastSeenAt)} · ${device.activeSessions} 个插件会话`));
    row.append(main, actionButton('释放设备', async () => { await api('/site/api/account/devices/release', { method: 'POST', body: JSON.stringify({ deviceRecordId: device.id }) }); await refresh(); }));
    deviceList.append(row);
  }
  if (!deviceList.childElementCount) listEmpty(deviceList, '暂无已绑定设备');

  const extensionList = document.getElementById('extensionSessionList'); extensionList.replaceChildren();
  for (const session of data.security?.sessions || []) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-main'); main.append(node('b', '', `${text(session.platform, '未知平台')} · GPTLock ${text(session.extensionVersion, '未知版本')}`), node('small', '', `最近活动 ${dateText(session.lastSeenAt)}`));
    row.append(main, actionButton('注销', async () => { await api('/site/api/account/sessions/revoke', { method: 'POST', body: JSON.stringify({ sessionId: session.id }) }); await refresh(); }));
    extensionList.append(row);
  }
  if (!extensionList.childElementCount) listEmpty(extensionList, '当前没有活动的插件会话');

  const siteList = document.getElementById('siteSessionList'); siteList.replaceChildren();
  for (const session of data.security?.siteSessions || []) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-main'); main.append(node('b', '', session.current ? '当前网页登录' : '网页登录'), node('small', '', `${text(session.ip, '未知 IP')} · ${dateText(session.lastSeenAt)} · ${text(session.userAgent, '')}`));
    row.append(main);
    if (!session.current) row.append(actionButton('注销', async () => { await api('/site/api/account/site-sessions/revoke', { method: 'POST', body: JSON.stringify({ sessionId: session.id }) }); await refresh(); }));
    siteList.append(row);
  }
  if (!siteList.childElementCount) listEmpty(siteList, '暂无网页登录');

  const planList = document.getElementById('planList'); planList.replaceChildren();
  for (const plan of config.plans || []) {
    const card = node('div', 'plan');
    card.append(node('strong', '', plan.name), node('div', 'plan-price', money(plan.priceCents)), node('small', '', `${plan.durationDays} 天 · 最多 ${plan.limits?.devices || 1} 台设备`));
    if (config.paymentMethods?.length) {
      const select = document.createElement('select');
      select.className = 'payment-method-select';
      select.setAttribute('aria-label', '选择支付方式');
      for (const method of config.paymentMethods) {
        const option = document.createElement('option'); option.value = method.code; option.textContent = paymentMethodLabel(method); select.append(option);
      }
      card.append(select, actionButton('创建购买订单', async () => {
        const method = config.paymentMethods.find((item) => item.code === select.value) || config.paymentMethods[0];
        try {
          const result = await api('/site/api/account/orders', { method: 'POST', body: JSON.stringify({ planCode: plan.code, paymentMethod: method.code }) });
          renderPaymentBox(result, method);
          await refresh();
        } catch (error) {
          const box = document.getElementById('paymentBox'); notice(box, error.message, 'error');
        }
      }));
    }
    planList.append(card);
  }
  if (!planList.childElementCount) listEmpty(planList, '当前没有可购买的会员方案');

  const orderList = document.getElementById('orderList'); orderList.replaceChildren();
  for (const order of data.orders || []) {
    const row = node('div', 'list-row');
    const main = node('div', 'list-main'); main.append(node('b', '', `#${order.id} · ${text(order.planSnapshot?.name, order.planCode)} · ${money(order.amountCents)}`), node('small', '', `${text(order.status)} · ${dateText(order.createdAt)}`));
    row.append(main);
    const pay = safeHttps(order.payUrl);
    if (order.status === 'pending' && pay) { const link = node('a', 'btn btn-small btn-soft', '继续支付'); link.href = pay; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
    orderList.append(row);
  }
  if (!orderList.childElementCount) listEmpty(orderList, '暂无订单');
}

if (page === 'home') void loadReleaseFeed().catch(() => {});
if (page === 'releases') void loadReleaseFeed().catch((error) => {
  const feed = document.getElementById('releaseFeed');
  if (feed) feed.replaceChildren(node('div', 'loading', `版本信息读取失败：${error.message}`));
});
if (page === 'account') void initAccount();