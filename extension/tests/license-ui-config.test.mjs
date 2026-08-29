import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const popupHtml = new URL('../popup.html', import.meta.url);
const popupJs = new URL('../popup.js', import.meta.url);

test('legacy license-code controls are absent from the popup', async () => {
  const [html, js] = await Promise.all([readFile(popupHtml, 'utf8'), readFile(popupJs, 'utf8')]);
  assert.match(html, /账号登录/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="accountCenter"/);
  assert.doesNotMatch(html, /授权验证 \/ License/);
  assert.doesNotMatch(html, /licensePurchase|licenseActivate|licenseCode/);
  assert.doesNotMatch(html, /GPTL-/);
  assert.doesNotMatch(js, /GPTLOCK_LICENSE_ACTIVATE/);
});
