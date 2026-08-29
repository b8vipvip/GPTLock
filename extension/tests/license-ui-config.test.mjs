import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const popupHtml = new URL('../popup.html', import.meta.url);
const popupJs = new URL('../popup.js', import.meta.url);

test('popup exposes license activation and server-configured purchase link', async () => {
  const [html, js] = await Promise.all([readFile(popupHtml, 'utf8'), readFile(popupJs, 'utf8')]);
  assert.match(html, /授权验证 \/ License/);
  assert.match(html, /id="licensePurchase"[^>]*>获取授权码/);
  assert.doesNotMatch(html, />gptlock\.mv3\.cn</);
  assert.match(html, /id="licenseActivate"[^>]*>验证授权码/);
  assert.match(js, /api\/v1\/config/);
  assert.match(js, /protocol !== 'https:'/);
  assert.match(js, /GPTLOCK_LICENSE_ACTIVATE/);
});
