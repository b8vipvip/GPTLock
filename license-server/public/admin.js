const $ = (id) => document.getElementById(id);
const el = {
  login: $('login'), app: $('app'), password: $('password'), loginButton: $('loginButton'), loginMessage: $('loginMessage'), logout: $('logout'),
  label: $('label'), maxDevices: $('maxDevices'), maxWindows: $('maxWindows'), expiresAt: $('expiresAt'), note: $('note'), create: $('create'),
  newCode: $('newCode'), newCodeValue: $('newCodeValue'), copyCode: $('copyCode'), licenses: $('licenses'), refresh: $('refresh'), audit: $('audit'),
  updateButton: $('updateButton'), serverVersion: $('serverVersion'), currentCommit: $('currentCommit'), targetRef: $('targetRef'),
  updateProgress: $('updateProgress'), updatePercent: $('updatePercent'), updateMessage: $('updateMessage'), updateWarning: $('updateWarning'), updateLog: $('updateLog'),
  runtimeLog: $('runtimeLog'), refreshRuntime: $('refreshRuntime'), exportRuntime: $('exportRuntime'),
};
const ACTIVE_UPDATE_STATES = new Set(['queued', 'running', 'restarting', 'rolling_back']);
let updatePoll = null;
let updateWasActive = false;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}
async function copyText(value) {
  const text = String(value || '');
  if (!text) throw new Error('没有可复制的授权码');
  await navigator.clipboard.writeText(text);
}
async function copyLicenseCode(row, button) {
  const original = button.textContent;
  try {
    button.disabled = true;
    button.textContent = '复制中…';
    const result = await api(`/admin/api/licenses/${row.id}/code`);
    await copyText(result.code);
    button.textContent = '已复制';
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    button.textContent = original;
    button.disabled = false;
    alert(error.message);
  }
}
function localDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function escapeText(value) { return String(value ?? ''); }
function shortCommit(value) { return value ? String(value).slice(0, 12) : '—'; }
function defaultExpiry() {
  const date = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  el.expiresAt.value = date.toISOString().slice(0, 16);
}
function renderLicenses(rows) {
  el.licenses.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    const cells = [row.id, row.hint, row.label || '—', row.status === 'active' ? '启用' : '停用', `${row.usage.devices}/${row.limits.devices}`, `${row.usage.windows}/${row.limits.windows}`, localDate(row.expiresAt)];
    for (const value of cells) { const td = document.createElement('td'); td.textContent = escapeText(value); tr.append(td); }
    const actions = document.createElement('td');
    const copy = document.createElement('button');
    copy.textContent = row.codeAvailable ? '复制授权码' : '历史码不可恢复';
    copy.disabled = !row.codeAvailable;
    copy.title = row.codeAvailable ? '复制完整授权码' : '该授权创建于完整授权码加密保存功能上线之前，服务器只有不可逆摘要，无法恢复原码';
    if (row.codeAvailable) copy.addEventListener('click', () => void copyLicenseCode(row, copy));
    const toggle = document.createElement('button'); toggle.textContent = row.status === 'active' ? '停用' : '启用';
    toggle.addEventListener('click', () => void updateLicense(row.id, { status: row.status === 'active' ? 'revoked' : 'active' }));
    const edit = document.createElement('button'); edit.textContent = '修改限制';
    edit.addEventListener('click', () => {
      const devices = prompt('设备上限', String(row.limits.devices)); if (devices === null) return;
      const windows = prompt('同时窗口上限', String(row.limits.windows)); if (windows === null) return;
      const expiresAt = prompt('到期时间（ISO 或可解析日期）', row.expiresAt); if (expiresAt === null) return;
      void updateLicense(row.id, { maxDevices: Number(devices), maxWindows: Number(windows), expiresAt });
    });
    const release = document.createElement('button'); release.textContent = '释放设备';
    release.addEventListener('click', () => { if (confirm('确认清空此授权的设备绑定和浏览器激活？')) void releaseDevices(row.id); });
    actions.append(copy, toggle, edit, release); tr.append(actions); el.licenses.append(tr);
  }
}
function renderUpdate(data) {
  const status = data.status || {};
  const active = ACTIVE_UPDATE_STATES.has(status.status);
  const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
  el.serverVersion.textContent = data.serverVersion || 'unknown';
  el.currentCommit.textContent = shortCommit(data.currentCommit);
  el.currentCommit.title = data.currentCommit || '';
  el.targetRef.textContent = data.targetRef || 'main';
  el.updateProgress.style.width = `${percent}%`;
  el.updatePercent.textContent = `${percent}%`;
  el.updateMessage.textContent = status.message || '尚未执行版本更新';
  el.updateLog.textContent = Array.isArray(data.log) && data.log.length ? data.log.join('\n') : '暂无更新日志';
  el.updateLog.scrollTop = el.updateLog.scrollHeight;
  el.updateButton.disabled = active || !data.updaterReady;
  el.updateButton.textContent = active ? '正在更新…' : '版本更新';
  el.updateWarning.hidden = data.updaterReady;
  el.updateWarning.textContent = data.updaterReady ? '' : '系统更新器尚未安装。请先在服务器运行 license-server/scripts/install-updater-systemd.sh。';
  if (status.status === 'failed' && status.error) {
    el.updateWarning.hidden = false;
    el.updateWarning.textContent = `更新失败：${status.error}`;
  }
  if (updateWasActive && !active && status.status === 'succeeded') {
    el.updateMessage.textContent = `${status.message || '更新完成'}，后台已切换到新版本。`;
  }
  updateWasActive = active;
}
function formatRuntimeEntry(entry) {
  const detail = entry?.detail && Object.keys(entry.detail).length ? ` ${JSON.stringify(entry.detail)}` : '';
  return `${entry?.timestamp || '—'}  ${(entry?.level || 'info').toUpperCase().padEnd(5)}  ${entry?.event || 'event'}${detail}`;
}
async function loadRuntimeLogs() {
  if (!el.runtimeLog) return;
  try {
    const data = await api('/admin/api/runtime-logs?limit=400');
    const rows = Array.isArray(data.logs) ? data.logs : [];
    el.runtimeLog.textContent = rows.length ? rows.map(formatRuntimeEntry).join('\n') : '暂无服务端运行日志';
    el.runtimeLog.scrollTop = el.runtimeLog.scrollHeight;
  } catch (error) {
    el.runtimeLog.textContent = `运行日志读取失败：${error.message}`;
  }
}
async function exportRuntimeLogs() {
  const original = el.exportRuntime.textContent;
  try {
    el.exportRuntime.disabled = true;
    el.exportRuntime.textContent = '导出中…';
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
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(`导出运行日志失败：${error.message}`);
  } finally {
    el.exportRuntime.disabled = false;
    el.exportRuntime.textContent = original;
  }
}
async function loadUpdate() {
  try {
    const data = await api('/admin/api/update');
    renderUpdate(data);
  } catch (error) {
    if (!el.app.hidden) {
      el.updateMessage.textContent = '授权服务正在重启，等待重新连接…';
      el.updateWarning.hidden = false;
      el.updateWarning.textContent = error.message;
    }
  }
}
function startUpdatePolling() {
  if (updatePoll) return;
  updatePoll = setInterval(() => void loadUpdate(), 1000);
}
function stopUpdatePolling() {
  if (!updatePoll) return;
  clearInterval(updatePoll);
  updatePoll = null;
}
async function load() {
  try {
    const [licenses, audit] = await Promise.all([api('/admin/api/licenses'), api('/admin/api/audit')]);
    el.login.hidden = true; el.app.hidden = false; el.logout.hidden = false;
    renderLicenses(licenses.licenses);
    el.audit.textContent = audit.audit.map((row) => `${row.created_at}  ${row.event}  #${row.license_id ?? '-'}  ${row.detail}`).join('\n');
    await Promise.all([loadUpdate(), loadRuntimeLogs()]);
    startUpdatePolling();
  } catch (error) {
    stopUpdatePolling();
    el.app.hidden = true; el.login.hidden = false; el.logout.hidden = true;
    if (!/管理员登录/.test(error.message)) el.loginMessage.textContent = error.message;
  }
}
async function updateLicense(id, patch) { await api(`/admin/api/licenses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); await load(); }
async function releaseDevices(id) { await api(`/admin/api/licenses/${id}/release-devices`, { method: 'POST', body: '{}' }); await load(); }

el.loginButton.addEventListener('click', async () => { try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: el.password.value }) }); el.password.value = ''; el.loginMessage.textContent = ''; await load(); } catch (e) { el.loginMessage.textContent = e.message; } });
el.password.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.loginButton.click(); });
el.logout.addEventListener('click', async () => { stopUpdatePolling(); await api('/admin/api/logout', { method: 'POST', body: '{}' }); location.reload(); });
el.refresh.addEventListener('click', () => void load());
el.refreshRuntime?.addEventListener('click', () => void loadRuntimeLogs());
el.exportRuntime?.addEventListener('click', () => void exportRuntimeLogs());
el.updateButton.addEventListener('click', async () => {
  try {
    el.updateButton.disabled = true;
    el.updateButton.textContent = '正在提交…';
    await api('/admin/api/update', { method: 'POST', body: '{}' });
    updateWasActive = true;
    await loadUpdate();
    startUpdatePolling();
  } catch (e) {
    el.updateWarning.hidden = false;
    el.updateWarning.textContent = e.message;
    el.updateButton.disabled = false;
    el.updateButton.textContent = '版本更新';
  }
});
el.create.addEventListener('click', async () => {
  try {
    const expiresAt = new Date(el.expiresAt.value).toISOString();
    const result = await api('/admin/api/licenses', { method: 'POST', body: JSON.stringify({ label: el.label.value, note: el.note.value, maxDevices: Number(el.maxDevices.value), maxWindows: Number(el.maxWindows.value), expiresAt }) });
    el.newCode.hidden = false; el.newCodeValue.textContent = result.code; await load();
  } catch (e) { alert(e.message); }
});
el.copyCode.addEventListener('click', async () => {
  try { await copyText(el.newCodeValue.textContent); }
  catch (error) { alert(error.message); }
});
defaultExpiry(); void load();
