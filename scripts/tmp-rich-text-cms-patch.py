from pathlib import Path
import re, json

ROOT = Path(".")
def read(p): return (ROOT/p).read_text(encoding="utf-8")
def write(p,s):
    path=ROOT/p; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(s, encoding="utf-8")
def rep(s, old, new, label, count=1):
    if s.count(old) < count:
        raise SystemExit(f"missing replacement {label}: found {s.count(old)}")
    return s.replace(old,new,count)
def sub(s, pattern, repl, label, count=1, flags=0):
    out,n = re.subn(pattern,repl,s,count=count,flags=flags)
    if n != count:
        raise SystemExit(f"missing regex {label}: {n}")
    return out

text_style = r"""const FONT_VALUES = new Set(['system','sans','serif','mono','yahei','pingfang','arial','georgia']);
const SIZE_VALUES = new Set([12,14,16,18,20,24,28,32,40,48,56,64,72]);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function color(value) {
  const text = String(value || '').trim();
  return COLOR_RE.test(text) ? text.toLowerCase() : '';
}

export function normalizeTextStyle(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  const font = String(source.font || '').trim().toLowerCase();
  const size = Number(source.size || 0);
  const foreground = color(source.color);
  const background = color(source.background);
  if (FONT_VALUES.has(font)) output.font = font;
  if (SIZE_VALUES.has(size)) output.size = size;
  if (foreground) output.color = foreground;
  if (background) output.background = background;
  if (source.bold === true) output.bold = true;
  if (source.italic === true) output.italic = true;
  if (source.underline === true) output.underline = true;
  return output;
}

export function normalizeTextStyles(input = {}, keys = []) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  for (const key of keys) {
    const style = normalizeTextStyle(source[key]);
    if (Object.keys(style).length) output[key] = style;
  }
  return output;
}
"""
write("license-server/text-style.mjs", text_style)

rich_js = r"""const FONT_OPTIONS = [
  ['', '默认字体'],
  ['system', '系统字体'],
  ['sans', '无衬线'],
  ['serif', '衬线'],
  ['mono', '等宽'],
  ['yahei', '微软雅黑'],
  ['pingfang', '苹方'],
  ['arial', 'Arial'],
  ['georgia', 'Georgia'],
];
const FONT_STACKS = {
  system: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  pingfang: '"PingFang SC", "Microsoft YaHei", sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
};
const SIZE_VALUES = [12,14,16,18,20,24,28,32,40,48,56,64,72];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const STYLE_PROPS = ['font-family','font-size','color','background-color','font-weight','font-style','text-decoration-line'];

function safeColor(value) {
  const text = String(value || '').trim();
  return COLOR_RE.test(text) ? text.toLowerCase() : '';
}
export function normalizeTextStyle(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  const font = String(source.font || '').trim().toLowerCase();
  const size = Number(source.size || 0);
  const color = safeColor(source.color);
  const background = safeColor(source.background);
  if (Object.hasOwn(FONT_STACKS, font)) output.font = font;
  if (SIZE_VALUES.includes(size)) output.size = size;
  if (color) output.color = color;
  if (background) output.background = background;
  if (source.bold === true) output.bold = true;
  if (source.italic === true) output.italic = true;
  if (source.underline === true) output.underline = true;
  return output;
}
export function applyTextStyle(target, input = {}) {
  if (!target) return;
  const style = normalizeTextStyle(input);
  for (const property of STYLE_PROPS) target.style.removeProperty(property);
  if (style.font) target.style.fontFamily = FONT_STACKS[style.font];
  if (style.size) target.style.fontSize = `${style.size}px`;
  if (style.color) target.style.color = style.color;
  if (style.background) target.style.backgroundColor = style.background;
  if (style.bold) target.style.fontWeight = '800';
  if (style.italic) target.style.fontStyle = 'italic';
  if (style.underline) target.style.textDecorationLine = 'underline';
}
function option(value, label) {
  const item = document.createElement('option');
  item.value = value; item.textContent = label; return item;
}
function smallButton(label, title) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'cms-style-toggle'; button.textContent = label; button.title = title; return button;
}
export function createTextStyleToolbar({ control, value = {}, onChange } = {}) {
  let current = normalizeTextStyle(value);
  const bar = document.createElement('span'); bar.className = 'cms-style-toolbar'; bar.setAttribute('aria-label', '文本样式编辑器');
  const font = document.createElement('select'); font.className = 'cms-style-select cms-style-font'; font.title = '字体';
  for (const [key, label] of FONT_OPTIONS) font.append(option(key, label)); font.value = current.font || '';
  const size = document.createElement('select'); size.className = 'cms-style-select cms-style-size'; size.title = '字号';
  size.append(option('', '默认字号')); for (const value of SIZE_VALUES) size.append(option(String(value), `${value}px`)); size.value = current.size ? String(current.size) : '';
  const bold = smallButton('B', '加粗'); const italic = smallButton('I', '斜体'); const underline = smallButton('U', '下划线');
  const colorLabel = document.createElement('label'); colorLabel.className = 'cms-style-color'; colorLabel.title = '文字颜色'; colorLabel.append(document.createTextNode('字'));
  const color = document.createElement('input'); color.type = 'color'; color.value = current.color || '#17201d'; color.setAttribute('aria-label', '文字颜色'); colorLabel.append(color);
  const clearColor = smallButton('×', '恢复默认文字颜色');
  const bgLabel = document.createElement('label'); bgLabel.className = 'cms-style-color'; bgLabel.title = '背景色'; bgLabel.append(document.createTextNode('底'));
  const background = document.createElement('input'); background.type = 'color'; background.value = current.background || '#ffffff'; background.setAttribute('aria-label', '背景色'); bgLabel.append(background);
  const clearBackground = smallButton('×', '清除背景色');
  const reset = smallButton('清除格式', '恢复该字段默认样式');

  const sync = () => {
    bold.classList.toggle('active', Boolean(current.bold));
    italic.classList.toggle('active', Boolean(current.italic));
    underline.classList.toggle('active', Boolean(current.underline));
    font.value = current.font || '';
    size.value = current.size ? String(current.size) : '';
    color.value = current.color || '#17201d';
    background.value = current.background || '#ffffff';
    applyTextStyle(control, current);
  };
  const change = (patch) => {
    current = normalizeTextStyle({ ...current, ...patch });
    sync();
    onChange?.({ ...current });
  };
  font.addEventListener('change', () => change({ font: font.value || undefined }));
  size.addEventListener('change', () => change({ size: size.value ? Number(size.value) : undefined }));
  bold.addEventListener('click', () => change({ bold: !current.bold }));
  italic.addEventListener('click', () => change({ italic: !current.italic }));
  underline.addEventListener('click', () => change({ underline: !current.underline }));
  color.addEventListener('input', () => change({ color: color.value }));
  background.addEventListener('input', () => change({ background: background.value }));
  clearColor.addEventListener('click', () => { const next = { ...current }; delete next.color; current = normalizeTextStyle(next); sync(); onChange?.({ ...current }); });
  clearBackground.addEventListener('click', () => { const next = { ...current }; delete next.background; current = normalizeTextStyle(next); sync(); onChange?.({ ...current }); });
  reset.addEventListener('click', () => { current = {}; sync(); onChange?.({}); });
  bar.append(font, size, bold, italic, underline, colorLabel, clearColor, bgLabel, clearBackground, reset);
  sync();
  return bar;
}
"""
write("license-server/public/rich-text-style.js", rich_js)

