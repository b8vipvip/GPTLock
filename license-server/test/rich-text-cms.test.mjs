import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('website CMS ships safe per-field text style editor and public renderer', () => {
  const helper = read('public/rich-text-style.js');
  const admin = read('public/admin-website.js');
  const publicSite = read('public/site.js');
  const pageCms = read('public/page-cms.js');
  const server = read('server.mjs');
  assert.match(helper, /createTextStyleToolbar/);
  assert.match(helper, /applyTextStyle/);
  assert.doesNotMatch(helper, /innerHTML\s*=/);
  assert.match(admin, /createTextStyleToolbar/);
  assert.match(admin, /textStylePath/);
  assert.match(publicSite, /module\.styles\?\.title/);
  assert.match(pageCms, /doc\.styles\?\.content/);
  assert.match(server, /\/rich-text-style\.js/);
  assert.match(server, /style-src-attr 'unsafe-inline'/);
});
