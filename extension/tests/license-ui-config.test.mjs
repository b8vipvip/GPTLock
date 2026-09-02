import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const popupJs = new URL('../popup.js', import.meta.url);
const popupShell = new URL('../popup-v0513-shell.js', import.meta.url);
const popupCss = new URL('../popup-v0513.css', import.meta.url);
const settingsShell = new URL('../settings-shell.js', import.meta.url);

test('default popup and settings use cache-proof entrypoints with no legacy license controls', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup-v0513.html');
  assert.equal(manifest.options_ui.page, 'settings-v0521.html');
  assert.equal(manifest.background.service_worker, 'background-entry.js');

  const defaultPopup = new URL(`../${manifest.action.default_popup}`, import.meta.url);
  const settingsPage = new URL(`../${manifest.options_ui.page}`, import.meta.url);
  const [html, settingsHtml, js, shell, css, settingsGuard] = await Promise.all([
    readFile(defaultPopup, 'utf8'),
    readFile(settingsPage, 'utf8'),
    readFile(popupJs, 'utf8'),
    readFile(popupShell, 'utf8'),
    readFile(popupCss, 'utf8'),
    readFile(settingsShell, 'utf8'),
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
  assert.doesNotMatch(html, /<button id="reconnect"/);
  assert.doesNotMatch(html, /<button id="logs"/);
  assert.doesNotMatch(js, /GPTLOCK_LICENSE_ACTIVATE/);

  assert.doesNotMatch(settingsHtml, /授权验证 \/ License/);
  assert.doesNotMatch(settingsHtml, /licensePurchase|licenseActivate|licenseCode/);
  assert.doesNotMatch(settingsHtml, /GPTL-/);
  assert.match(settingsHtml, /settings-shell\.js/);

  assert.match(shell, /SHELL_REVISION = 'v0513-license-ui-purge-1'/);
  assert.match(shell, /input\[placeholder\^="GPTL-" i\]/);
  assert.match(shell, /授权验证/);
  assert.match(shell, /gptlockPopupRuntimeInfo/);
  assert.match(shell, /getManifest\(\)\.options_ui\?\.page/);
  assert.match(shell, /#updates-auto/);

  assert.match(settingsGuard, /SETTINGS_REVISION = 'v0521-settings-state-repair-1'/);
  assert.match(settingsGuard, /input\[placeholder\^="GPTL-" i\]/);
  assert.match(settingsGuard, /授权验证 \/ License/);
  assert.match(settingsGuard, /gptlockUiUpdateStatus/);
  assert.match(settingsGuard, /SAFE_CORE_RECONCILE_PHASES/);

  assert.match(css, /input\[placeholder\^="GPTL-" i\]/);
  assert.match(css, /section:has\(input\[placeholder\^="GPTL-" i\]\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,/);
});
