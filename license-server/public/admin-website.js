const $ = (id) => document.getElementById(id);
const state = { config: null, persisted: null, updatedAt: null };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return body;
}
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function message(value, tone = '') { const target = $('websiteMessage'); target.textContent = value || ''; target.className = `message ${tone}`.trim(); }
function node(tag, className = '', text = '') { const item = document.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; }
function label(text, control) { const wrap = node('label'); wrap.append(document.createTextNode(text), control); return wrap; }
function input(value = '', type = 'text') { const item = document.createElement('input'); item.type = type; item.value = value ?? ''; return item; }
function textarea(value = '', rows = 4) { const item = document.createElement('textarea'); item.rows = rows; item.value = value ?? ''; return item; }
function checkbox(checked = false) { const item = input('', 'checkbox'); item.checked = Boolean(checked); return item; }
function button(text, handler, className = '') { const item = node('button', className, text); item.type = 'button'; item.addEventListener('click', handler); return item; }
function localDate(value) { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '尚未发布修改' : `最近保存：${date.toLocaleString('zh-CN', { hour12: false })}`; }
function getAt(root, path) { let value = root; for (const key of path) value = value?.[key]; return value; }
function setAt(root, path, value) { let target = root; for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]]; target[path.at(-1)] = clone(value); }
function attach(control, object, key, parser = (value) => value) { const event = control.type === 'checkbox' ? 'change' : 'input'; control.addEventListener(event, () => { object[key] = parser(control.type === 'checkbox' ? control.checked : control.value); }); return control; }
function toggleRowDisabled(row, enabled) { row.classList.toggle('is-disabled', !enabled); }
function savedTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

function addSaveFooter(wrap, path) {
  if (!wrap || wrap.dataset.fieldSaveReady === '1') return wrap;
  wrap.dataset.fieldSaveReady = '1'; wrap.classList.add('cms-field');
  const footer = node('span', 'cms-field-footer'); const status = node('small', 'cms-field-status');
  const save = button('保存', () => void persistPath(path, save, status), 'cms-field-save');
  footer.append(status, save); wrap.append(footer); return wrap;
}
function savedLabel(title, control, path, options = {}) { const wrap = label(title, control); if (options.wide) wrap.classList.add('wide'); addSaveFooter(wrap, path); return wrap; }
function textField(grid, object, key, title, options = {}, path) {
  const control = options.multiline ? textarea(object[key], options.rows || 4) : input(object[key]); if (options.max) control.maxLength = options.max; attach(control, object, key);
  grid.append(savedLabel(title, control, path, { wide: options.wide })); return control;
}
function hrefField(grid, object, key, title, path, wide = false) { const control = input(object[key]); control.placeholder = '/guide 或 https://...'; attach(control, object, key); grid.append(savedLabel(title, control, path, { wide })); return control; }
function updateSavedStamp(data) { state.updatedAt = data.updatedAt; $('websiteUpdated').textContent = localDate(state.updatedAt); }

