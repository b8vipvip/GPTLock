import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('legacy License cannot become active and window count cannot gate GPTLock', async () => {
  const [background, auth, accountSystem, manifestText] = await Promise.all([
    readFile(new URL('../background.js', import.meta.url), 'utf8'),
    readFile(new URL('../auth-gate.js', import.meta.url), 'utf8'),
    readFile(new URL('../../license-server/account-system.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const settings = await readFile(new URL(`../${manifest.options_ui.page}`, import.meta.url), 'utf8');
  assert.equal(manifest.options_ui.page, 'settings-v0519.html');
  assert.doesNotMatch(settings, /授权验证 \/ License|id="licenseCode"|GPTL-/);
  const gate = background.match(/function accountAllowsState\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(gate, /authenticated/);
  assert.doesNotMatch(gate, /allowedWindowKeys|windowId|deniedWindowKeys/);
  assert.match(background, /authorized: false,[\s\S]*status: 'removed',[\s\S]*license: null/);
  assert.doesNotMatch(background, /当前窗口已超过同时窗口上限/);
  assert.doesNotMatch(auth, /!windowAccess|当前窗口超过账户同时窗口上限/);
  assert.match(accountSystem, /const allowed = entitlement\.active \? requested : \[\];/);
  assert.doesNotMatch(accountSystem, /entitlement\.limits\.windows - otherCount/);
});
