import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/admin-website.css', import.meta.url), 'utf8');

test('website navigation reserves separate space for order save and delete actions', () => {
  assert.match(css, /\.nav-row\{[^}]*grid-template-columns:auto minmax\(120px,\.7fr\) minmax\(180px,1\.2fr\) minmax\(160px,max-content\) minmax\(64px,max-content\)/);
  assert.match(css, /\.nav-row>\.danger\{[^}]*white-space:nowrap/);
  assert.ok(css.includes('@media(max-width:900px)'));
  assert.match(css, /\.module-grid,\.nested-item,\.nav-row,\.legal-split\{grid-template-columns:1fr\}/);
});