p = Path("license-server/website-system.mjs"); s=p.read_text()
s = rep(s, "import { createLegalContentSystem } from './legal-content-system.mjs';\n", "import { createLegalContentSystem } from './legal-content-system.mjs';\nimport { normalizeTextStyles } from './text-style.mjs';\n", "website import")
s = rep(s, "  schemaVersion: 2,\n", "  schemaVersion: 3,\n", "default schema")
old = "function normalizeItems(value, defaults, maxItems = 8) { const source = Array.isArray(value) ? value : defaults; return source.slice(0, maxItems).map((item, index) => ({ title: text(item?.title, defaults[index]?.title || `项目 ${index + 1}`, 160), body: text(item?.body, defaults[index]?.body || '', 1200) })); }"
new = "function normalizeItems(value, defaults, maxItems = 8) { const source = Array.isArray(value) ? value : defaults; return source.slice(0, maxItems).map((item, index) => ({ title: text(item?.title, defaults[index]?.title || `项目 ${index + 1}`, 160), body: text(item?.body, defaults[index]?.body || '', 1200), styles: normalizeTextStyles(item?.styles, ['title','body']) })); }"
s=rep(s,old,new,"normalize items")
repls = [
("  if (type === 'hero') return { ...common, badge: text(raw?.badge, base.badge, 160), title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 5000), primaryLabel: text(raw?.primaryLabel, base.primaryLabel, 80), primaryHref: safeHref(raw?.primaryHref, base.primaryHref), secondaryLabel: text(raw?.secondaryLabel, base.secondaryLabel, 80), secondaryHref: safeHref(raw?.secondaryHref, base.secondaryHref), tertiaryLabel: text(raw?.tertiaryLabel, base.tertiaryLabel, 80), tertiaryHref: safeHref(raw?.tertiaryHref, base.tertiaryHref), statusLabel: text(raw?.statusLabel, base.statusLabel, 100), modeLabel: text(raw?.modeLabel, base.modeLabel, 80), modeValue: text(raw?.modeValue, base.modeValue, 100), stateLabel: text(raw?.stateLabel, base.stateLabel, 80), stateValue: text(raw?.stateValue, base.stateValue, 100), modelLabel: text(raw?.modelLabel, base.modelLabel, 80), modelValue: text(raw?.modelValue, base.modelValue, 100), reasoningLabel: text(raw?.reasoningLabel, base.reasoningLabel, 80), reasoningValue: text(raw?.reasoningValue, base.reasoningValue, 100), protectionLabel: text(raw?.protectionLabel, base.protectionLabel, 80), protectionValue: text(raw?.protectionValue, base.protectionValue, 140), noteText: text(raw?.noteText, base.noteText, 200), signalTitle: text(raw?.signalTitle, base.signalTitle, 100), signalText: text(raw?.signalText, base.signalText, 300) };",
"  if (type === 'hero') return { ...common, badge: text(raw?.badge, base.badge, 160), title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 5000), primaryLabel: text(raw?.primaryLabel, base.primaryLabel, 80), primaryHref: safeHref(raw?.primaryHref, base.primaryHref), secondaryLabel: text(raw?.secondaryLabel, base.secondaryLabel, 80), secondaryHref: safeHref(raw?.secondaryHref, base.secondaryHref), tertiaryLabel: text(raw?.tertiaryLabel, base.tertiaryLabel, 80), tertiaryHref: safeHref(raw?.tertiaryHref, base.tertiaryHref), statusLabel: text(raw?.statusLabel, base.statusLabel, 100), modeLabel: text(raw?.modeLabel, base.modeLabel, 80), modeValue: text(raw?.modeValue, base.modeValue, 100), stateLabel: text(raw?.stateLabel, base.stateLabel, 80), stateValue: text(raw?.stateValue, base.stateValue, 100), modelLabel: text(raw?.modelLabel, base.modelLabel, 80), modelValue: text(raw?.modelValue, base.modelValue, 100), reasoningLabel: text(raw?.reasoningLabel, base.reasoningLabel, 80), reasoningValue: text(raw?.reasoningValue, base.reasoningValue, 100), protectionLabel: text(raw?.protectionLabel, base.protectionLabel, 80), protectionValue: text(raw?.protectionValue, base.protectionValue, 140), noteText: text(raw?.noteText, base.noteText, 200), signalTitle: text(raw?.signalTitle, base.signalTitle, 100), signalText: text(raw?.signalText, base.signalText, 300), styles: normalizeTextStyles(raw?.styles, ['badge','title','body','primaryLabel','secondaryLabel','tertiaryLabel','statusLabel','modeLabel','modeValue','stateLabel','stateValue','modelLabel','modelValue','reasoningLabel','reasoningValue','protectionLabel','protectionValue','noteText','signalTitle','signalText']) };"),
("  if (type === 'features') return { ...common, title: text(raw?.title, base.title, 300), lead: text(raw?.lead, base.lead, 1200), items: normalizeItems(raw?.items, base.items, 6) };",
"  if (type === 'features') return { ...common, title: text(raw?.title, base.title, 300), lead: text(raw?.lead, base.lead, 1200), items: normalizeItems(raw?.items, base.items, 6), styles: normalizeTextStyles(raw?.styles, ['title','lead']) };"),
("  if (type === 'workflow') return { ...common, title: text(raw?.title, base.title, 300), lead: text(raw?.lead, base.lead, 1200), items: normalizeItems(raw?.items, base.items, 8), primaryLabel: text(raw?.primaryLabel, base.primaryLabel, 80), primaryHref: safeHref(raw?.primaryHref, base.primaryHref), secondaryLabel: text(raw?.secondaryLabel, base.secondaryLabel, 80), secondaryHref: safeHref(raw?.secondaryHref, base.secondaryHref) };",
"  if (type === 'workflow') return { ...common, title: text(raw?.title, base.title, 300), lead: text(raw?.lead, base.lead, 1200), items: normalizeItems(raw?.items, base.items, 8), primaryLabel: text(raw?.primaryLabel, base.primaryLabel, 80), primaryHref: safeHref(raw?.primaryHref, base.primaryHref), secondaryLabel: text(raw?.secondaryLabel, base.secondaryLabel, 80), secondaryHref: safeHref(raw?.secondaryHref, base.secondaryHref), styles: normalizeTextStyles(raw?.styles, ['title','lead','primaryLabel','secondaryLabel']) };"),
("  if (type === 'callout') return { ...common, title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 1200), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref) };",
"  if (type === 'callout') return { ...common, title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 1200), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref), styles: normalizeTextStyles(raw?.styles, ['title','body','buttonLabel']) };"),
("  return { ...common, type: 'custom', title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 5000), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref) };",
"  return { ...common, type: 'custom', title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 5000), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref), styles: normalizeTextStyles(raw?.styles, ['title','body','buttonLabel']) };")]
for i,(a,b) in enumerate(repls): s=rep(s,a,b,f"home return {i}")
s=rep(s,
"  if (base.type === 'callout') return { ...common, title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 1600), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref) };",
"  if (base.type === 'callout') return { ...common, title: text(raw?.title, base.title, 300), body: text(raw?.body, base.body, 1600), buttonLabel: text(raw?.buttonLabel, base.buttonLabel, 80), buttonHref: safeHref(raw?.buttonHref, base.buttonHref), styles: normalizeTextStyles(raw?.styles, ['title','body','buttonLabel']) };",
"page module styles")
s=rep(s,
"    hero: { eyebrow: text(hero.eyebrow, defaults.hero.eyebrow, 160), title: text(hero.title, defaults.hero.title, 300), body: text(hero.body, defaults.hero.body, 2000) },",
"    hero: { eyebrow: text(hero.eyebrow, defaults.hero.eyebrow, 160), title: text(hero.title, defaults.hero.title, 300), body: text(hero.body, defaults.hero.body, 2000), styles: normalizeTextStyles(hero.styles, ['eyebrow','title','body']) },",
"page hero styles")
s=rep(s,
"account: bool(item?.account, fallback.account || false) }; });",
"account: bool(item?.account, fallback.account || false), styles: normalizeTextStyles(item?.styles, ['label']) }; });",
"navigation styles")
s=rep(s,
"  return { schemaVersion: 2, site: { brandName: text(site.brandName, defaults.site.brandName, 80), title: text(site.title, defaults.site.title, 160), description: text(site.description, defaults.site.description, 500), footerText: text(site.footerText, defaults.site.footerText, 160) }, navigation, homeModules: modules, pages };",
"  return { schemaVersion: 3, site: { brandName: text(site.brandName, defaults.site.brandName, 80), title: text(site.title, defaults.site.title, 160), description: text(site.description, defaults.site.description, 500), footerText: text(site.footerText, defaults.site.footerText, 160), styles: normalizeTextStyles(site.styles, ['brandName','footerText']) }, navigation, homeModules: modules, pages };",
"normalize return")
p.write_text(s)

