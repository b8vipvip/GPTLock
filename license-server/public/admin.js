const $ = (id) => document.getElementById(id);
const el = {
  login: $('login'), app: $('app'), password: $('password'), loginButton: $('loginButton'), loginMessage: $('loginMessage'), logout: $('logout'),
  totalUsers: $('totalUsers'), verifiedUsers: $('verifiedUsers'), activeMemberships: $('activeMemberships'), pendingOrders: $('pendingOrders'),
  userSearch: $('userSearch'), refreshUsers: $('refreshUsers'), usersBody: $('usersBody'),
  planCards: $('planCards'), refreshOrders: $('refreshOrders'), ordersBody: $('ordersBody'),
  freeDays: $('freeDays'), freeDevices: $('freeDevices'), freeWindows: $('freeWindows'), sessionDays: $('sessionDays'),
  emailVerificationRequired: $('emailVerificationRequired'),
  smtpHost: $('smtpHost'),
  smtpPort: $('smtpPort'), smtpSecure: $('smtpSecure'), smtpUsername: $('smtpUsername'), smtpPassword: $('smtpPassword'), smtpFromEmail: $('smtpFromEmail'), smtpFromName: $('smtpFromName'), testEmail: $('testEmail'), sendTestEmail: $('sendTestEmail'), smtpState: $('smtpState'),
  wechatEnabled: $('wechatEnabled'), wechatUrl: $('wechatUrl'), wechatInstructions: $('wechatInstructions'),
  alipayEnabled: $('alipayEnabled'), alipayUrl: $('alipayUrl'), alipayInstructions: $('alipayInstructions'), saveSettings: $('saveSettings'), settingsMessage: $('settingsMessage'),
  runtimeLog: $('runtimeLog'), refreshRuntime: $('refreshRuntime'), exportRuntime: $('exportRuntime'), audit: $('audit'),
  updateButton: $('updateButton'), serverVersion: $('serverVersion'), currentCommit: $('currentCommit'), targetRef: $('targetRef'), updateProgress: $('updateProgress'), updatePercent: $('updatePercent'), updateMessage: $('updateMessage'), updateWarning: $('updateWarning'), updateLog: $('updateLog'),
};

const ACTIVE_UPDATE_STATES = new Set(['queued', 'running', 'restarting', 'rolling_back']);
let updatePoll = null;
let updateWasActive = false;
let plansCache = [];

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

