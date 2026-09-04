const $ = (id) => document.getElementById(id);
const state = { config: null, updatedAt: null };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return body;
}
function message(value, tone = '') { const node = $('websiteMessage'); node.textContent = value || ''; node.className = `message ${tone}`.trim(); }
function node(tag, className = '', text = '') { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; }
function label(text, control) { const wrap = node('label'); wrap.append(document.createTextNode(text), control); return wrap; }
function input(value = '', type = 'text') { const el = document.createElement('input'); el.type = type; el.value = value ?? ''; return el; }
function textarea(value = '', rows = 4) { const el = document.createElement('textarea'); el.rows = rows; el.value = value ?? ''; return el; }
function checkbox(checked = false) { const el = document.createElement('input'); el.type = 'checkbox'; el.checked = Boolean(checked); return el; }
function button(text, handler, className = '') { const el = node('button', className, text); el.type = 'button'; el.addEventListener('click', handler); return el; }
function localDate(value) { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '尚未发布修改' : `最近保存：${date.toLocaleString('zh-CN', { hour12: false })}`; }
function attach(control, object, key, parser = (value) => value) { const event = control.type === 'checkbox' ? 'change' : 'input'; control.addEventListener(event, () => { object[key] = parser(control.type === 'checkbox' ? control.checked : control.value); }); return control; }
function addTextField(grid, object, key, title, { wide = false, multiline = false, rows = 4, max = 0 } = {}) {
  const control = multiline ? textarea(object[key], rows) : input(object[key]); if (max) control.maxLength = max; attach(control, object, key);
  const wrap = label(title, control); if (wide) wrap.classList.add('wide'); grid.append(wrap); return control;
}
function addHrefField(grid, object, key, title, wide = false) { const control = input(object[key]); control.placeholder = '/guide 或 https://...'; attach(control, object, key); const wrap = label(title, control); if (wide) wrap.classList.add('wide'); grid.append(wrap); }

function injectWebsiteNav() {
  const nav = document.querySelector('.sidebar nav'); if (!nav || nav.querySelector('[data-page="website"]')) return;
  const link = node('a', '', '官网管理'); link.href = '/admin/website'; link.dataset.page = 'website';
  const before = nav.querySelector('[data-page="settings"]'); before ? nav.insertBefore(link, before) : nav.append(link);
}