p=Path("license-server/legal-content-system.mjs"); s=p.read_text()
if not s.startswith("import "):
    s = "import { normalizeTextStyles } from './text-style.mjs';\n\n" + s
else:
    raise SystemExit("unexpected legal imports")
s=rep(s,
"    lastUpdated: text(input.lastUpdated, base.lastUpdated, 40), content: text(input.content, base.content, 45_000),\n",
"    lastUpdated: text(input.lastUpdated, base.lastUpdated, 40), content: text(input.content, base.content, 45_000),\n    styles: normalizeTextStyles(input.styles, ['eyebrow','title','subtitle','content']),\n",
"legal styles")
p.write_text(s)

p=Path("license-server/server.mjs"); s=p.read_text()
s=rep(s, "style-src 'self'; connect-src 'self';", "style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self';", "csp style attrs")
s=rep(s, "    if (url.pathname === '/site.js') return staticFile(res, join(PUBLIC,'site.js'));\n", "    if (url.pathname === '/site.js') return staticFile(res, join(PUBLIC,'site.js'));\n    if (url.pathname === '/rich-text-style.js') return staticFile(res, join(PUBLIC,'rich-text-style.js'));\n", "rich route")
p.write_text(s)

p=Path("license-server/package.json"); s=p.read_text()
s=rep(s, "node --check legal-content-system.mjs && node --check website-system.mjs", "node --check legal-content-system.mjs && node --check text-style.mjs && node --check website-system.mjs", "check server helper")
s=rep(s, "node --check public/site.js && node --check public/page-cms.js", "node --check public/site.js && node --check public/rich-text-style.js && node --check public/page-cms.js", "check browser helper")
p.write_text(s)

