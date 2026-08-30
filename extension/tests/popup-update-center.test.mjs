import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const popupHtml = new URL('../popup-account.html', import.meta.url);
const popupCss = new URL('../popup.css', import.meta.url);
const optionsHtml = new URL('../options.html', import.meta.url);
const optionsUpdate = new URL('../options-update.js', import.meta.url);
const installer = new URL('../../packaging/windows/GPTLock.iss', import.meta.url);

test('popup keeps the five primary actions on one compact row', async () => {
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

test('Windows installer removes the previous extension snapshot before copying new UI files', async () => {
  const source = await readFile(installer, 'utf8');
  assert.match(source, /\[InstallDelete\]/);
  assert.match(source, /Type:\s*filesandordirs;\s*Name:\s*"\{app\}\\extension"/);
});
