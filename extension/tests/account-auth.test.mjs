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
  assert.match(html, /id="deviceReplaceForm"/);
  assert.match(html, /id="deviceReplaceList"/);
  assert.match(html, /是否需要邮箱验证码由服务端系统配置决定/);
  assert.doesNotMatch(html, /注册必须通过邮箱验证码/);
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
  assert.match(background, /GPTLOCK_ACCOUNT_SECURITY/);
  assert.match(background, /GPTLOCK_ACCOUNT_RELEASE_DEVICE/);
  assert.match(client, /replaceDeviceRecordIds/);
  assert.match(client, /account\/devices\/release/);
  const authGate = await source('auth-gate.js');
  assert.match(authGate, /registration\?\.verificationRequired === false/);
  assert.match(authGate, /当前服务端未启用邮箱验证/);
});

test('account center renders service-defined membership and password management', async () => {
  const [html, js] = await Promise.all([source('account.html'), source('account.js')]);
  assert.match(html, /账户中心/);
  assert.match(html, /修改密码/);
  assert.match(html, /设备与登录会话/);
  assert.match(html, /id="devices"/);
  assert.match(html, /id="sessions"/);
  assert.match(html, /id="plans"/);
  assert.match(js, /config\?\.plans/);
  assert.match(js, /paymentMethods/);
  assert.match(js, /GPTLOCK_ACCOUNT_CHANGE_PASSWORD/);
  assert.match(js, /GPTLOCK_ACCOUNT_CREATE_ORDER/);
  assert.match(js, /GPTLOCK_ACCOUNT_RELEASE_DEVICE/);
  assert.match(js, /GPTLOCK_ACCOUNT_REVOKE_SESSION/);
  assert.match(js, /GPTLOCK_ACCOUNT_REVOKE_OTHER_SESSIONS/);
});
