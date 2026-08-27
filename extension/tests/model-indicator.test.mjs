import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../model-catalog.js', import.meta.url), 'utf8');

test('model indicator is independent, translucent, and anchored above GPTLock status', () => {
  assert.match(source, /gptlock-model-indicator-host/);
  assert.match(source, /gptlock-indicator-host/);
  assert.match(source, /window\.innerHeight - anchor\.top \+ INDICATOR_GAP_PX/);
  assert.match(source, /background:rgba\(/);
  assert.match(source, /backdrop-filter:blur\(10px\)/);
  assert.match(source, /ResizeObserver/);
});

test('model indicator receives event-driven state and keeps a live fallback refresh', () => {
  assert.match(source, /GPTLOCK_GUARD_STATE/);
  assert.match(source, /GPTLOCK_GET_STATE/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /STATE_REFRESH_MS = 1200/);
  assert.match(source, /setInterval/);
  assert.match(source, /detectPageModel/);
});

test('fresh page selection can supersede stale request or response display', () => {
  assert.match(source, /capturedAt: timestamp\(verification\?\.verifiedAt\)/);
  assert.match(source, /capturedAt: timestamp\(state\?\.lastRequest\?\.capturedAt\)/);
  assert.match(source, /capturedAt: timestamp\(pageObservation\?\.capturedAt\)/);
  assert.match(source, /right\.capturedAt - left\.capturedAt/);
});
