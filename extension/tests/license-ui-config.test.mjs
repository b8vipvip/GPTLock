import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const popupJs = new URL('../popup.js', import.meta.url);
const popupShell = new URL('../popup-shell.js', import.meta.url);

test('default popup is a cache-busting account UI with no legacy license controls', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup-account.html');

  const defaultPopup = new URL(`../${manifest.action.default_popup}`, import.meta.url);
  const [html, js, shell] = await Promise.all([
    readFile(defaultPopup, 'utf8'),
    readFile(popupJs, 'utf8'),
    readFile(popupShell, 'utf8'),
  ]);

  assert.match(html, /账号登录/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="accountCenter"/);
  assert.match(html, /popup-shell\.js/);
  assert.doesNotMatch(html, /授权验证 \/ License/);
  assert.doesNotMatch(html, /licensePurchase|licenseActivate|licenseCode/);
  assert.doesNotMatch(html, /GPTL-/);
  assert.doesNotMatch(js, /GPTLOCK_LICENSE_ACTIVATE/);
  assert.match(shell, /\.license-card/);
  assert.match(shell, /options\.html#updates-auto/);
});
