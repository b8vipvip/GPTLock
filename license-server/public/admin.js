const $ = (id) => document.getElementById(id);
const el = {
  login: $('login'), app: $('app'), password: $('password'), loginButton: $('loginButton'), loginMessage: $('loginMessage'), logout: $('logout'),
  label: $('label'), maxDevices: $('maxDevices'), maxWindows: $('maxWindows'), expiresAt: $('expiresAt'), note: $('note'), create: $('create'),
  newCode: $('newCode'), newCodeValue: $('newCodeValue'), copyCode: $('copyCode'), licenses: $('licenses'), refresh: $('refresh'), audit: $('audit'),
};

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}
function localDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function escapeText(value) { return String(value ?? ''); }
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
    actions.append(toggle, edit, release); tr.append(actions); el.licenses.append(tr);
  }
}
async function load() {
  try {
    const [licenses, audit] = await Promise.all([api('/admin/api/licenses'), api('/admin/api/audit')]);
    el.login.hidden = true; el.app.hidden = false; el.logout.hidden = false;
    renderLicenses(licenses.licenses);
    el.audit.textContent = audit.audit.map((row) => `${row.created_at}  ${row.event}  #${row.license_id ?? '-'}  ${row.detail}`).join('\n');
  } catch (error) {
    el.app.hidden = true; el.login.hidden = false; el.logout.hidden = true;
    if (!/管理员登录/.test(error.message)) el.loginMessage.textContent = error.message;
  }
}
async function updateLicense(id, patch) { await api(`/admin/api/licenses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); await load(); }
async function releaseDevices(id) { await api(`/admin/api/licenses/${id}/release-devices`, { method: 'POST', body: '{}' }); await load(); }

el.loginButton.addEventListener('click', async () => { try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: el.password.value }) }); el.password.value = ''; el.loginMessage.textContent = ''; await load(); } catch (e) { el.loginMessage.textContent = e.message; } });
el.password.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.loginButton.click(); });
el.logout.addEventListener('click', async () => { await api('/admin/api/logout', { method: 'POST', body: '{}' }); location.reload(); });
el.refresh.addEventListener('click', () => void load());
el.create.addEventListener('click', async () => {
  try {
    const expiresAt = new Date(el.expiresAt.value).toISOString();
    const result = await api('/admin/api/licenses', { method: 'POST', body: JSON.stringify({ label: el.label.value, note: el.note.value, maxDevices: Number(el.maxDevices.value), maxWindows: Number(el.maxWindows.value), expiresAt }) });
    el.newCode.hidden = false; el.newCodeValue.textContent = result.code; await load();
  } catch (e) { alert(e.message); }
});
el.copyCode.addEventListener('click', () => void navigator.clipboard.writeText(el.newCodeValue.textContent || ''));
defaultExpiry(); void load();