function text(value) { return String(value ?? ''); }
function localDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
function localDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
function money(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function shortCommit(value) { return value ? String(value).slice(0, 12) : '—'; }
function setMessage(node, value, tone = '') {
  if (!node) return;
  node.textContent = value || '';
  node.className = `message ${tone}`.trim();
}
function td(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text(value);
  if (className) cell.className = className;
  return cell;
}
function button(label, handler, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  if (className) node.className = className;
  node.addEventListener('click', handler);
  return node;
}
function promptNumber(label, current, { nullable = false } = {}) {
  const initial = current === null || current === undefined ? '' : String(current);
  const raw = prompt(`${label}${nullable ? '（留空=跟随套餐/免费默认值）' : ''}`, initial);
  if (raw === null) return { cancelled: true };
  if (nullable && !raw.trim()) return { value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    alert(`${label}必须是 1–1000 的整数`);
    return { cancelled: true };
  }
  return { value };
}

function renderDashboard(data) {
  const stats = data.stats || {};
  el.totalUsers.textContent = stats.totalUsers ?? 0;
  el.verifiedUsers.textContent = stats.verifiedUsers ?? 0;
  el.activeMemberships.textContent = stats.activeMemberships ?? 0;
  el.pendingOrders.textContent = stats.pendingOrders ?? 0;
}

function accountTier(row) {
  if (row.membership?.name) return row.membership.name;
  if (row.entitlement?.source === 'free') return '免费期';
  return '无有效权益';
}

async function editUser(row) {
  const currentFree = localDateInput(row.freeExpiresAt);
  const freeRaw = prompt('免费有效期（本地时间；留空表示清空免费期限）', currentFree);
  if (freeRaw === null) return;
  let freeExpiresAt = null;
  if (freeRaw.trim()) {
    const date = new Date(freeRaw);
    if (Number.isNaN(date.getTime())) return alert('免费有效期格式无效');
    freeExpiresAt = date.toISOString();
  }
  const devices = promptNumber('自定义设备上限', row.overrides?.devices, { nullable: true });
  if (devices.cancelled) return;
  const windows = promptNumber('自定义同时窗口上限', row.overrides?.windows, { nullable: true });
  if (windows.cancelled) return;
  await api(`/admin/api/account/users/${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ freeExpiresAt, maxDevicesOverride: devices.value, maxWindowsOverride: windows.value }),
  });
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function toggleUser(row) {
  const next = row.status === 'disabled' ? 'active' : 'disabled';
  const verb = next === 'disabled' ? '停用' : '启用';
  if (!confirm(`确认${verb} ${row.email}？${next === 'disabled' ? ' 该用户现有登录会话会立即失效。' : ''}`)) return;
  await api(`/admin/api/account/users/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function grantMembership(row) {
  const enabledPlans = plansCache.filter((plan) => plan.enabled);
  if (!enabledPlans.length) return alert('没有已启用的会员套餐');
  const choices = enabledPlans.map((plan) => `${plan.code} = ${plan.name} / ${money(plan.priceCents)} / ${plan.durationDays}天`).join('\n');
  const planCode = prompt(`输入套餐代码：\n${choices}`, enabledPlans[0].code);
  if (planCode === null) return;
  const plan = enabledPlans.find((item) => item.code === planCode.trim());
  if (!plan) return alert('套餐代码无效');
  if (!confirm(`为 ${row.email} 开通 ${plan.name}？若已有未到期会员，会从现有到期时间继续顺延。`)) return;
  await api(`/admin/api/account/users/${row.id}/grant-membership`, { method: 'POST', body: JSON.stringify({ planCode: plan.code }) });
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function resetDevices(row) {
  if (!confirm(`确认清空 ${row.email} 的全部设备绑定和登录会话？用户需要重新登录。`)) return;
  await api(`/admin/api/account/users/${row.id}/reset-devices`, { method: 'POST', body: '{}' });
  await loadUsers();
}

function renderUsers(rows) {
  el.usersBody.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(td(row.id), td(row.email));
    const statusCell = td(row.status === 'disabled' ? '已停用' : (row.emailVerified ? '正常' : '待验证'));
    statusCell.className = row.status === 'disabled' ? 'tone-bad' : (row.emailVerified ? 'tone-good' : 'tone-wait');
    tr.append(statusCell);
    tr.append(td(accountTier(row)));
    tr.append(td(`${row.entitlement?.usage?.devices ?? 0}/${row.entitlement?.limits?.devices ?? 0}${row.overrides?.devices ? ' *' : ''}`));
    tr.append(td(`${row.entitlement?.usage?.windows ?? 0}/${row.entitlement?.limits?.windows ?? 0}${row.overrides?.windows ? ' *' : ''}`));
    tr.append(td(localDate(row.entitlement?.expiresAt)));
    const actions = document.createElement('td'); actions.className = 'row-actions';
    actions.append(
      button(row.status === 'disabled' ? '启用' : '停用', () => void toggleUser(row), row.status === 'disabled' ? 'good' : 'danger'),
      button('修改权益', () => void editUser(row)),
      button('开通会员', () => void grantMembership(row), 'primary'),
      button('重置设备', () => void resetDevices(row)),
    );
    tr.append(actions);
    el.usersBody.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const cell = td('没有匹配用户'); cell.colSpan = 8; cell.className = 'empty'; tr.append(cell); el.usersBody.append(tr);
  }
}

async function loadUsers() {
  const q = el.userSearch.value.trim();
  const data = await api(`/admin/api/account/users?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  renderUsers(data.users || []);
}

function planCard(plan) {
  const card = document.createElement('article'); card.className = 'plan-card';
  const head = document.createElement('div'); head.className = 'plan-head';
  const title = document.createElement('div');
  const name = document.createElement('input'); name.value = plan.name; name.setAttribute('aria-label', '套餐名称');
  const code = document.createElement('small'); code.textContent = plan.code;
  title.append(name, code);
  const enabledLabel = document.createElement('label'); enabledLabel.className = 'check compact';
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(plan.enabled);
  enabledLabel.append(enabled, document.createTextNode(' 启用'));
  head.append(title, enabledLabel);

  const grid = document.createElement('div'); grid.className = 'plan-fields';
  const makeField = (labelText, value, min = 0) => {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.value = String(value);
    label.append(input); grid.append(label); return input;
  };
  const price = makeField('价格（元）', (plan.priceCents / 100).toFixed(2), 0); price.step = '0.01';
  const days = makeField('有效天数', plan.durationDays, 1);
  const devices = makeField('设备上限', plan.limits.devices, 1);
  const windows = makeField('窗口上限', plan.limits.windows, 1);
  const benefitsLabel = document.createElement('label'); benefitsLabel.className = 'benefit-field'; benefitsLabel.textContent = '权益说明（每行一条）';
  const benefits = document.createElement('textarea'); benefits.rows = 5; benefits.value = (plan.benefits || []).join('\n'); benefitsLabel.append(benefits);
  const save = button('保存套餐', async () => {
    save.disabled = true;
    try {
      const priceCents = Math.round(Number(price.value) * 100);
      await api(`/admin/api/account/plans/${encodeURIComponent(plan.code)}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.value.trim(), priceCents, durationDays: Number(days.value), maxDevices: Number(devices.value), maxWindows: Number(windows.value),
          benefits: benefits.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), enabled: enabled.checked,
        }),
      });
      save.textContent = '已保存';
      setTimeout(() => { save.textContent = '保存套餐'; }, 1000);
      await Promise.all([loadPlans(), loadDashboard()]);
    } catch (error) { alert(error.message); }
    finally { save.disabled = false; }
  }, 'primary');
  card.append(head, grid, benefitsLabel, save);
  return card;
}