function collectSite() {
  state.config.site.brandName = $('siteBrandName').value;
  state.config.site.title = $('siteTitle').value;
  state.config.site.description = $('siteDescription').value;
  state.config.site.footerText = $('siteFooterText').value;
}
async function persistPath(path, saveButton, statusNode) {
  if (!state.config || !state.persisted) return;
  collectSite(); const next = clone(state.persisted); setAt(next, path, getAt(state.config, path));
  const original = saveButton?.textContent || '保存'; if (saveButton) { saveButton.disabled = true; saveButton.textContent = '保存中…'; }
  if (statusNode) statusNode.textContent = '正在保存';
  try {
    const data = await api('/admin/api/website', { method: 'PUT', body: JSON.stringify({ config: next }) });
    state.persisted = clone(data.config); setAt(state.config, path, getAt(data.config, path)); updateSavedStamp(data);
    if (statusNode) statusNode.textContent = `已保存 ${savedTime()}`;
    message('该字段已保存并立即在官网生效。', 'good');
  } catch (error) {
    if (statusNode) statusNode.textContent = '保存失败'; message(error.message, 'bad');
  } finally {
    if (saveButton) { saveButton.disabled = false; saveButton.textContent = original; }
  }
}
async function persistAll({ buttonNode = $('saveWebsite'), success = '全部官网配置已保存并发布。' } = {}) {
  if (!state.config) return; collectSite(); const original = buttonNode?.textContent || '全部保存并发布';
  if (buttonNode) { buttonNode.disabled = true; buttonNode.textContent = '正在保存…'; } message('正在保存官网模块配置…');
  try {
    const data = await api('/admin/api/website', { method: 'PUT', body: JSON.stringify({ config: state.config }) });
    state.config = clone(data.config); state.persisted = clone(data.config); updateSavedStamp(data); render(); message(success, 'good');
  } catch (error) { message(error.message, 'bad'); }
  finally { if (buttonNode) { buttonNode.disabled = false; buttonNode.textContent = original; } }
}
function autoPersistPath(path) { void persistPath(path, null, null); }

function installSiteFieldSaves() {
  const fields = [
    ['siteBrandName', ['site','brandName']], ['siteTitle', ['site','title']], ['siteDescription', ['site','description']], ['siteFooterText', ['site','footerText']],
  ];
  for (const [id, path] of fields) addSaveFooter($(id)?.closest('label'), path);
}