function renderNavigation() {
  const wrap = $('navigationEditor'); wrap.replaceChildren();
  const rows = [...(state.config.navigation || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const item of rows) {
    const row = node('div', 'module-editor nav-row'); if (!item.enabled) row.classList.add('is-disabled');
    const enabled = attach(checkbox(item.enabled), item, 'enabled', Boolean); enabled.addEventListener('change', () => row.classList.toggle('is-disabled', !enabled.checked));
    const enabledWrap = node('label', 'checkline'); enabledWrap.append(enabled, document.createTextNode('显示'));
    const labelInput = attach(input(item.label), item, 'label'); labelInput.maxLength = 80;
    const hrefInput = attach(input(item.href), item, 'href'); hrefInput.placeholder = '/path 或 https://...';
    const orderInput = attach(input(item.order, 'number'), item, 'order', Number); orderInput.min = '-9999'; orderInput.max = '9999';
    row.append(enabledWrap, label('名称', labelInput), label('链接', hrefInput), label('顺序', orderInput), button('删除', () => { state.config.navigation = state.config.navigation.filter((entry) => entry !== item); renderNavigation(); }, 'danger'));
    wrap.append(row);
  }
  if (!rows.length) wrap.append(node('div', 'module-empty', '当前没有顶部导航。'));
}

function addItemsEditor(grid, module, maxItems) {
  const wrap = node('div', 'nested-items');
  (module.items || []).forEach((item, index) => {
    const row = node('div', 'nested-item');
    addTextField(row, item, 'title', `项目 ${index + 1} 标题`, { max: 160 });
    addTextField(row, item, 'body', `项目 ${index + 1} 说明`, { multiline: true, rows: 3, max: 1200 });
    wrap.append(row);
  });
  const controls = node('div', 'module-controls');
  if ((module.items || []).length < maxItems) controls.append(button('增加项目', () => { module.items ||= []; module.items.push({ title: `项目 ${module.items.length + 1}`, body: '' }); renderModules(); }));
  if ((module.items || []).length > 1) controls.append(button('删除最后一项', () => { module.items.pop(); renderModules(); }, 'danger'));
  wrap.append(controls); grid.append(wrap);
}

function renderModuleFields(grid, module) {
  if (module.type === 'hero') {
    addTextField(grid, module, 'badge', '顶部徽标', { wide: true, max: 160 });
    addTextField(grid, module, 'title', '主标题', { multiline: true, rows: 2, max: 300 });
    addTextField(grid, module, 'body', '主说明', { wide: true, multiline: true, rows: 7, max: 5000 });
    addTextField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }); addHrefField(grid, module, 'primaryHref', '主按钮链接');
    addTextField(grid, module, 'secondaryLabel', '下载按钮文字', { max: 80 }); addHrefField(grid, module, 'secondaryHref', '下载按钮链接');
    addTextField(grid, module, 'tertiaryLabel', '第三按钮文字', { max: 80 }); addHrefField(grid, module, 'tertiaryHref', '第三按钮链接');
    addTextField(grid, module, 'statusLabel', '状态徽标', { max: 100 }); addTextField(grid, module, 'modelValue', '锁定模型值', { max: 100 });
    addTextField(grid, module, 'modeValue', 'Work 模式值', { max: 100 }); addTextField(grid, module, 'stateValue', '状态值', { max: 100 });
    addTextField(grid, module, 'reasoningValue', '推理偏好值', { max: 100 }); addTextField(grid, module, 'protectionValue', '异常保护值', { max: 140 });
    addTextField(grid, module, 'noteText', '右侧提示卡', { multiline: true, rows: 2, max: 200 }); addTextField(grid, module, 'signalTitle', '右侧信号卡标题', { max: 100 });
    addTextField(grid, module, 'signalText', '右侧信号卡说明', { wide: true, multiline: true, rows: 2, max: 300 });
  } else if (module.type === 'features') {
    addTextField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }); addTextField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }); addItemsEditor(grid, module, 6);
  } else if (module.type === 'workflow') {
    addTextField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }); addTextField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }); addItemsEditor(grid, module, 8);
    addTextField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }); addHrefField(grid, module, 'primaryHref', '主按钮链接'); addTextField(grid, module, 'secondaryLabel', '第二按钮文字', { max: 80 }); addHrefField(grid, module, 'secondaryHref', '第二按钮链接');
  } else {
    addTextField(grid, module, 'title', '模块标题', { wide: true, max: 300 }); addTextField(grid, module, 'body', '模块正文', { wide: true, multiline: true, rows: module.type === 'custom' ? 7 : 4, max: module.type === 'custom' ? 5000 : 1200 });
    addTextField(grid, module, 'buttonLabel', '按钮文字', { max: 80 }); addHrefField(grid, module, 'buttonHref', '按钮链接');
  }
}

