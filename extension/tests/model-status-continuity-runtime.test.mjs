import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../model-status-continuity.js', import.meta.url), 'utf8');

test('model status continuity does not observe and mutate its own shadow root', () => {
  assert.doesNotMatch(source, /rootObserver/);
  assert.doesNotMatch(source, /observeRoot\(/);
  assert.doesNotMatch(source, /MutationObserver\(scheduleRender\)/);
});

test('model status DOM writes are idempotent and rendering yields to the page event loop', () => {
  assert.match(source, /if \(button\.dataset\.tone !== tone\) button\.dataset\.tone = tone/);
  assert.match(source, /if \(button\.title !== detail\) button\.title = detail/);
  assert.match(source, /window\.setTimeout\(render, 0\)/);
  assert.doesNotMatch(source, /queueMicrotask\(render\)/);
});

test('continuity rendering is event-driven and does not race the base indicator refresh loop', () => {
  assert.doesNotMatch(source, /setInterval\(render/);
  assert.doesNotMatch(source, /REFRESH_MS\s*=\s*750/);
  assert.match(source, /GPTLOCK_GUARD_STATE/);
  assert.match(source, /storage\.onChanged/);
});

test('historical response keeps the model label without a recent-confirmed suffix', () => {
  assert.doesNotMatch(source, /最近已确认/);
  assert.match(source, /const label = modelLabel\(response\.id\)/);
});
