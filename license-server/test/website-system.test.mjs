import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createWebsiteSystem, DEFAULT_WEBSITE_CONFIG, normalizeWebsiteConfig } from '../website-system.mjs';

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, license_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL) STRICT;
  `);
  return db;
}

test('website config keeps required modules and sanitizes links', () => {
  const config = normalizeWebsiteConfig({
    site: { brandName: ' My GPTWork ', title: 'Custom title' },
    navigation: [
      { id: 'bad', label: 'Bad', href: 'javascript:alert(1)', enabled: true, order: 3 },
      { id: 'docs', label: 'Docs', href: 'https://example.com/docs', enabled: true, order: 2 },
    ],
    homeModules: [
      { id: 'hero', type: 'hero', enabled: false, order: 90, title: 'Changed', body: 'Body' },
      { id: 'custom-one', type: 'custom', name: '自定义', enabled: true, order: 5, title: 'Hello', body: 'World', buttonLabel: 'Go', buttonHref: 'javascript:bad()' },
    ],
  });
  assert.equal(config.site.brandName, 'My GPTWork');
  assert.equal(config.navigation[0].href, '/');
  assert.equal(config.navigation[1].href, 'https://example.com/docs');
  assert.equal(config.homeModules.find((item) => item.id === 'hero').enabled, false);
  assert.equal(config.homeModules.find((item) => item.id === 'custom-one').buttonHref, '/');
  for (const required of ['hero', 'features', 'workflow', 'callout']) assert.ok(config.homeModules.some((item) => item.id === required));
});

test('website system seeds defaults, persists admin updates, and can reset', async () => {
  const db = createDb();
  const json = (res, status, body) => { res.status = status; res.body = body; };
  const system = createWebsiteSystem({ db, json });
  const seeded = system.read();
  assert.equal(seeded.config.site.brandName, 'GPTWork');
  assert.ok(seeded.updatedAt);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_settings').get().count, 1);

  const res = {};
  const input = structuredClone(DEFAULT_WEBSITE_CONFIG);
  input.site.brandName = 'GPTWork Pro';
  input.homeModules[1].enabled = false;
  await system.handleAdmin({ method: 'PUT' }, res, new URL('https://example.test/admin/api/website'), async () => ({ config: input }));
  assert.equal(res.status, 200);
  assert.equal(system.read().config.site.brandName, 'GPTWork Pro');
  assert.equal(system.read().config.homeModules.find((item) => item.id === 'features').enabled, false);

  const resetRes = {};
  await system.handleAdmin({ method: 'POST' }, resetRes, new URL('https://example.test/admin/api/website/reset'), async () => ({}));
  assert.equal(resetRes.status, 200);
  assert.equal(system.read().config.site.brandName, 'GPTWork');
  assert.equal(system.read().config.homeModules.find((item) => item.id === 'features').enabled, true);
  const events = db.prepare('SELECT event FROM audit_log ORDER BY id').all().map((row) => row.event);
  assert.deepEqual(events, ['website_config_initialized', 'website_config_updated', 'website_config_reset']);
});
