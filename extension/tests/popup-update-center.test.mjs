import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const popupCss = new URL('../popup-v0513.css', import.meta.url);
const optionsHtml = new URL('../options.html', import.meta.url);
const optionsUpdate = new URL('../options-update.js', import.meta.url);
const installer = new URL('../../packaging/windows/GPTLock.iss', import.meta.url);

test('popup keeps the five primary actions on one compact row', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const popupHtml = new URL(`../${manifest.action.default_popup}`, import.meta.url);
  const [html, css] = await Promise.all([readFile(popupHtml, 'utf8'), readFile(popupCss, 'utf8')]);
  for (const id of ['autoVerify', 'reconnect', 'checkUpdate', 'logs', 'options']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /grid-template-columns:\s*repeat\(5,/);
  assert.doesNotMatch(css, /\.actions \.auto,\s*\n\.actions \.reconnect,[\s\S]*grid-column:\s*1\s*\/\s*-1/);
});

test('settings page owns the real-time updater and popup deep-links to it', async () => {
  const [html, js] = await Promise.all([readFile(optionsHtml, 'utf8'), readFile(optionsUpdate, 'utf8')]);
  assert.match(html, /id="updates"/);
  assert.match(html, /id="updateProgress"/);
  assert.match(html, /id="updatePercent"/);
  assert.match(html, /id="updateLog"/);
  assert.match(html, /options-update\.js/);
  assert.match(js, /#updates-auto/);
  assert.match(js, /fetchLatestRelease/);
  assert.match(js, /prepare_update/);
  assert.match(js, /bytesReceived/);
  assert.match(js, /UPDATE_STATUS_KEY/);
});

test('updater polls the native core directly with bounded requests instead of full background reconnects', async () => {
  const source = await readFile(optionsUpdate, 'utf8');
  assert.match(source, /INSTALL_PROBE_TIMEOUT_MS/);
  assert.match(source, /RUNTIME_MESSAGE_TIMEOUT_MS/);
  assert.match(source, /nativeRequest\('get_status'/);
  assert.doesNotMatch(source, /GPTLOCK_RECONNECT/);
});

test('Windows installer removes stale UI and stops the installed core before replacing binaries', async () => {
  const source = await readFile(installer, 'utf8');
  assert.match(source, /\[InstallDelete\]/);
  assert.match(source, /Type:\s*filesandordirs;\s*Name:\s*"\{app\}\\extension"/);
  assert.match(source, /function StopInstalledCoreProcesses\(\): Boolean/);
  assert.match(source, /function PrepareToInstall\(var NeedsRestart: Boolean\): String/);
  assert.match(source, /Get-Process -Name ''gptlock-core''/);
});