function renderNavigation() {
  const wrap = $('navigationEditor'); wrap.replaceChildren();
  const rows = [...(state.config.navigation || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const item of rows) {
    const index = state.config.navigation.indexOf(item); const base = ['navigation', index];
    const row = node('div', 'module-editor nav-row'); toggleRowDisabled(row, item.enabled);
    const enabled = attach(checkbox(item.enabled), item, 'enabled', Boolean); enabled.addEventListener('change', () => { toggleRowDisabled(row, enabled.checked); autoPersistPath([...base,'enabled']); });
    const enabledWrap = node('label', 'checkline'); enabledWrap.append(enabled, document.createTextNode('显示'));
    const labelInput = attach(input(item.label), item, 'label'); labelInput.maxLength = 80;
    const hrefInput = attach(input(item.href), item, 'href'); hrefInput.placeholder = '/path 或 https://...';
    const orderInput = attach(input(item.order, 'number'), item, 'order', Number); orderInput.min = '-9999'; orderInput.max = '9999';
    const remove = button('删除', async () => { state.config.navigation = state.config.navigation.filter((entry) => entry !== item); renderNavigation(); await persistAll({ buttonNode: remove, success: '导航已删除并立即生效。' }); }, 'danger');
    row.append(enabledWrap, savedLabel('名称', labelInput, [...base,'label']), savedLabel('链接', hrefInput, [...base,'href']), savedLabel('顺序', orderInput, [...base,'order']), remove);
    wrap.append(row);
  }
  if (!rows.length) wrap.append(node('div', 'module-empty', '当前没有顶部导航。'));
}

function itemsEditor(grid, module, modulePath, maxItems) {
  const wrap = node('div', 'nested-items');
  (module.items || []).forEach((item, index) => {
    const row = node('div', 'nested-item'); const base = [...modulePath,'items',index];
    textField(row, item, 'title', `项目 ${index + 1} 标题`, { max: 160 }, [...base,'title']);
    textField(row, item, 'body', `项目 ${index + 1} 说明`, { multiline: true, rows: 3, max: 1200 }, [...base,'body']); wrap.append(row);
  });
  const controls = node('div', 'module-controls');
  if ((module.items || []).length < maxItems) controls.append(button('增加项目', async (event) => { const source = event.currentTarget; module.items ||= []; module.items.push({ title: `项目 ${module.items.length + 1}`, body: '' }); renderHomeModules(); await persistAll({ buttonNode: source, success: '项目已新增并立即生效。' }); }));
  if ((module.items || []).length > 1) controls.append(button('删除最后一项', async (event) => { const source = event.currentTarget; module.items.pop(); renderHomeModules(); await persistAll({ buttonNode: source, success: '项目已删除并立即生效。' }); }, 'danger'));
  wrap.append(controls); grid.append(wrap);
}
function renderHomeFields(grid, module, modulePath) {
  const p = (key) => [...modulePath,key];
  if (module.type === 'hero') {
    textField(grid, module, 'badge', '顶部徽标', { wide: true, max: 160 }, p('badge')); textField(grid, module, 'title', '主标题', { multiline: true, rows: 2, max: 300 }, p('title')); textField(grid, module, 'body', '主说明', { wide: true, multiline: true, rows: 7, max: 5000 }, p('body'));
    textField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }, p('primaryLabel')); hrefField(grid, module, 'primaryHref', '主按钮链接', p('primaryHref')); textField(grid, module, 'secondaryLabel', '下载按钮文字', { max: 80 }, p('secondaryLabel')); hrefField(grid, module, 'secondaryHref', '下载按钮链接', p('secondaryHref')); textField(grid, module, 'tertiaryLabel', '第三按钮文字', { max: 80 }, p('tertiaryLabel')); hrefField(grid, module, 'tertiaryHref', '第三按钮链接', p('tertiaryHref'));
    textField(grid, module, 'statusLabel', '状态徽标', { max: 100 }, p('statusLabel')); textField(grid, module, 'modelValue', '锁定模型值', { max: 100 }, p('modelValue')); textField(grid, module, 'modeValue', 'Work 模式值', { max: 100 }, p('modeValue')); textField(grid, module, 'stateValue', '状态值', { max: 100 }, p('stateValue')); textField(grid, module, 'reasoningValue', '推理偏好值', { max: 100 }, p('reasoningValue')); textField(grid, module, 'protectionValue', '异常保护值', { max: 140 }, p('protectionValue')); textField(grid, module, 'noteText', '右侧提示卡', { multiline: true, rows: 2, max: 200 }, p('noteText')); textField(grid, module, 'signalTitle', '右侧信号卡标题', { max: 100 }, p('signalTitle')); textField(grid, module, 'signalText', '右侧信号卡说明', { wide: true, multiline: true, rows: 2, max: 300 }, p('signalText'));
  } else if (module.type === 'features') {
    textField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }, p('title')); textField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }, p('lead')); itemsEditor(grid, module, modulePath, 6);
  } else if (module.type === 'workflow') {
    textField(grid, module, 'title', '模块标题', { multiline: true, rows: 2, max: 300 }, p('title')); textField(grid, module, 'lead', '模块说明', { multiline: true, rows: 3, max: 1200 }, p('lead')); itemsEditor(grid, module, modulePath, 8); textField(grid, module, 'primaryLabel', '主按钮文字', { max: 80 }, p('primaryLabel')); hrefField(grid, module, 'primaryHref', '主按钮链接', p('primaryHref')); textField(grid, module, 'secondaryLabel', '第二按钮文字', { max: 80 }, p('secondaryLabel')); hrefField(grid, module, 'secondaryHref', '第二按钮链接', p('secondaryHref'));
  } else {
    textField(grid, module, 'title', '模块标题', { wide: true, max: 300 }, p('title')); textField(grid, module, 'body', '模块正文', { wide: true, multiline: true, rows: module.type === 'custom' ? 7 : 4, max: module.type === 'custom' ? 5000 : 1200 }, p('body')); textField(grid, module, 'buttonLabel', '按钮文字', { max: 80 }, p('buttonLabel')); hrefField(grid, module, 'buttonHref', '按钮链接', p('buttonHref'));
  }
}
function renderHomeModules() {
  const wrap = $('homeModulesEditor'); wrap.replaceChildren(); const modules = [...(state.config.homeModules || [])].sort((a, b) => Number(a.order) - Number(b.order));
  for (const module of modules) {
    const index = state.config.homeModules.indexOf(module); const base = ['homeModules',index];
    const card = node('article', 'module-editor'); toggleRowDisabled(card, module.enabled);
    const head = node('div', 'module-head'); const title = node('div', 'module-title'); const titleText = node('div'); titleText.append(node('strong', '', module.name || module.id), node('small', '', `${module.type} · ${module.id}`)); title.append(titleText);
    const controls = node('div', 'module-controls'); const enabled = attach(checkbox(module.enabled), module, 'enabled', Boolean); enabled.addEventListener('change', () => { toggleRowDisabled(card, enabled.checked); autoPersistPath([...base,'enabled']); }); const enabledLabel = node('label'); enabledLabel.append(enabled, document.createTextNode('启用'));
    const orderInput = attach(input(module.order, 'number'), module, 'order', Number); controls.append(enabledLabel, savedLabel('顺序', orderInput, [...base,'order']));
    if (module.type === 'custom') controls.append(button('删除模块', async (event) => { const source = event.currentTarget; state.config.homeModules = state.config.homeModules.filter((entry) => entry !== module); renderHomeModules(); await persistAll({ buttonNode: source, success: '自定义模块已删除并立即生效。' }); }, 'danger module-danger'));
    head.append(title, controls); card.append(head); const grid = node('div', 'module-grid'); renderHomeFields(grid, module, base); card.append(grid); wrap.append(card);
  }
}