function renderModules() {
  const wrap = $('homeModulesEditor'); wrap.replaceChildren();
  const modules = [...(state.config.homeModules || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const module of modules) {
    const card = node('article', 'module-editor'); if (!module.enabled) card.classList.add('is-disabled');
    const head = node('div', 'module-head'); const title = node('div', 'module-title'); const titleText = node('div'); titleText.append(node('strong', '', module.name || module.id), node('small', '', `${module.type} · ${module.id}`)); title.append(titleText);
    const controls = node('div', 'module-controls'); const enabled = attach(checkbox(module.enabled), module, 'enabled', Boolean); enabled.addEventListener('change', () => card.classList.toggle('is-disabled', !enabled.checked)); const enabledLabel = node('label'); enabledLabel.append(enabled, document.createTextNode('启用'));
    const orderInput = attach(input(module.order, 'number'), module, 'order', Number); orderInput.min = '-9999'; orderInput.max = '9999'; controls.append(enabledLabel, label('顺序', orderInput));
    if (module.type === 'custom') controls.append(button('删除模块', () => { state.config.homeModules = state.config.homeModules.filter((entry) => entry !== module); renderModules(); }, 'danger module-danger'));
    head.append(title, controls); card.append(head); const grid = node('div', 'module-grid'); renderModuleFields(grid, module); card.append(grid); wrap.append(card);
  }
  if (!modules.length) wrap.append(node('div', 'module-empty', '当前没有首页模块。'));
}

function render() {
  const config = state.config; $('siteBrandName').value = config.site.brandName || ''; $('siteTitle').value = config.site.title || ''; $('siteDescription').value = config.site.description || ''; $('siteFooterText').value = config.site.footerText || '';
  $('websiteUpdated').textContent = localDate(state.updatedAt); renderNavigation(); renderModules();
}
function collectSite() { state.config.site.brandName = $('siteBrandName').value; state.config.site.title = $('siteTitle').value; state.config.site.description = $('siteDescription').value; state.config.site.footerText = $('siteFooterText').value; }
async function loadWebsite() { const data = await api('/admin/api/website'); state.config = data.config; state.updatedAt = data.updatedAt; render(); }
async function authenticate() {
  try { await api('/admin/api/account/dashboard'); $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; await loadWebsite(); }
  catch (error) { if (error.status === 401) { $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; } else { $('loginMessage').textContent = error.message; } }
}
async function saveWebsite() {
  collectSite(); const save = $('saveWebsite'); save.disabled = true; save.textContent = '正在发布…'; message('正在保存官网模块配置…');
  try { const data = await api('/admin/api/website', { method: 'PUT', body: JSON.stringify({ config: state.config }) }); state.config = data.config; state.updatedAt = data.updatedAt; render(); message('官网配置已保存并发布。刷新官网即可看到最新内容。', 'good'); }
  catch (error) { message(error.message, 'bad'); }
  finally { save.disabled = false; save.textContent = '保存并发布'; }
}
let resetArmedUntil = 0;
async function resetWebsite() {
  const reset = $('resetWebsite');
  if (Date.now() > resetArmedUntil) { resetArmedUntil = Date.now() + 5000; reset.textContent = '再次点击确认恢复'; setTimeout(() => { if (Date.now() > resetArmedUntil) reset.textContent = '恢复默认'; }, 5100); return; }
  resetArmedUntil = 0; reset.disabled = true;
  try { const data = await api('/admin/api/website/reset', { method: 'POST', body: '{}' }); state.config = data.config; state.updatedAt = data.updatedAt; render(); message('官网已经恢复到系统默认模块配置。', 'good'); }
  catch (error) { message(error.message, 'bad'); }
  finally { reset.disabled = false; reset.textContent = '恢复默认'; }
}

injectWebsiteNav();
$('loginButton').addEventListener('click', async () => { try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; $('loginMessage').textContent = ''; await authenticate(); } catch (error) { $('loginMessage').textContent = error.message; } });
$('password').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('loginButton').click(); });
$('logout').addEventListener('click', async () => { await api('/admin/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });
$('saveWebsite').addEventListener('click', () => void saveWebsite()); $('resetWebsite').addEventListener('click', () => void resetWebsite());
$('addNav').addEventListener('click', () => { state.config.navigation ||= []; state.config.navigation.push({ id: `nav-${Date.now().toString(36)}`, label: '新导航', href: '/', enabled: true, order: state.config.navigation.length ? Math.max(...state.config.navigation.map((item) => Number(item.order) || 0)) + 10 : 10, account: false }); renderNavigation(); });
$('addCustomModule').addEventListener('click', () => { state.config.homeModules ||= []; state.config.homeModules.push({ id: `custom-${Date.now().toString(36)}`, type: 'custom', name: '自定义内容', enabled: true, order: state.config.homeModules.length ? Math.max(...state.config.homeModules.map((item) => Number(item.order) || 0)) + 10 : 10, title: '新的内容模块', body: '在这里填写模块正文。', buttonLabel: '', buttonHref: '/' }); renderModules(); });
void authenticate();