function renderPlans(plans) {
  plansCache = plans;
  el.planCards.textContent = '';
  for (const plan of plans) el.planCards.append(planCard(plan));
}

async function loadPlans() {
  const data = await api('/admin/api/account/plans');
  renderPlans(data.plans || []);
}

function orderStatus(row) {
  return ({ pending: '待支付', paid: '已支付', cancelled: '已取消', expired: '已过期' })[row.status] || row.status;
}

async function markOrderPaid(row) {
  if (!confirm(`确认订单 #${row.id} 已到账，并为 ${row.email} 开通 ${row.planName}？`)) return;
  await api(`/admin/api/account/orders/${row.id}/mark-paid`, { method: 'POST', body: '{}' });
  await Promise.all([loadOrders(), loadUsers(), loadDashboard()]);
}
async function cancelOrder(row) {
  if (!confirm(`确认取消订单 #${row.id}？`)) return;
  await api(`/admin/api/account/orders/${row.id}/cancel`, { method: 'POST', body: '{}' });
  await Promise.all([loadOrders(), loadDashboard()]);
}

function renderOrders(rows) {
  el.ordersBody.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(td(`#${row.id}`), td(row.email), td(row.planName || row.planCode), td(row.paymentName || row.paymentMethod), td(money(row.amountCents)), td(orderStatus(row)), td(localDate(row.createdAt)));
    const actions = document.createElement('td'); actions.className = 'row-actions';
    if (row.status === 'pending') actions.append(button('确认到账', () => void markOrderPaid(row), 'primary'), button('取消', () => void cancelOrder(row), 'danger'));
    else actions.textContent = '—';
    tr.append(actions); el.ordersBody.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr'); const cell = td('暂无订单'); cell.colSpan = 8; cell.className = 'empty'; tr.append(cell); el.ordersBody.append(tr);
  }
}

async function loadOrders() {
  const data = await api('/admin/api/account/orders');
  renderOrders(data.orders || []);
}

function methodByCode(settings, code) {
  return (settings.paymentMethods || []).find((item) => item.code === code) || { code, enabled: false, payUrl: '', instructions: '' };
}

function renderSettings(data) {
  const settings = data.settings || {};
  el.freeDays.value = settings.free?.days ?? 7;
  el.freeDevices.value = settings.free?.maxDevices ?? 1;
  el.freeWindows.value = settings.free?.maxWindows ?? 1;
  el.sessionDays.value = settings.sessionDays ?? 30;
  el.emailVerificationRequired.checked = settings.emailVerificationRequired !== false;
  const smtp = settings.smtp || {};
  el.smtpHost.value = smtp.host || '';
  el.smtpPort.value = smtp.port || 465;
  el.smtpSecure.checked = smtp.secure !== false;
  el.smtpUsername.value = smtp.username || '';
  el.smtpPassword.value = '';
  el.smtpFromEmail.value = smtp.fromEmail || '';
  el.smtpFromName.value = smtp.fromName || 'GPTLock';
  el.smtpState.textContent = smtp.passwordConfigured ? 'SMTP 密码/授权码已加密保存；密码框留空不会覆盖。' : '尚未保存 SMTP 密码/授权码。';
  const wechat = methodByCode(settings, 'wechat');
  el.wechatEnabled.checked = Boolean(wechat.enabled); el.wechatUrl.value = wechat.payUrl || ''; el.wechatInstructions.value = wechat.instructions || '';
  const alipay = methodByCode(settings, 'alipay');
  el.alipayEnabled.checked = Boolean(alipay.enabled); el.alipayUrl.value = alipay.payUrl || ''; el.alipayInstructions.value = alipay.instructions || '';
}