p=Path("license-server/public/admin-website.js"); s=p.read_text()
s = "import { createTextStyleToolbar } from '/rich-text-style.js';\n" + s
s=rep(s,
"function setAt(root, path, value) { let target = root; for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]]; target[path.at(-1)] = clone(value); }",
"function setAt(root, path, value) { let target = root; for (let index = 0; index < path.length - 1; index += 1) { const key = path[index]; if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {}; target = target[key]; } target[path.at(-1)] = clone(value); }",
"setAt create")
s=rep(s,
"function savedTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }\n",
"""function savedTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
function textStylePath(path, key = path.at(-1)) { return [...path.slice(0, -1), 'styles', key]; }
function ensureFieldStyle(object, key) { object.styles ||= {}; object.styles[key] ||= {}; return object.styles[key]; }
function installTextStyleEditor(wrap, control, object, key, path) {
  if (!wrap || !control || !object) return null;
  wrap.querySelector(':scope > .cms-style-toolbar')?.remove(); wrap.classList.add('has-rich-style');
  const targetPath = textStylePath(path, key); const style = ensureFieldStyle(object, key);
  const toolbar = createTextStyleToolbar({ control, value: style, onChange: (next) => { object.styles[key] = next; } });
  wrap.insertBefore(toolbar, control); return targetPath;
}
""",
"admin style helpers")
pattern=r"function addSaveFooter\(wrap, path\) \{.*?\nfunction hrefField"
replacement="""function addSaveFooter(wrap, path, extraPaths = []) {
  if (!wrap) return wrap;
  wrap.querySelector(':scope > .cms-field-footer')?.remove(); wrap.dataset.fieldSaveReady = '1'; wrap.classList.add('cms-field');
  const footer = node('span', 'cms-field-footer'); const status = node('small', 'cms-field-status');
  const save = button('保存', () => void persistPath(path, save, status, extraPaths), 'cms-field-save');
  footer.append(status, save); wrap.append(footer); return wrap;
}
function savedLabel(title, control, path, options = {}) {
  const wrap = label(title, control); if (options.wide) wrap.classList.add('wide'); const extraPaths = [];
  if (options.rich && options.object && options.key) { const stylePath = installTextStyleEditor(wrap, control, options.object, options.key, path); if (stylePath) extraPaths.push(stylePath); }
  addSaveFooter(wrap, path, extraPaths); return wrap;
}
function textField(grid, object, key, title, options = {}, path) {
  const control = options.multiline ? textarea(object[key], options.rows || 4) : input(object[key]); if (options.max) control.maxLength = options.max; attach(control, object, key);
  grid.append(savedLabel(title, control, path, { wide: options.wide, rich: options.rich !== false, object, key })); return control;
}
function hrefField"""
s=sub(s,pattern,replacement,"admin footer block",flags=re.S)
pattern=r"async function persistPath\(path, saveButton, statusNode\) \{.*?\n\}\nasync function persistAll"
replacement="""async function persistPath(path, saveButton, statusNode, extraPaths = []) {
  if (!state.config || !state.persisted) return;
  collectSite(); const next = clone(state.persisted); const paths = [path, ...extraPaths];
  for (const fieldPath of paths) setAt(next, fieldPath, getAt(state.config, fieldPath));
  const original = saveButton?.textContent || '保存'; if (saveButton) { saveButton.disabled = true; saveButton.textContent = '保存中…'; }
  if (statusNode) statusNode.textContent = '正在保存';
  try {
    const data = await api('/admin/api/website', { method: 'PUT', body: JSON.stringify({ config: next }) });
    state.persisted = clone(data.config); for (const fieldPath of paths) setAt(state.config, fieldPath, getAt(data.config, fieldPath)); updateSavedStamp(data);
    if (statusNode) statusNode.textContent = `已保存 ${savedTime()}`;
    message('该字段及文本样式已保存并立即在官网生效。', 'good');
  } catch (error) {
    if (statusNode) statusNode.textContent = '保存失败'; message(error.message, 'bad');
  } finally {
    if (saveButton) { saveButton.disabled = false; saveButton.textContent = original; }
  }
}
async function persistAll"""
s=sub(s,pattern,replacement,"persistPath",flags=re.S)
pattern=r"function installSiteFieldSaves\(\) \{.*?\n\}\n\nfunction renderNavigation"
replacement="""function installSiteFieldSaves() {
  const fields = [
    ['siteBrandName', ['site','brandName'], true], ['siteTitle', ['site','title'], false], ['siteDescription', ['site','description'], false], ['siteFooterText', ['site','footerText'], true],
  ];
  for (const [id, path, rich] of fields) {
    const control = $(id); const wrap = control?.closest('label'); if (!control || !wrap) continue; wrap.querySelector(':scope > .cms-style-toolbar')?.remove(); wrap.querySelector(':scope > .cms-field-footer')?.remove(); wrap.classList.remove('has-rich-style');
    const extraPaths = []; if (rich) { const object = getAt(state.config, path.slice(0, -1)); const stylePath = installTextStyleEditor(wrap, control, object, path.at(-1), path); if (stylePath) extraPaths.push(stylePath); }
    addSaveFooter(wrap, path, extraPaths);
  }
}

function renderNavigation"""
s=sub(s,pattern,replacement,"site field saves",flags=re.S)
s=rep(s,
"    row.append(enabledWrap, savedLabel('名称', labelInput, [...base,'label']), savedLabel('链接', hrefInput, [...base,'href']), savedLabel('顺序', orderInput, [...base,'order']), remove);",
"    row.append(enabledWrap, savedLabel('名称', labelInput, [...base,'label'], { rich: true, object: item, key: 'label' }), savedLabel('链接', hrefInput, [...base,'href']), savedLabel('顺序', orderInput, [...base,'order']), remove);",
"nav rich")
s=rep(s,
"textField(grid, page, 'browserTitle', '浏览器标题', { max: 160 }, ['pages',key,'browserTitle']); textField(grid, page, 'description', 'SEO 描述', { multiline: true, rows: 3, max: 500, wide: true }, ['pages',key,'description']);",
"textField(grid, page, 'browserTitle', '浏览器标题', { max: 160, rich: false }, ['pages',key,'browserTitle']); textField(grid, page, 'description', 'SEO 描述', { multiline: true, rows: 3, max: 500, wide: true, rich: false }, ['pages',key,'description']);",
"page meta nonrich")
p.write_text(s)