function renderPageModule(pageKey, module, index) {
  const base = ['pages',pageKey,'modules',index]; const card = node('div', 'module-editor'); toggleRowDisabled(card, module.enabled);
  const head = node('div', 'module-head'); const title = node('div', 'module-title'); title.append(node('strong', '', module.name), node('small', '', module.type === 'protected' ? `受保护功能 · ${module.id}` : `内容模块 · ${module.id}`));
  const controls = node('div', 'module-controls'); const enabled = attach(checkbox(module.enabled), module, 'enabled', Boolean); enabled.addEventListener('change', () => { toggleRowDisabled(card, enabled.checked); autoPersistPath([...base,'enabled']); }); const enabledLabel = node('label'); enabledLabel.append(enabled, document.createTextNode('启用')); controls.append(enabledLabel);
  if (module.lockedOrder) controls.append(node('small', '', '固定顺序')); else { const orderInput = attach(input(module.order, 'number'), module, 'order', Number); controls.append(savedLabel('顺序', orderInput, [...base,'order'])); }
  head.append(title, controls); card.append(head);
  if (module.type === 'protected') card.append(node('p', 'muted', '内部 DOM、表单字段、业务按钮和 API 绑定受保护；CMS 不会修改这些节点。'));
  if (module.type === 'callout') { const grid = node('div', 'module-grid'); textField(grid, module, 'title', '标题', { wide: true, max: 300 }, [...base,'title']); textField(grid, module, 'body', '说明', { wide: true, multiline: true, rows: 4, max: 1600 }, [...base,'body']); textField(grid, module, 'buttonLabel', '按钮文字', { max: 80 }, [...base,'buttonLabel']); hrefField(grid, module, 'buttonHref', '按钮链接', [...base,'buttonHref']); card.append(grid); }
  return card;
}
function renderPages() {
  const wrap = $('pagesEditor'); wrap.replaceChildren();
  for (const [key, page] of Object.entries(state.config.pages || {})) {
    const card = node('article', 'module-editor'); const head = node('div', 'module-head'); const title = node('div', 'module-title'); title.append(node('strong', '', page.name || key), node('small', '', `/${key === 'account' ? 'account' : key}`)); const preview = node('a', 'button-link', '预览 ↗'); preview.href = `/${key}`; preview.target = '_blank'; preview.rel = 'noopener noreferrer'; head.append(title, preview); card.append(head);
    const grid = node('div', 'module-grid'); textField(grid, page, 'browserTitle', '浏览器标题', { max: 160 }, ['pages',key,'browserTitle']); textField(grid, page, 'description', 'SEO 描述', { multiline: true, rows: 3, max: 500, wide: true }, ['pages',key,'description']); textField(grid, page.hero, 'eyebrow', '顶部短标题', { max: 160 }, ['pages',key,'hero','eyebrow']); textField(grid, page.hero, 'title', '页面主标题', { multiline: true, rows: 2, max: 300 }, ['pages',key,'hero','title']); textField(grid, page.hero, 'body', '页面引导说明', { multiline: true, rows: 4, max: 2000, wide: true }, ['pages',key,'hero','body']); card.append(grid);
    const modules = node('div', 'nested-items'); (page.modules || []).forEach((module,index) => modules.append(renderPageModule(key,module,index))); card.append(modules); wrap.append(card);
  }
}