async function loadSettings() {
  renderSettings(await api('/admin/api/account/settings'));
}

async function saveSettings() {
  setMessage(el.settingsMessage, '正在保存…');
  const body = {
    free: { days: Number(el.freeDays.value), maxDevices: Number(el.freeDevices.value), maxWindows: Number(el.freeWindows.value) },
    sessionDays: Number(el.sessionDays.value),
    emailVerificationRequired: el.emailVerificationRequired.checked,
    smtp: {
      host: el.smtpHost.value.trim(), port: Number(el.smtpPort.value), secure: el.smtpSecure.checked, username: el.smtpUsername.value.trim(),
      fromEmail: el.smtpFromEmail.value.trim(), fromName: el.smtpFromName.value.trim(),
      ...(el.smtpPassword.value ? { password: el.smtpPassword.value } : {}),
    },
    paymentMethods: [
      { code: 'wechat', enabled: el.wechatEnabled.checked, payUrl: el.wechatUrl.value.trim(), instructions: el.wechatInstructions.value.trim() },
      { code: 'alipay', enabled: el.alipayEnabled.checked, payUrl: el.alipayUrl.value.trim(), instructions: el.alipayInstructions.value.trim() },
    ],
  };
  const data = await api('/admin/api/account/settings', { method: 'PUT', body: JSON.stringify(body) });
  el.smtpPassword.value = '';
  renderSettings(data);
  setMessage(el.settingsMessage, '配置已保存。客户端下次刷新账户配置时生效。', 'good');
}

async function sendTestEmail() {
  const email = el.testEmail.value.trim();
  if (!email) return setMessage(el.settingsMessage, '请输入测试收件邮箱。', 'bad');
  el.sendTestEmail.disabled = true;
  try {
    await api('/admin/api/account/settings/test-email', { method: 'POST', body: JSON.stringify({ email }) });
    setMessage(el.settingsMessage, `测试邮件已提交发送至 ${email}。`, 'good');
  } catch (error) { setMessage(el.settingsMessage, `测试邮件失败：${error.message}`, 'bad'); }
  finally { el.sendTestEmail.disabled = false; }
}

