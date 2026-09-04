import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createWebsiteSystem } from '../website-system.mjs';

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, license_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL) STRICT;
  `);
  return db;
}

test('legal drafts stay private until an explicit publish', () => {
  const db = createDb();
  const system = createWebsiteSystem({ db, json() {} });
  const legal = system.legalSystem;
  const before = legal.readPublished('privacy');
  assert.equal(before.version, 1);
  const draft = structuredClone(legal.readAdmin('privacy').draft);
  draft.title = '新隐私标题';
  draft.content += '\n\n## 新增段落\n这是仅管理员可见的草稿内容。';
  const saved = legal.saveDraft('privacy', draft);
  assert.equal(saved.dirty, true);
  assert.equal(legal.readPublished('privacy').version, 1);
  assert.equal(legal.readPublished('privacy').document.title, before.document.title);
});

test('publish creates a new version and rollback never overwrites history', () => {
  const db = createDb();
  const system = createWebsiteSystem({ db, json() {} });
  const legal = system.legalSystem;
  const initial = legal.readPublished('terms');
  const draft = structuredClone(legal.readAdmin('terms').draft);
  draft.title = '新版服务条款';
  legal.saveDraft('terms', draft);
  const published = legal.publish('terms', 'PUBLISH:terms');
  assert.equal(published.published.version, 2);
  assert.equal(published.published.document.title, '新版服务条款');
  assert.equal(legal.readVersion('terms', 1).document.title, initial.document.title);

  const rolled = legal.rollback('terms', 1, 'ROLLBACK:terms');
  assert.equal(rolled.published.version, 3);
  assert.equal(rolled.published.document.title, initial.document.title);
  assert.equal(rolled.history[0].action, 'rollback');
  assert.equal(rolled.history[0].sourceVersion, 1);
  assert.equal(legal.readVersion('terms', 2).document.title, '新版服务条款');
});

test('publish and rollback require explicit confirmations and valid content', () => {
  const db = createDb();
  const system = createWebsiteSystem({ db, json() {} });
  const legal = system.legalSystem;
  assert.throws(() => legal.publish('privacy', 'wrong'), /发布确认无效/);
  assert.throws(() => legal.publish('privacy', 'PUBLISH:privacy'), /没有变化/);
  assert.throws(() => legal.rollback('privacy', 999, 'ROLLBACK:privacy'), /不存在/);

  const draft = structuredClone(legal.readAdmin('privacy').draft);
  draft.content = '太短';
  legal.saveDraft('privacy', draft);
  assert.throws(() => legal.publish('privacy', 'PUBLISH:privacy'), /过短/);
});