function render() {
  const config = state.config; $('siteBrandName').value = config.site.brandName || ''; $('siteTitle').value = config.site.title || ''; $('siteDescription').value = config.site.description || ''; $('siteFooterText').value = config.site.footerText || ''; $('websiteUpdated').textContent = localDate(state.updatedAt);
  installSiteFieldSaves(); renderNavigation(); renderHomeModules(); renderPages();
}
async function loadWebsite() { const data = await api('/admin/api/website'); state.config = clone(data.config); state.persisted = clone(data.config); state.updatedAt = data.updatedAt; render(); }
async function authenticate() { try { await api('/admin/api/account/dashboard'); $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; await loadWebsite(); } catch (error) { if (error.status === 401) { $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; } else $('loginMessage').textContent = error.message; } }
let resetArmedUntil = 0;
async function resetWebsite() { const reset = $('resetWebsite'); if (Date.now() > resetArmedUntil) { resetArmedUntil = Date.now() + 5000; reset.textContent = '再次点击确认恢复'; setTimeout(() => { if (Date.now() > resetArmedUntil) reset.textContent = '恢复默认'; }, 5100); return; } resetArmedUntil = 0; reset.disabled = true; try { const data = await api('/admin/api/website/reset', { method: 'POST', body: '{}' }); state.config = clone(data.config); state.persisted = clone(data.config); state.updatedAt = data.updatedAt; render(); message('官网已经恢复到系统默认模块配置。', 'good'); } catch (error) { message(error.message, 'bad'); } finally { reset.disabled = false; reset.textContent = '恢复默认'; } }

$('loginButton').addEventListener('click', async () => { try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; $('loginMessage').textContent = ''; await authenticate(); } catch (error) { $('loginMessage').textContent = error.message; } });
$('password').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('loginButton').click(); });
$('logout').addEventListener('click', async () => { await api('/admin/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });
$('saveWebsite').addEventListener('click', () => void persistAll()); $('resetWebsite').addEventListener('click', () => void resetWebsite());
$('addNav').addEventListener('click', async (event) => { const source = event.currentTarget; state.config.navigation ||= []; state.config.navigation.push({ id: `nav-${Date.now().toString(36)}`, label: '新导航', href: '/', enabled: true, order: state.config.navigation.length ? Math.max(...state.config.navigation.map((item) => Number(item.order) || 0)) + 10 : 10, account: false }); renderNavigation(); await persistAll({ buttonNode: source, success: '导航已新增并立即生效。' }); });
$('addCustomModule').addEventListener('click', async (event) => { const source = event.currentTarget; state.config.homeModules ||= []; state.config.homeModules.push({ id: `custom-${Date.now().toString(36)}`, type: 'custom', name: '自定义内容', enabled: true, order: state.config.homeModules.length ? Math.max(...state.config.homeModules.map((item) => Number(item.order) || 0)) + 10 : 10, title: '新的内容模块', body: '在这里填写模块正文。', buttonLabel: '', buttonHref: '/' }); renderHomeModules(); await persistAll({ buttonNode: source, success: '自定义模块已新增并立即生效。' }); });
void authenticate();
