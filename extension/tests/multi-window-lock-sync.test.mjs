import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../multi-window-lock-sync.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('every ChatGPT content script instance listens for synchronized lock changes', () => {
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /changes\.policy/);
  assert.match(source, /lockedModels/);
  assert.match(source, /requestForcedSync\(\)/);
});

test('forced alignment retries when page controls are unavailable or generation is active', () => {
  assert.match(source, /GENERATING_SELECTORS/);
  assert.match(source, /scheduleRetry\(\)/);
  assert.match(source, /currentModel !== desiredModel/);
  assert.match(source, /currentReasoning !== preferred/);
  assert.doesNotMatch(source, /currentModel\s*&&\s*currentModel\s*!==\s*desiredModel/);
});

test('whole-page MutationObserver is only armed after active retries are exhausted and disconnects before retrying', () => {
  assert.match(source, /function armWakeObserver\(\)/);
  assert.match(source, /attempts < MAX_ACTIVE_ATTEMPTS/);
  assert.match(source, /armWakeObserver\(\)/);
  assert.match(source, /wakeObserver\?\.disconnect\(\)/);
  assert.doesNotMatch(source, /new MutationObserver\([\s\S]*?\)\.observe\(document\.documentElement/);
});

test('forced sync is loaded into every ChatGPT tab after the normal lock runtime', () => {
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const contentIndex = scripts.indexOf('content.js');
  const syncIndex = scripts.indexOf('multi-window-lock-sync.js');
  assert.ok(contentIndex >= 0);
  assert.ok(syncIndex > contentIndex);
});