p=Path("license-server/public/admin-website.css"); s=p.read_text()
s += r"""
.cms-style-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 7px;padding:6px 8px;border:1px solid var(--line);border-radius:9px;background:rgba(248,250,252,.92);width:max-content;max-width:100%}.cms-style-select{min-height:30px!important;width:auto!important;max-width:150px!important;padding:3px 7px!important;border-radius:7px!important;font-size:12px!important}.cms-style-size{max-width:92px!important}.cms-style-toggle{min-height:30px!important;padding:3px 9px!important;border-radius:7px!important;font-size:12px!important;font-weight:700!important}.cms-style-toggle.active{background:#17201d!important;border-color:#17201d!important;color:#fff!important}.cms-style-color{display:inline-flex!important;align-items:center!important;gap:4px!important;margin:0!important;font-size:12px!important;color:var(--muted)}.cms-style-color input[type=color]{width:30px!important;height:26px!important;min-height:26px!important;padding:1px!important;border-radius:6px!important;cursor:pointer}.cms-field.has-rich-style:not(:has(textarea))>.cms-style-toolbar{grid-column:1/-1;grid-row:2}.cms-field.has-rich-style:not(:has(textarea))>input,.cms-field.has-rich-style:not(:has(textarea))>select:not(.cms-style-select){grid-row:3}.cms-field.has-rich-style:not(:has(textarea))>.cms-field-footer{grid-row:3}.cms-field:has(textarea)>.cms-style-toolbar{order:0;align-self:flex-start}.cms-field:has(textarea)>textarea{order:1}.cms-field:has(textarea)>.website-help{order:2}.cms-field:has(textarea)>.cms-field-footer{order:3}
"""
p.write_text(s)

p=Path("license-server/public/admin-website.html"); s=p.read_text()
s=rep(s,
"单行输入框的绿色“保存”位于输入框右侧；多行输入框的绿色“保存”位于输入框内部右下角。点击只保存该字段并立即在官网生效，其它未保存编辑不会一起发布。“全部保存并发布”用于一次性提交当前页面全部修改。",
"所有前台可见文本字段都带简易样式工具栏，可设置字体、字号、文字颜色、背景色、加粗、斜体和下划线；样式作用于当前字段整段文本。单行输入框绿色“保存”位于右侧，多行输入框绿色“保存”位于内部右下角。点击只保存该字段及其样式并立即生效，其它未保存编辑不会一起发布。",
"toolbar help")
s=rep(s,
"文本和顺序使用各字段自己的绿色保存按钮；模块启停、添加和删除会自动保存并立即生效。",
"前台文本字段可直接设置字体、字号、颜色、背景色、加粗、斜体和下划线，并使用各字段自己的绿色保存按钮立即发布；模块启停、添加和删除会自动保存。",
"home help")
s=rep(s,
"隐私政策、服务条款和数据删除说明同样使用字段级保存：单行字段右侧保存，多行字段输入框内部右下角保存。保存后直接生成新的法律版本并公开生效，其它未保存字段不会被顺带发布。版本历史与安全回滚仍保留。",
"隐私政策、服务条款和数据删除说明的前台可见字段同样带安全文本样式工具栏；保存后直接生成新的法律版本并公开生效。浏览器标题和 SEO 描述保持纯文本。版本历史与安全回滚仍保留。",
"legal help")
p.write_text(s)