function formatRuntimeEntry(entry) {
  const detail = entry?.detail && Object.keys(entry.detail).length ? ` ${JSON.stringify(entry.detail)}` : '';
  return `${entry?.timestamp || '—'}  ${(entry?.level || 'info').toUpperCase().padEnd(5)}  ${entry?.event || 'event'}${detail}`;
}
async function loadRuntimeLogs() {
  try {
    const data = await api('/admin/api/runtime-logs?limit=400');
    const rows = Array.isArray(data.logs) ? data.logs : [];
    el.runtimeLog.textContent = rows.length ? rows.map(formatRuntimeEntry).join('\n') : '暂无服务端运行日志';
    el.runtimeLog.scrollTop = el.runtimeLog.scrollHeight;
  } catch (error) { el.runtimeLog.textContent = `运行日志读取失败：${error.message}`; }
}
async function loadAudit() {
  try {
    const data = await api('/admin/api/account/audit');
    el.audit.textContent = (data.audit || []).map((row) => `${row.created_at}  ${row.event}  user#${row.user_id ?? '-'}  ${row.detail}`).join('\n') || '暂无账户审计';
  } catch (error) { el.audit.textContent = `审计读取失败：${error.message}`; }
}
async function exportRuntimeLogs() {
  const original = el.exportRuntime.textContent;
  try {
    el.exportRuntime.disabled = true; el.exportRuntime.textContent = '导出中…';
    const response = await fetch('/admin/api/runtime-logs/export', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.message || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `gptlock-server-runtime-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  } catch (error) { alert(`导出运行日志失败：${error.message}`); }
  finally { el.exportRuntime.disabled = false; el.exportRuntime.textContent = original; }
}

function renderUpdate(data) {
  const status = data.status || {};
  const active = ACTIVE_UPDATE_STATES.has(status.status);
  const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
  el.serverVersion.textContent = data.serverVersion || 'unknown';
  el.currentCommit.textContent = shortCommit(data.currentCommit); el.currentCommit.title = data.currentCommit || '';
  el.targetRef.textContent = data.targetRef || 'main';
  el.updateProgress.style.width = `${percent}%`; el.updatePercent.textContent = `${percent}%`;
  el.updateMessage.textContent = status.message || '尚未执行版本更新';
  el.updateLog.textContent = Array.isArray(data.log) && data.log.length ? data.log.join('\n') : '暂无更新日志'; el.updateLog.scrollTop = el.updateLog.scrollHeight;
  el.updateButton.disabled = active || !data.updaterReady; el.updateButton.textContent = active ? '正在更新…' : '版本更新';
  el.updateWarning.hidden = data.updaterReady; el.updateWarning.textContent = data.updaterReady ? '' : '系统更新器尚未安装，请先安装 updater systemd 单元。';
  if (status.status === 'failed' && status.error) { el.updateWarning.hidden = false; el.updateWarning.textContent = `更新失败：${status.error}`; }
  if (updateWasActive && !active && status.status === 'succeeded') el.updateMessage.textContent = `${status.message || '更新完成'}，后台已切换到新版本。`;
  updateWasActive = active;
}
async function loadUpdate() {
  try { renderUpdate(await api('/admin/api/update')); }
  catch (error) {
    if (!el.app.hidden) { el.updateMessage.textContent = '服务正在重启，等待重新连接…'; el.updateWarning.hidden = false; el.updateWarning.textContent = error.message; }
  }
}
function startUpdatePolling() { if (!updatePoll) updatePoll = setInterval(() => void loadUpdate(), 1000); }
function stopUpdatePolling() { if (updatePoll) { clearInterval(updatePoll); updatePoll = null; } }

async function loadDashboard() { renderDashboard(await api('/admin/api/account/dashboard')); }

async function loadAll() {
  try {
    await loadDashboard();
    el.login.hidden = true; el.app.hidden = false; el.logout.hidden = false;
    await Promise.all([loadUsers(), loadPlans(), loadOrders(), loadSettings(), loadRuntimeLogs(), loadAudit(), loadUpdate()]);
    startUpdatePolling();
  } catch (error) {
    if (error.status === 401) {
      stopUpdatePolling(); el.app.hidden = true; el.login.hidden = false; el.logout.hidden = true;
    } else if (!el.app.hidden) {
      setMessage(el.loginMessage, error.message, 'bad');
    }
  }
}

el.loginButton.addEventListener('click', async () => {
  try {
    await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: el.password.value }) });
    el.password.value = ''; setMessage(el.loginMessage, ''); await loadAll();
  } catch (error) { setMessage(el.loginMessage, error.message, 'bad'); }
});
el.password.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.loginButton.click(); });
el.logout.addEventListener('click', async () => { stopUpdatePolling(); await api('/admin/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });
el.refreshUsers.addEventListener('click', () => void Promise.all([loadUsers(), loadDashboard()]));
el.userSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') void loadUsers(); });
el.refreshOrders.addEventListener('click', () => void loadOrders());
el.saveSettings.addEventListener('click', () => {
  el.saveSettings.disabled = true;
  void saveSettings().catch((error) => setMessage(el.settingsMessage, error.message, 'bad')).finally(() => { el.saveSettings.disabled = false; });
});
el.sendTestEmail.addEventListener('click', () => void sendTestEmail());
el.refreshRuntime.addEventListener('click', () => void Promise.all([loadRuntimeLogs(), loadAudit()]));
el.exportRuntime.addEventListener('click', () => void exportRuntimeLogs());
el.updateButton.addEventListener('click', async () => {
  try {
    el.updateButton.disabled = true; el.updateButton.textContent = '正在提交…';
    await api('/admin/api/update', { method: 'POST', body: '{}' }); updateWasActive = true; await loadUpdate(); startUpdatePolling();
  } catch (error) { el.updateWarning.hidden = false; el.updateWarning.textContent = error.message; el.updateButton.disabled = false; el.updateButton.textContent = '版本更新'; }
});

void loadAll();
