import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const ADMIN_PAGES = [
  'admin.html',
  'admin-users.html',
  'admin-plans.html',
  'admin-orders.html',
  'admin-issues.html',
  'admin-website.html',
  'admin-settings.html',
  'admin-client-logs.html',
  'admin-server-logs.html',
  'admin-update.html',
];

test('every admin page exposes Issues and website management and loads the shared navigation runtime', () => {
  for (const filename of ADMIN_PAGES) {
    const html = readFileSync(join(PUBLIC, filename), 'utf8');
    assert.match(html, /href="\/admin\/issues"/, `${filename} should link to Issues`);
    assert.match(html, /href="\/admin\/website"/, `${filename} should link to website management`);
    assert.match(html, /src="\/page-cms\.js"/, `${filename} should load the shared admin navigation runtime`);
  }
});

test('shared admin navigation contains the complete canonical menu', () => {
  const source = readFileSync(join(PUBLIC, 'page-cms.js'), 'utf8');
  for (const route of ['/admin/overview', '/admin/users', '/admin/plans', '/admin/orders', '/admin/issues', '/admin/website', '/admin/settings', '/admin/client-logs', '/admin/server-logs', '/admin/update']) {
    assert.ok(source.includes(route), `shared navigation should contain ${route}`);
  }
});

test('legal publish stops before POST when the saved draft has no changes', () => {
  const source = readFileSync(join(PUBLIC, 'page-cms.js'), 'utf8');
  const guard = source.indexOf('if (!saved.dirty)');
  const publishRequest = source.indexOf("/publish`, { method: 'POST'", guard);
  assert.ok(guard >= 0, 'Legal CMS should explicitly guard clean drafts');
  assert.ok(publishRequest > guard, 'No-change guard must run before the publish request');
  assert.match(source.slice(guard, publishRequest), /页面顶部“保存并发布”/, 'No-change message should direct normal website edits to the correct publish button');
});