p=Path("license-server/public/site.js"); s=p.read_text()
s = "let cmsRichText = null;\nconst cmsRichTextPromise = import('/rich-text-style.js').catch(() => null);\n" + s
s=rep(s,
"""function cmsText(target, value) {
  if (!target || value === undefined || value === null) return;
  target.textContent = String(value);
  if (String(value).includes('\\n')) target.style.whiteSpace = 'pre-line';
}
function cmsLink(target, label, href) {
  if (!target) return;
  cmsText(target, label || '');
  if (href) target.href = href;
  target.hidden = !label;
}""",
"""function cmsText(target, value, style = {}) {
  if (!target || value === undefined || value === null) return;
  target.textContent = String(value);
  if (String(value).includes('\\n')) target.style.whiteSpace = 'pre-line';
  cmsRichText?.applyTextStyle(target, style);
}
function cmsNode(tag, className, value, style = {}) { const el = node(tag, className, value); cmsRichText?.applyTextStyle(el, style); return el; }
function cmsLink(target, label, href, style = {}) {
  if (!target) return;
  cmsText(target, label || '', style);
  if (href) target.href = href;
  target.hidden = !label;
}""",
"site cmsText")
old="""function applyGlobalWebsiteConfig(config) {
  const site = config.site || {};
  const brand = document.querySelector('.site-header .brand > span:last-child'); if (brand && site.brandName) brand.textContent = site.brandName;
  const footer = document.querySelector('.site-footer .footer-row > span'); if (footer && site.footerText) footer.textContent = site.footerText;
"""
new="""function applyGlobalWebsiteConfig(config) {
  const site = config.site || {};
  const brand = document.querySelector('.site-header .brand > span:last-child'); if (brand && site.brandName) cmsText(brand, site.brandName, site.styles?.brandName);
  const footer = document.querySelector('.site-footer .footer-row > span'); if (footer && site.footerText) cmsText(footer, site.footerText, site.styles?.footerText);
"""
s=rep(s,old,new,"site global top")
s=rep(s,
"      const link = node('a', item.account ? 'nav-account' : '', item.label || '链接'); decorateLink(link, item); nav.append(link);",
"      const link = cmsNode('a', item.account ? 'nav-account' : '', item.label || '链接', item.styles?.label); decorateLink(link, item); nav.append(link);",
"site nav styled")
s=rep(s,
"    for (const item of merged) { const link = node('a', '', item.label || '链接'); decorateLink(link, item); footerLinks.append(link); }",
"    for (const item of merged) { const link = cmsNode('a', '', item.label || '链接', item.styles?.label); decorateLink(link, item); footerLinks.append(link); }",
"footer nav styled")
pattern=r"function applyHero\(section, module\) \{.*?\n\}\nfunction applyFeatures"
replacement="""function applyHero(section, module) {
  const badge = section.querySelector('#latestBadge'); const customBadge = String(module.badge || '').trim();
  if (badge) {
    delete badge.dataset.cmsOverride;
    if (customBadge && customBadge !== LEGACY_AUTO_RELEASE_BADGE) { cmsText(badge, customBadge, module.styles?.badge); badge.dataset.cmsOverride = '1'; }
    else cmsRichText?.applyTextStyle(badge, module.styles?.badge);
  }
  cmsText(section.querySelector('h1'), module.title, module.styles?.title); cmsText(section.querySelector('.hero-copy'), module.body, module.styles?.body);
  const actions = section.querySelectorAll('.hero-actions a'); cmsLink(actions[0], module.primaryLabel, module.primaryHref, module.styles?.primaryLabel); cmsLink(actions[1], module.secondaryLabel, module.secondaryHref, module.styles?.secondaryLabel); cmsLink(actions[2], module.tertiaryLabel, module.tertiaryHref, module.styles?.tertiaryLabel);
  cmsText(section.querySelector('.status-pill'), module.statusLabel, module.styles?.statusLabel);
  const labels = section.querySelectorAll('.lock-label'); const values = section.querySelectorAll('.lock-value');
  const labelValues = [module.modeLabel, module.stateLabel, module.modelLabel, module.reasoningLabel, module.protectionLabel];
  const labelStyles = [module.styles?.modeLabel, module.styles?.stateLabel, module.styles?.modelLabel, module.styles?.reasoningLabel, module.styles?.protectionLabel];
  const stateValues = [module.modeValue, module.stateValue, module.modelValue, module.reasoningValue, module.protectionValue];
  const stateStyles = [module.styles?.modeValue, module.styles?.stateValue, module.styles?.modelValue, module.styles?.reasoningValue, module.styles?.protectionValue];
  labels.forEach((item, index) => cmsText(item, labelValues[index], labelStyles[index])); values.forEach((item, index) => cmsText(item, stateValues[index], stateStyles[index]));
  cmsText(section.querySelector('.hero-card.note'), module.noteText, module.styles?.noteText);
  const signal = section.querySelector('.hero-card.signal'); if (signal) { cmsText(signal.querySelector('b'), module.signalTitle, module.styles?.signalTitle); cmsText(signal.querySelector('small'), module.signalText, module.styles?.signalText); }
}
function applyFeatures"""
s=sub(s,pattern,replacement,"applyHero",flags=re.S)
pattern=r"function applyFeatures\(section, module\) \{.*?\n\}\nfunction workflowNode"
replacement="""function applyFeatures(section, module) {
  cmsText(section.querySelector('.section-head h2'), module.title, module.styles?.title); cmsText(section.querySelector('.section-head p'), module.lead, module.styles?.lead);
  const grid = section.querySelector('.grid-3'); if (!grid) return; grid.replaceChildren();
  (module.items || []).forEach((item, index) => { const card = node('article', 'feature-card'); card.append(node('div', 'feature-icon', String(index + 1).padStart(2, '0')), cmsNode('h3', '', item.title || '', item.styles?.title), cmsNode('p', '', item.body || '', item.styles?.body)); grid.append(card); });
}
function workflowNode"""
s=sub(s,pattern,replacement,"features",flags=re.S)
s=rep(s,
"  const mapNode = node('div', `map-node${accents[index] ? ` ${accents[index]}` : ''}`); mapNode.append(node('b', '', item.title || ''), node('span', '', item.body || '')); return mapNode;",
"  const mapNode = node('div', `map-node${accents[index] ? ` ${accents[index]}` : ''}`); mapNode.append(cmsNode('b', '', item.title || '', item.styles?.title), cmsNode('span', '', item.body || '', item.styles?.body)); return mapNode;",
"workflow node")
s=rep(s,
"  cmsText(section.querySelector('.section-head h2'), module.title); cmsText(section.querySelector('.section-head p'), module.lead);",
"  cmsText(section.querySelector('.section-head h2'), module.title, module.styles?.title); cmsText(section.querySelector('.section-head p'), module.lead, module.styles?.lead);",
"workflow heading")
s=rep(s,
"  const actions = section.querySelectorAll('.hero-actions a'); cmsLink(actions[0], module.primaryLabel, module.primaryHref); cmsLink(actions[1], module.secondaryLabel, module.secondaryHref);",
"  const actions = section.querySelectorAll('.hero-actions a'); cmsLink(actions[0], module.primaryLabel, module.primaryHref, module.styles?.primaryLabel); cmsLink(actions[1], module.secondaryLabel, module.secondaryHref, module.styles?.secondaryLabel);",
"workflow buttons")
s=rep(s,
"function applyCallout(section, module) { cmsText(section.querySelector('h2'), module.title); cmsText(section.querySelector('p'), module.body); cmsLink(section.querySelector('a.btn'), module.buttonLabel, module.buttonHref); }",
"function applyCallout(section, module) { cmsText(section.querySelector('h2'), module.title, module.styles?.title); cmsText(section.querySelector('p'), module.body, module.styles?.body); cmsLink(section.querySelector('a.btn'), module.buttonLabel, module.buttonHref, module.styles?.buttonLabel); }",
"callout")
old="""  const shell = node('div', 'shell'); const head = node('div', 'section-head'); const left = node('div'); const title = node('h2', '', module.title || ''); const body = node('p', '', module.body || ''); title.style.whiteSpace = 'pre-line'; body.style.whiteSpace = 'pre-line'; left.append(title, body); head.append(left); shell.append(head);
  if (module.buttonLabel) { const actions = node('div', 'hero-actions'); const link = node('a', 'btn btn-primary', module.buttonLabel); link.href = module.buttonHref || '/'; actions.append(link); shell.append(actions); }
"""
new="""  const shell = node('div', 'shell'); const head = node('div', 'section-head'); const left = node('div'); const title = cmsNode('h2', '', module.title || '', module.styles?.title); const body = cmsNode('p', '', module.body || '', module.styles?.body); title.style.whiteSpace = 'pre-line'; body.style.whiteSpace = 'pre-line'; left.append(title, body); head.append(left); shell.append(head);
  if (module.buttonLabel) { const actions = node('div', 'hero-actions'); const link = cmsNode('a', 'btn btn-primary', module.buttonLabel, module.styles?.buttonLabel); link.href = module.buttonHref || '/'; actions.append(link); shell.append(actions); }
"""
s=rep(s,old,new,"custom style")
s=rep(s,
"""async function loadWebsiteConfig() {
  const data = await api('/site/api/website');
""",
"""async function loadWebsiteConfig() {
  cmsRichText = await cmsRichTextPromise;
  const data = await api('/site/api/website');
""",
"load rich")
p.write_text(s)

