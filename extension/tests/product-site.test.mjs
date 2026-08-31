import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicRoot = new URL('../../license-server/public/', import.meta.url);

test('public product site exposes dedicated product, guide, releases, and account pages', async () => {
  for (const [file, page] of [['index.html','home'], ['guide.html','guide'], ['releases.html','releases'], ['account.html','account']]) {
    const html = await readFile(new URL(file, publicRoot), 'utf8');
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, /href="\/guide"/);
    assert.match(html, /href="\/releases"/);
    assert.match(html, /href="\/account"/);
    assert.match(html, /src="\/site\.js"/);
    assert.match(html, /href="\/site\.css"/);
  }
  const guide = await readFile(new URL('guide.html', publicRoot), 'utf8');
  assert.match(guide, /请求锁定/);
  assert.match(guide, /响应确认/);
  assert.match(guide, /自动验证/);
  const server = await readFile(new URL('../../license-server/server.mjs', import.meta.url), 'utf8');
  for (const route of ["'/'", "'/guide'", "'/releases'", "'/account'"]) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
  assert.match(server, /createSiteAccountSystem/);
  assert.match(server, /createSiteReleaseFeed/);
  assert.doesNotMatch(server, /'\/': 'admin\.html'/);
});

test('website account sessions are isolated from extension device quota', async () => {
  const source = await readFile(new URL('../../license-server/site-account.mjs', import.meta.url), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS site_sessions/);
  assert.match(source, /gptlock_site_session/);
  assert.doesNotMatch(source, /INSERT INTO user_devices/);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(source, /\/site\/api\/account\/change-password/);
  assert.match(source, /\/site\/api\/account\/devices\/release/);
});

test('extension release button is routed to the GPTLock product site', async () => {
  const source = await readFile(new URL('../options-update.js', import.meta.url), 'utf8');
  assert.match(source, /GPTLOCK_PRODUCT_SITE_URL/);
  assert.match(source, /https:\/\/gptlock\.mv3\.cn\//);
  assert.match(source, /chrome\.tabs\.create\(\{ url: GPTLOCK_PRODUCT_SITE_URL \}\)/);
});
