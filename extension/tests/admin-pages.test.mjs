import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pages = {
  overview: ['admin.html', 'overview'],
  users: ['admin-users.html', 'users'],
  plans: ['admin-plans.html', 'plans'],
  orders: ['admin-orders.html', 'orders'],
  settings: ['admin-settings.html', 'settings'],
  'client-logs': ['admin-client-logs.html', 'clientLogs'],
  'server-logs': ['admin-server-logs.html', 'logs'],
  update: ['admin-update.html', 'update'],
};

test('server admin navigation uses independent route-backed pages', async () => {
  const ids = Object.values(pages).map(([, id]) => id);
  for (const [page, [file, id]] of Object.entries(pages)) {
    const html = await readFile(new URL(`../../license-server/public/${file}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`data-admin-page="${page}"`));
    assert.match(html, new RegExp(`id="${id}"`));
    for (const other of ids) if (other !== id) assert.doesNotMatch(html, new RegExp(`id="${other}"`));
    for (const route of ['/admin/overview','/admin/users','/admin/plans','/admin/orders','/admin/settings','/admin/client-logs','/admin/server-logs','/admin/update']) assert.match(html, new RegExp(`href="${route}"`));
  }
  const server = await readFile(new URL('../../license-server/server.mjs', import.meta.url), 'utf8');
  for (const route of ['/admin/users','/admin/plans','/admin/orders','/admin/settings','/admin/client-logs','/admin/server-logs','/admin/update']) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
});