p=Path("license-server/public/page-cms.js"); s=p.read_text()
s = "const cmsRichTextPromise = import('/rich-text-style.js').catch(() => null);\n\n" + s
s=rep(s,
"  function setText(node, value) { if (!node || value === undefined || value === null) return; node.textContent = String(value); node.style.whiteSpace = 'pre-line'; }",
"  let richText = null;\n  function setText(node, value, style = {}) { if (!node || value === undefined || value === null) return; node.textContent = String(value); node.style.whiteSpace = 'pre-line'; richText?.applyTextStyle(node, style); }",
"page setText")
s=rep(s,
"  async function loadLegal() {\n    const response = await fetch",
"  async function loadLegal() {\n    richText = await cmsRichTextPromise;\n    const response = await fetch",
"load legal rich")
old="""    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = doc.eyebrow || '';
    const h1 = document.createElement('h1'); h1.textContent = doc.title || '';
    if (doc.subtitle) { h1.append(document.createElement('br')); const small = document.createElement('small'); small.textContent = doc.subtitle; h1.append(small); }
"""
new="""    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; setText(eyebrow, doc.eyebrow || '', doc.styles?.eyebrow);
    const h1 = document.createElement('h1'); const titleText = document.createElement('span'); setText(titleText, doc.title || '', doc.styles?.title); h1.append(titleText);
    if (doc.subtitle) { h1.append(document.createElement('br')); const small = document.createElement('small'); setText(small, doc.subtitle, doc.styles?.subtitle); h1.append(small); }
"""
s=rep(s,old,new,"legal heading")
s=rep(s,
"    const body = document.createElement('div'); body.dataset.legalPublishedVersion = String(data.version || 0); renderLegalMarkdown(body, doc.content || '');",
"    const body = document.createElement('div'); body.dataset.legalPublishedVersion = String(data.version || 0); renderLegalMarkdown(body, doc.content || ''); richText?.applyTextStyle(body, doc.styles?.content);",
"legal body style")
s=rep(s,
"  async function loadOperational() {\n    const response = await fetch",
"  async function loadOperational() {\n    richText = await cmsRichTextPromise;\n    const response = await fetch",
"load op rich")
s=rep(s,
"    const root = heroRoot(); if (!root) return; setText(qs('.eyebrow', root), hero.eyebrow); const h1 = qs('h1', root); if (h1 && hero.title) setText(h1, hero.title);",
"    const root = heroRoot(); if (!root) return; setText(qs('.eyebrow', root), hero.eyebrow, hero.styles?.eyebrow); const h1 = qs('h1', root); if (h1 && hero.title) setText(h1, hero.title, hero.styles?.title);",
"op hero title")
s=rep(s,
"if (body && hero.body) setText(body, hero.body);",
"if (body && hero.body) setText(body, hero.body, hero.styles?.body);",
"op hero body")
s=rep(s,
"  function applyCallout(target, module) { if (!target) return; setText(qs('h2', target), module.title); setText(qs('p', target), module.body); const link = qs('a.btn', target); if (link) { setText(link, module.buttonLabel); if (module.buttonHref) link.href = module.buttonHref; } }",
"  function applyCallout(target, module) { if (!target) return; setText(qs('h2', target), module.title, module.styles?.title); setText(qs('p', target), module.body, module.styles?.body); const link = qs('a.btn', target); if (link) { setText(link, module.buttonLabel, module.styles?.buttonLabel); if (module.buttonHref) link.href = module.buttonHref; } }",
"op callout")
s=rep(s,
"  const legalState = { documents: [], active: 'privacy', loaded: false };\n  const editableFields = ['browserTitle','description','eyebrow','title','subtitle','content'];",
"  const legalState = { documents: [], active: 'privacy', loaded: false };\n  let richText = null; const styledFields = ['eyebrow','title','subtitle','content'];\n  const editableFields = ['browserTitle','description','eyebrow','title','subtitle','content'];",
"legal admin rich vars")
s=rep(s,
"""  function collect() {
    const item = current(); if (!item) return null;
    item.draft = { ...item.draft, browserTitle: $('legalBrowserTitle').value, description: $('legalDescription').value, eyebrow: $('legalEyebrow').value, title: $('legalTitle').value, subtitle: $('legalSubtitle').value, content: $('legalContent').value };
    return { ...item.draft };
  }
""",
"""  function collect() {
    const item = current(); if (!item) return null;
    item.draft = { ...item.draft, styles: { ...(item.draft.styles || {}) }, browserTitle: $('legalBrowserTitle').value, description: $('legalDescription').value, eyebrow: $('legalEyebrow').value, title: $('legalTitle').value, subtitle: $('legalSubtitle').value, content: $('legalContent').value };
    return { ...item.draft, styles: { ...(item.draft.styles || {}) } };
  }
  function legalStyle(item, field) { item.draft.styles ||= {}; item.draft.styles[field] ||= {}; return item.draft.styles[field]; }
  function refreshLegalStyleEditors(item) {
    if (!richText) return;
    for (const field of styledFields) {
      const control = $(fieldControls[field]); const label = control?.closest('label'); if (!control || !label) continue;
      label.querySelector(':scope > .cms-style-toolbar')?.remove(); label.classList.add('has-rich-style');
      const toolbar = richText.createTextStyleToolbar({ control, value: legalStyle(item, field), onChange: (next) => { item.draft.styles[field] = next; } });
      label.insertBefore(toolbar, control);
    }
  }
""",
"legal collect")
s=rep(s,
"""    const merged = { ...data, draft: { ...data.published.document } };
    for (const field of editableFields) merged.draft[field] = pending[field] ?? merged.draft[field];
    if (savedField) merged.draft[savedField] = data.published.document[savedField];
    merged.draft.lastUpdated = data.published.document.lastUpdated;
    merged.dirty = editableFields.some((field) => String(merged.draft[field] ?? '') !== String(data.published.document[field] ?? ''));
""",
"""    const merged = { ...data, draft: { ...data.published.document, styles: { ...(data.published.document.styles || {}), ...(pending.styles || {}) } } };
    for (const field of editableFields) merged.draft[field] = pending[field] ?? merged.draft[field];
    if (savedField) { merged.draft[savedField] = data.published.document[savedField]; if (styledFields.includes(savedField)) merged.draft.styles[savedField] = data.published.document.styles?.[savedField] || {}; }
    merged.draft.lastUpdated = data.published.document.lastUpdated;
    merged.dirty = editableFields.some((field) => String(merged.draft[field] ?? '') !== String(data.published.document[field] ?? '')) || styledFields.some((field) => JSON.stringify(merged.draft.styles?.[field] || {}) !== JSON.stringify(data.published.document.styles?.[field] || {}));
""",
"legal localmerge")
s=rep(s,
"    return [`浏览器标题: ${doc?.browserTitle || ''}`, `SEO: ${doc?.description || ''}`, `顶部短标题: ${doc?.eyebrow || ''}`, `主标题: ${doc?.title || ''}`, `副标题: ${doc?.subtitle || ''}`, `Last updated: ${doc?.lastUpdated || ''}`, '', ...limited];",
"    return [`浏览器标题: ${doc?.browserTitle || ''}`, `SEO: ${doc?.description || ''}`, `顶部短标题: ${doc?.eyebrow || ''}`, `主标题: ${doc?.title || ''}`, `副标题: ${doc?.subtitle || ''}`, `文本样式: ${JSON.stringify(doc?.styles || {})}`, `Last updated: ${doc?.lastUpdated || ''}`, '', ...limited];",
"legal diff styles")
s=rep(s,
"    $('legalBrowserTitle').value = item.draft.browserTitle || ''; $('legalDescription').value = item.draft.description || ''; $('legalEyebrow').value = item.draft.eyebrow || ''; $('legalTitle').value = item.draft.title || ''; $('legalSubtitle').value = item.draft.subtitle || ''; $('legalLastUpdated').value = item.published.document.lastUpdated || ''; $('legalContent').value = item.draft.content || ''; $('legalPreview').href = item.path; history(item); renderDiff(item.published.document, item.draft);",
"    $('legalBrowserTitle').value = item.draft.browserTitle || ''; $('legalDescription').value = item.draft.description || ''; $('legalEyebrow').value = item.draft.eyebrow || ''; $('legalTitle').value = item.draft.title || ''; $('legalSubtitle').value = item.draft.subtitle || ''; $('legalLastUpdated').value = item.published.document.lastUpdated || ''; $('legalContent').value = item.draft.content || ''; $('legalPreview').href = item.path; refreshLegalStyleEditors(item); history(item); renderDiff(item.published.document, item.draft);",
"legal render toolbar")
s=rep(s,
"    const next = { ...item.published.document, [field]: pending[field] };",
"    const next = { ...item.published.document, [field]: pending[field] }; if (styledFields.includes(field)) next.styles = { ...(item.published.document.styles || {}), [field]: pending.styles?.[field] || {} };",
"legal save styles")
pattern=r"  function installLegalFieldSaves\(\) \{.*?\n  \}\n  installLegalFieldSaves\(\);"
replacement="""  async function installLegalFieldSaves() {
    richText = await cmsRichTextPromise;
    for (const [field, id] of Object.entries(fieldControls)) {
      const control = $(id); const label = control?.closest('label'); if (!control || !label || label.dataset.fieldSaveReady === '1') continue;
      label.dataset.fieldSaveReady = '1'; label.classList.add('cms-field'); const footer = node('span', 'cms-field-footer'); const status = node('small', 'cms-field-status'); const save = node('button', 'cms-field-save', '保存'); save.type = 'button'; save.addEventListener('click', () => void saveLegalField(field, save, status)); footer.append(status, save); label.append(footer);
    }
  }
  const legalToolbarReady = installLegalFieldSaves();"""
