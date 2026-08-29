import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

async function source(name) {
  return readFile(new URL(name, ROOT), 'utf8');
}

test('popup is account-first and contains no license-code input', async () => {
  const html = await source('popup.html');
  assert.match(html, /id="authShell"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="forgotForm"/);
  assert.match(html, /id="verifyForm"/);
  assert.match(html, /id="accountCenter"/);
  assert.doesNotMatch(html, /GPTL-/);
  assert.doesNotMatch(html, /授权码/);
  assert.doesNotMatch(html, /licenseCode/);
});

test('account token is local-only and background enforces entitlement and window access', async () => {
  const [client, background] = await Promise.all([source('account-client.js'), source('background.js')]);
  assert.match(client, /chrome\.storage\.local/);
  assert.doesNotMatch(client, /chrome\.storage\.sync/);
  assert.match(client, /gptlockAccountSessionToken/);
  assert.match(background, /accountAllowsState/);
  assert.match(background, /entitlement\?\.active/);
  assert.match(background, /allowedWindowKeys/);
  assert.match(background, /effectiveSettingsForState/);
  assert.match(background, /GPTLOCK_ACCOUNT_LOGIN/);
  assert.match(background, /GPTLOCK_ACCOUNT_CREATE_ORDER/);
});

test('account center renders service-defined membership and password management', async () => {
  const [html, js] = await Promise.all([source('account.html'), source('account.js')]);
  assert.match(html, /账户中心/);
  assert.match(html, /修改密码/);
  assert.match(html, /id="plans"/);
  assert.match(js, /config\?\.plans/);
  assert.match(js, /paymentMethods/);
  assert.match(js, /GPTLOCK_ACCOUNT_CHANGE_PASSWORD/);
  assert.match(js, /GPTLOCK_ACCOUNT_CREATE_ORDER/);
});
