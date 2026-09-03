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

function canonicalAssetForLegacy(name) {
  const value = String(name || '');
  if (value === 'GPTLockSetup-x64.exe') return 'GPTWorkSetup-x64.exe';
  if (value.startsWith('gptlock-extension-')) return value.replace('gptlock-extension-', 'gptwork-extension-');
  if (value.startsWith('gptlock-core-')) return value.replace('gptlock-core-', 'gptwork-core-');
  if (value.startsWith('gptlock_')) return value.replace('gptlock_', 'gptwork_');
  return '';
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
    const releaseAssets = release.assets || [];
    const releaseAssetNames = new Set(releaseAssets.map((asset) => String(asset?.name || '')));
    for (const asset of releaseAssets) {
      const canonical = canonicalAssetForLegacy(asset?.name);
      if (canonical && releaseAssetNames.has(canonical)) continue;
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
  const zpayReturn = new URLSearchParams(location.search).get('zpay');
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
      if (zpayReturn) {
        const box = document.getElementById('paymentBox');
        notice(box, zpayReturn === 'success' ? 'ZPAY 已返回支付成功，会员权益已刷新。' : '已从 ZPAY 返回；如果刚完成付款，请稍候几秒等待异步回调并自动刷新。', zpayReturn === 'success' ? 'good' : '');
        history.replaceState(null, '', location.pathname);
      }
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
    if (!window.confirm('永久删除 GPTWork 账户与关联数据？此操作不可撤销。')) return;
    notice(out, '正在永久删除账户与关联数据…');
    try {
      await api('/site/api/account/delete', { method: 'POST', body: JSON.stringify({ currentPassword: form.get('currentPassword'), confirmText }) });
      event.currentTarget.reset();
      window.alert('GPTWork 账户与关联数据已删除。');
      location.href = '/data-deletion';
    } catch (error) { notice(out, error.message, 'error'); }
  });
  document.getElementById('revokeAllExtensionSessions')?.addEventListener('click', async () => {
    await api('/site/api/account/sessions/revoke-all', { method: 'POST', body: '{}' });
    await refresh();
  });
  await refresh();
  const accountPoll = setInterval(() => {
    if (!document.hidden && !dashboard.classList.contains('hidden')) void refresh();
  }, 10_000);
  window.addEventListener('pagehide', () => clearInterval(accountPoll), { once: true });
}

function paymentMethodLabel(method) {
  if (method.code === 'wechat') return method.provider === 'zpay' ? '微信支付（ZPAY）' : '微信支付';
  if (method.code === 'alipay') return method.provider === 'zpay' ? '支付宝（ZPAY）' : '支付宝';
  if (method.code === 'usdt') return 'USDT';
  return method.name || method.code;
}

function usdtMatchText(payment) {
  return ({
    awaiting: '等待检测到账',
    confirming: '已检测到付款，等待区块/OKX 最终确认',
    ambiguous: '检测到重复匹配，需要管理员核对',
    settled: 'OKX 已确认到账并自动开通',
    error: '自动核对异常，等待重试或管理员处理',
  })[payment?.matchStatus] || '';
}

function renderPaymentBox(result, method) {
  const box = document.getElementById('paymentBox');
  box.className = 'notice good payment-box';
  box.replaceChildren();
  box.append(node('strong', '', `订单 #${result.order.id} · ${paymentMethodLabel(method)}`));
  if (method.code === 'usdt') {
    const payment = result.order.payment || {};
    if (payment.amount) box.append(node('div', 'plan-price', `${payment.amount} USDT`));
    const parts = [];
    if (payment.network) parts.push(`网络：${payment.network}`);
    if (payment.address) parts.push(`地址：${payment.address}`);
    if (payment.memo) parts.push(`Memo/Tag：${payment.memo}`);
    if (parts.length) box.append(node('p', 'payment-crypto', parts.join('\n')));
  }
  if (result.instructions) box.append(node('p', '', result.instructions));
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
    const link = node('a', 'btn btn-small btn-soft', method.code === 'usdt' ? '打开欧易 / OKX 收款链接 →' : '打开支付页面 →');
    link.href = pay; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
  }
  if (method.code === 'usdt') {
    box.append(node('small', '', method.autoConfirm
      ? '请严格按上方数量、网络与地址付款。服务端会通过 OKX 只读 API 核对金额、网络/地址和订单时间窗口；仅在 OKX 充值状态达到最终成功后自动开通会员。'
      : '当前尚未启用 OKX 自动到账核对；付款后需要管理员确认到账才能开通会员。'));
  } else if (method.provider === 'zpay') {
    box.append(node('small', '', '点击“打开支付页面”后将进入 ZPAY 收银台。只有服务端验证 ZPAY 回调签名、商户号、订单号、金额与支付渠道全部一致后，才会自动确认订单并开通会员。'));
  } else {
    box.append(node('small', '', '微信/支付宝静态收款码没有可信服务器回调：付款后订单保持待支付，由管理员核对实际到账并确认后开通会员。'));
  }
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
    const main = node('div', 'list-main'); main.append(node('b', '', `${text(session.platform, '未知平台')} · GPTWork ${text(session.extensionVersion, '未知版本')}`), node('small', '', `最近活动 ${dateText(session.lastSeenAt)}`));
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
  const usdtMethod = (config.paymentMethods || []).find((item) => item.code === 'usdt');
  for (const plan of config.plans || []) {
    const card = node('div', 'plan');
    card.append(node('strong', '', plan.name), node('div', 'plan-price', money(plan.priceCents)), node('small', '', `${plan.durationDays} 天 · 最多 ${plan.limits?.devices || 1} 台设备`));
    const usdtPrice = usdtMethod?.planPrices?.[plan.code] || '';
    if (usdtPrice) card.append(node('small', '', `USDT：${usdtPrice} USDT`));
    if (config.paymentMethods?.length) {
      const select = document.createElement('select');
      select.className = 'payment-method-select';
      select.setAttribute('aria-label', '选择支付方式');
      for (const method of config.paymentMethods) {
        const option = document.createElement('option');
        option.value = method.code;
        const price = method.code === 'usdt' ? method.planPrices?.[plan.code] : '';
        option.textContent = method.code === 'usdt' && price ? `USDT · ${price} USDT` : paymentMethodLabel(method);
        if (method.code === 'usdt' && !price) { option.disabled = true; option.textContent = 'USDT · 该套餐未配置价格'; }
        select.append(option);
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
    const main = node('div', 'list-main');
    const amountText = order.paymentMethod === 'usdt' && order.payment?.amount ? `${order.payment.amount} USDT` : money(order.amountCents);
    const detail = [text(order.status), dateText(order.createdAt)];
    const matchText = usdtMatchText(order.payment);
    if (matchText) detail.push(matchText);
    if (order.payment?.txId) detail.push(`TxID ${order.payment.txId}`);
    main.append(node('b', '', `#${order.id} · ${text(order.planSnapshot?.name, order.planCode)} · ${amountText}`), node('small', '', detail.join(' · ')));
    row.append(main);
    const pay = safeHttps(order.payUrl);
    if (order.status === 'pending' && pay) { const link = node('a', 'btn btn-small btn-soft', order.paymentMethod === 'usdt' ? '继续 USDT 支付' : '继续支付'); link.href = pay; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
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