s=sub(s,pattern,replacement,"legal install",flags=re.S)
s=rep(s,
"    if (!$('legalTabs') || $('app')?.hidden) return;\n    try { const data = await api('/admin/api/legal');",
"    if (!$('legalTabs') || $('app')?.hidden) return;\n    await legalToolbarReady;\n    try { const data = await api('/admin/api/legal');",
"legal load await")
p.write_text(s)

p=Path("license-server/test/website-system.test.mjs"); s=p.read_text()
s=s.replace("assert.equal(config.schemaVersion, 2);","assert.equal(config.schemaVersion, 3);",1)
s=s.replace("assert.equal(seeded.config.schemaVersion, 2);","assert.equal(seeded.config.schemaVersion, 3);",1)
s=rep(s,
"    site: { brandName: ' My GPTWork ', title: 'Custom title' },",
"    site: { brandName: ' My GPTWork ', title: 'Custom title', styles: { brandName: { font: 'georgia', size: 24, color: '#AABBCC', background: 'url(javascript:1)', bold: true, underline: true } } },",
"test style input")
s=rep(s,
"  assert.equal(config.site.brandName, 'My GPTWork');",
"  assert.equal(config.site.brandName, 'My GPTWork');\n  assert.deepEqual(config.site.styles.brandName, { font: 'georgia', size: 24, color: '#aabbcc', bold: true, underline: true });",
"test style assert")
p.write_text(s)

p=Path("license-server/test/legal-cms.test.mjs"); s=p.read_text()
s=rep(s,
"  draft.title = '新版服务条款';\n",
"  draft.title = '新版服务条款';\n  draft.styles = { title: { font: 'georgia', size: 28, color: '#FF0000', background: 'expression(bad)', bold: true } };\n",
"legal style input")
s=rep(s,
"  assert.equal(published.published.document.title, '新版服务条款');",
"  assert.equal(published.published.document.title, '新版服务条款');\n  assert.deepEqual(published.published.document.styles.title, { font: 'georgia', size: 28, color: '#ff0000', bold: true });",
"legal style assert")
p.write_text(s)

new_test = r"""import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('website CMS ships safe per-field text style editor and public renderer', () => {
  const helper = read('public/rich-text-style.js');
  const admin = read('public/admin-website.js');
  const publicSite = read('public/site.js');
  const pageCms = read('public/page-cms.js');
  const server = read('server.mjs');
  assert.match(helper, /createTextStyleToolbar/);
  assert.match(helper, /applyTextStyle/);
  assert.doesNotMatch(helper, /innerHTML\s*=/);
  assert.match(admin, /createTextStyleToolbar/);
  assert.match(admin, /textStylePath/);
  assert.match(publicSite, /module\.styles\?\.title/);
  assert.match(pageCms, /doc\.styles\?\.content/);
  assert.match(server, /\/rich-text-style\.js/);
  assert.match(server, /style-src-attr 'unsafe-inline'/);
});
"""
write("license-server/test/rich-text-cms.test.mjs", new_test)

print("patch complete")
