const $ = (id) => document.getElementById(id);
const state = { config: null, updatedAt: null };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return body;
}
function message(value, tone = '') { const target = $('websiteMessage'); target.textContent = value || ''; target.className = `message ${tone}`.trim(); }
function node(tag, className = '', text = '') { const item = document.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; }
function label(text, control) { const wrap = node('label'); wrap.append(document.createTextNode(text), control); return wrap; }
function input(value = '', type = 'text') { const item = document.createElement('input'); item.type = type; item.value = value ?? ''; return item; }
function textarea(value = '', rows = 4) { const item = document.createElement('textarea'); item.rows = rows; item.value = value ?? ''; return item; }
function checkbox(checked = false) { const item = input('', 'checkbox'); item.checked = Boolean(checked); return item; }
function button(text, handler, className = '') { const item = node('button', className, text); item.type = 'button'; item.addEventListener('click', handler); return item; }
function localDate(value) { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '尚未发布修改' : `最近保存：${date.toLocaleString('zh-CN', { hour12: false })}`; }
function attach(control, object, key, parser = (value) => value) { const event = control.type === 'checkbox' ? 'change' : 'input'; control.addEventListener(event, () => { object[key] = parser(control.type === 'checkbox' ? control.checked : control.value); }); return control; }
function textField(grid, object, key, title, options = {}) { const control = options.multiline ? textarea(object[key], options.rows || 4) : input(object[key]); if (options.max) control.maxLength = options.max; attach(control, object, key); const wrap = label(title, control); if (options.wide) wrap.classList.add('wide'); grid.append(wrap); return control; }
function hrefField(grid, object, key, title, wide = false) { const control = input(object[key]); control.placeholder = '/guide 或 https://...'; attach(control, object, key); const wrap = label(title, control); if (wide) wrap.classList.add('wide'); grid.append(wrap); }
function toggleRowDisabled(row, enabled) { row.classList.toggle('is-disabled', !enabled); }

