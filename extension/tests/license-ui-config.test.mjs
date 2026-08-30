import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const popupJs = new URL('../popup.js', import.meta.url);
const popupShell = new URL('../popup-v0513-shell.js', import.meta.url);
const popupCss = new URL('../popup-v0513.css', import.meta.url);

test('default popup uses a versioned cache-proof entrypoint with no legacy license controls', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup-v0513.html');

  const defaultPopup = new URL(`../${manifest.action.default_popup}`, import.meta.url);
  const [html, js, shell, css] = await Promise.all([
    readFile(defaultPopup, 'utf8'),
    readFile(popupJs, 'utf8'),
    readFile(popupShell, 'utf8'),
    readFile(popupCss, 'utf8'),
  ]);

  assert.match(html, /账号登录/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="accountCenter"/);
  assert.match(html, /popup-v0513-shell\.js/);
  assert.match(html, /popup-v0513\.css/);
  assert.doesNotMatch(html, /授权验证 \/ License/);
  assert.doesNotMatch(html, /licensePurchase|licenseActivate|licenseCode/);
  assert.doesNotMatch(html, /GPTL-/);
  assert.doesNotMatch(js, /GPTLOCK_LICENSE_ACTIVATE/);

  assert.match(shell, /SHELL_REVISION = 'v0513-license-ui-purge-1'/);
  assert.match(shell, /input\[placeholder\^="GPTL-" i\]/);
  assert.match(shell, /授权验证/);
  assert.match(shell, /gptlockPopupRuntimeInfo/);
  assert.match(shell, /options\.html#updates-auto/);

  assert.match(css, /input\[placeholder\^="GPTL-" i\]/);
  assert.match(css, /section:has\(input\[placeholder\^="GPTL-" i\]\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,/);
});
