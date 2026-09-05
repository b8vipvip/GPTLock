const FONT_VALUES = new Set(['system','sans','serif','mono','yahei','pingfang','arial','georgia']);
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
