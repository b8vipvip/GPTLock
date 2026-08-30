import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('model auto-lock helper is loaded after model discovery', () => {
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const discovery = scripts.indexOf('model-catalog.js');
  const autoLock = scripts.indexOf('model-auto-lock.js');
  assert.ok(discovery >= 0);
  assert.ok(autoLock > discovery);
});
