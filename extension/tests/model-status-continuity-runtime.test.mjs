import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../model-status-continuity.js', import.meta.url), 'utf8');

test('model status continuity persists trusted evidence but never writes the floating indicator DOM', () => {
  assert.match(source, /gptlock\.trusted-model-status\.v1/);
  assert.match(source, /mergeTrustedEvidence/);
  assert.match(source, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(source, /gptlock-model-indicator-host/);
  assert.doesNotMatch(source, /querySelector\(.*model-row/);
  assert.doesNotMatch(source, /setRow\(/);
  assert.doesNotMatch(source, /scheduleRender/);
});

test('model status continuity remains event driven for evidence capture', () => {
  assert.match(source, /GPTLOCK_GUARD_STATE/);
  assert.match(source, /storage\.onChanged/);
  assert.match(source, /visibilitychange/);
  assert.doesNotMatch(source, /setInterval/);
});