function renderNavigation() {
  const wrap = $('navigationEditor'); wrap.replaceChildren();
  const rows = [...(state.config.navigation || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const item of rows) {
    const row = node('div', 'module-editor nav-row'); toggleRowDisabled(row, item.enabled);
    const enabled = attach(checkbox(item.enabled), item, 'enabled', Boolean); enabled.addEventListener('change', () => toggleRowDisabled(row, enabled.checked));
    const enabledWrap = node('label', 'checkline'); enabledWrap.append(enabled, document.createTextNode('显示'));
    const labelInput = attach(input(item.label), item, 'label'); labelInput.maxLength = 80;
    const hrefInput = attach(input(item.href), item, 'href'); hrefInput.placeholder = '/path 或 https://...';
    const orderInput = attach(input(item.order, 'number'), item, 'order', Number); orderInput.min = '-9999'; orderInput.max = '9999';
    row.append(enabledWrap, label('名称', labelInput), label('链接', hrefInput), label('顺序', orderInput), button('删除', () => { state.config.navigation = state.config.navigation.filter((entry) => entry !== item); renderNavigation(); }, 'danger'));
    wrap.append(row);
  }
  if (!rows.length) wrap.append(node('div', 'module-empty', '当前没有顶部导航。'));
}

function itemsEditor(grid, module, maxItems) {
  const wrap = node('div', 'nested-items');
  (module.items || []).forEach((item, index) => { const row = node('div', 'nested-item'); textField(row, item, 'title', `项目 ${index + 1} 标题`, { max: 160 }); textField(row, item, 'body', `项目 ${index + 1} 说明`, { multiline: true, rows: 3, max: 1200 }); wrap.append(row); });
  const controls = node('div', 'module-controls');
  if ((module.items || []).length < maxItems) controls.append(button('增加项目', () => { module.items ||= []; module.items.push({ title: `项目 ${module.items.length + 1}`, body: '' }); renderHomeModules(); }));
  if ((module.items || []).length > 1) controls.append(button('删除最后一项', () => { module.items.pop(); renderHomeModules(); }, 'danger'));
  wrap.append(controls); grid.append(wrap);
}
function renderHomeFields(grid, module) {
  if (module.type === 'hero') {
    textField(grid, module, 'badge', '顶部徽标', { wide: true, max: 160 }); textField(grid, module, 'title', '主标题', { multiline: true, rows: 2, max: 300 }); textField(grid, module, 'body', '主说明', { wide: true, multiline: true, rows: 7, max: 5000 });
    textField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }); hrefField(grid, module, 'primaryHref', '主按钮链接'); textField(grid, module, 'secondaryLabel', '下载按钮文字', { max: 80 }); hrefField(grid, module, 'secondaryHref', '下载按钮链接'); textField(grid, module, 'tertiaryLabel', '第三按钮文字', { max: 80 }); hrefField(grid, module, 'tertiaryHref', '第三按钮链接');
    textField(grid, module, 'statusLabel', '状态徽标', { max: 100 }); textField(grid, module, 'modelValue', '锁定模型值', { max: 100 }); textField(grid, module, 'modeValue', 'Work 模式值', { max: 100 }); textField(grid, module, 'stateValue', '状态值', { max: 100 }); textField(grid, module, 'reasoningValue', '推理偏好值', { max: 100 }); textField(grid, module, 'protectionValue', '异常保护值', { max: 140 }); textField(grid, module, 'noteText', '右侧提示卡', { multiline: true, rows: 2, max: 200 }); textField(grid, module, 'signalTitle', '右侧信号卡标题', { max: 100 }); textField(grid, module, 'signalText', '右侧信号卡说明', { wide: true, multiline: true, rows: 2, max: 300 });
  } else if (module.type === 'features') { textField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }); textField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }); itemsEditor(grid, module, 6); }
  else if (module.type === 'workflow') { textField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }); textField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }); itemsEditor(grid, module, 8); textField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }); hrefField(grid, module, 'primaryHref', '主按钮链接'); textField(grid, module, 'secondaryLabel', '第二按钮文字', { max: 80 }); hrefField(grid, module, 'secondaryHref', '第二按钮链接'); }
  else { textField(grid, module, 'title', '模块标题', { wide: true, max: 300 }); textField(grid, module, 'body', '模块正文', { wide: true, multiline: true, rows: module.type === 'custom' ? 7 : 4, max: module.type === 'custom' ? 5000 : 1200 }); textField(grid, module, 'buttonLabel', '按钮文字', { max: 80 }); hrefField(grid, module, 'buttonHref', '按钮链接'); }
}
function renderHomeModules() {
  const wrap = $('homeModulesEditor'); wrap.replaceChildren(); const modules = [...(state.config.homeModules || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const module of modules) {
    const card = node('article', 'module-editor'); toggleRowDisabled(card, module.enabled);
    const head = node('div', 'module-head'); const title = node('div', 'module-title'); const titleText = node('div'); titleText.append(node('strong', '', module.name || module.id), node('small', '', `${module.type} · ${module.id}`)); title.append(titleText);
    const controls = node('div', 'module-controls'); const enabled = attach(checkbox(module.enabled), module, 'enabled', Boolean); enabled.addEventListener('change', () => toggleRowDisabled(card, enabled.checked)); const enabledLabel = node('label'); enabledLabel.append(enabled, document.createTextNode('启用'));
    const orderInput = attach(input(module.order, 'number'), module, 'order', Number); controls.append(enabledLabel, label('顺序', orderInput)); if (module.type === 'custom') controls.append(button('删除模块', () => { state.config.homeModules = state.config.homeModules.filter((entry) => entry !== module); renderHomeModules(); }, 'danger module-danger'));
    head.append(title, controls); card.append(head); const grid = node('div', 'module-grid'); renderHomeFields(grid, module); card.append(grid); wrap.append(card);
  }
}

function renderPageModule(module) {
  const card = node('div', 'module-editor'); toggleRowDisabled(card, module.enabled);
  const head = node('div', 'module-head'); const title = node('div', 'module-title'); title.append(node('strong', '', module.name), node('small', '', module.type === 'protected' ? `受保护功能 · ${module.id}` : `内容模块 · ${module.id}`));
  const controls = node('div', 'module-controls'); const enabled = attach(checkbox(module.enabled), module, 'enabled', Boolean); enabled.addEventListener('change', () => toggleRowDisabled(card, enabled.checked)); const enabledLabel = node('label'); enabledLabel.append(enabled, document.createTextNode('启用')); controls.append(enabledLabel);
  if (module.lockedOrder) controls.append(node('small', '', '固定顺序')); else { const orderInput = attach(input(module.order, 'number'), module, 'order', Number); controls.append(label('顺序', orderInput)); }
  head.append(title, controls); card.append(head);
  if (module.type === 'protected') { const note = node('p', 'muted', '内部 DOM、表单字段、业务按钮和 API 绑定受保护；CMS 不会修改这些节点。'); card.append(note); }
  if (module.type === 'callout') { const grid = node('div', 'module-grid'); textField(grid, module, 'title', '标题', { wide: true, max: 300 }); textField(grid, module, 'body', '说明', { wide: true, multiline: true, rows: 4, max: 1600 }); textField(grid, module, 'buttonLabel', '按钮文字', { max: 80 }); hrefField(grid, module, 'buttonHref', '按钮链接'); card.append(grid); }
  return card;
}
function renderPages() {
  const wrap = $('pagesEditor'); wrap.replaceChildren();
  for (const [key, page] of Object.entries(state.config.pages || {})) {
    const card = node('article', 'module-editor'); const head = node('div', 'module-head'); const title = node('div', 'module-title'); title.append(node('strong', '', page.name || key), node('small', '', `/${key === 'account' ? 'account' : key}`)); const preview = node('a', 'button-link', '预览 ↗'); preview.href = `/${key}`; preview.target = '_blank'; preview.rel = 'noopener noreferrer'; head.append(title, preview); card.append(head);
    const grid = node('div', 'module-grid'); textField(grid, page, 'browserTitle', '浏览器标题', { max: 160 }); textField(grid, page, 'description', 'SEO 描述', { multiline: true, rows: 3, max: 500, wide: true }); textField(grid, page.hero, 'eyebrow', '顶部短标题', { max: 160 }); textField(grid, page.hero, 'title', '页面主标题', { multiline: true, rows: 2, max: 300 }); textField(grid, page.hero, 'body', '页面引导说明', { multiline: true, rows: 4, max: 2000, wide: true }); card.append(grid);
    const modules = node('div', 'nested-items'); (page.modules || []).sort((a,b) => Number(a.order)-Number(b.order)).forEach((module) => modules.append(renderPageModule(module))); card.append(modules); wrap.append(card);
  }
}

function render() { const config = state.config; $('siteBrandName').value = config.site.brandName || ''; $('siteTitle').value = config.site.title || ''; $('siteDescription').value = config.site.description || ''; $('siteFooterText').value = config.site.footerText || ''; $('websiteUpdated').textContent = localDate(state.updatedAt); renderNavigation(); renderHomeModules(); renderPages(); }
function collectSite() { state.config.site.brandName = $('siteBrandName').value; state.config.site.title = $('siteTitle').value; state.config.site.description = $('siteDescription').value; state.config.site.footerText = $('siteFooterText').value; }
async function loadWebsite() { const data = await api('/admin/api/website'); state.config = data.config; state.updatedAt = data.updatedAt; render(); }
async function authenticate() { try { await api('/admin/api/account/dashboard'); $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; await loadWebsite(); } catch (error) { if (error.status === 401) { $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; } else $('loginMessage').textContent = error.message; } }
async function saveWebsite() { collectSite(); const save = $('saveWebsite'); save.disabled = true; save.textContent = '正在发布…'; message('正在保存官网模块配置…'); try { const data = await api('/admin/api/website', { method: 'PUT', body: JSON.stringify({ config: state.config }) }); state.config = data.config; state.updatedAt = data.updatedAt; render(); message('官网配置已保存并发布。刷新官网即可看到最新内容。', 'good'); } catch (error) { message(error.message, 'bad'); } finally { save.disabled = false; save.textContent = '保存并发布'; } }
let resetArmedUntil = 0;
async function resetWebsite() { const reset = $('resetWebsite'); if (Date.now() > resetArmedUntil) { resetArmedUntil = Date.now() + 5000; reset.textContent = '再次点击确认恢复'; setTimeout(() => { if (Date.now() > resetArmedUntil) reset.textContent = '恢复默认'; }, 5100); return; } resetArmedUntil = 0; reset.disabled = true; try { const data = await api('/admin/api/website/reset', { method: 'POST', body: '{}' }); state.config = data.config; state.updatedAt = data.updatedAt; render(); message('官网已经恢复到系统默认模块配置。', 'good'); } catch (error) { message(error.message, 'bad'); } finally { reset.disabled = false; reset.textContent = '恢复默认'; } }

$('loginButton').addEventListener('click', async () => { try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; $('loginMessage').textContent = ''; await authenticate(); } catch (error) { $('loginMessage').textContent = error.message; } });
$('password').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('loginButton').click(); });
$('logout').addEventListener('click', async () => { await api('/admin/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });
$('saveWebsite').addEventListener('click', () => void saveWebsite()); $('resetWebsite').addEventListener('click', () => void resetWebsite());
$('addNav').addEventListener('click', () => { state.config.navigation ||= []; state.config.navigation.push({ id: `nav-${Date.now().toString(36)}`, label: '新导航', href: '/', enabled: true, order: state.config.navigation.length ? Math.max(...state.config.navigation.map((item) => Number(item.order) || 0)) + 10 : 10, account: false }); renderNavigation(); });
$('addCustomModule').addEventListener('click', () => { state.config.homeModules ||= []; state.config.homeModules.push({ id: `custom-${Date.now().toString(36)}`, type: 'custom', name: '自定义内容', enabled: true, order: state.config.homeModules.length ? Math.max(...state.config.homeModules.map((item) => Number(item.order) || 0)) + 10 : 10, title: '新的内容模块', body: '在这里填写模块正文。', buttonLabel: '', buttonHref: '/' }); renderHomeModules(); });
void authenticate();
