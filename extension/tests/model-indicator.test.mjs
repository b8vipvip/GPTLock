import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../model-catalog.js', import.meta.url), 'utf8');

test('model indicator is independent, translucent, and anchored above GPTWork status', () => {
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

test('model indicator renders page request and response evidence simultaneously', () => {
  assert.match(source, /data-source="page"/);
  assert.match(source, /data-source="request"/);
  assert.match(source, /data-source="response"/);
  assert.match(source, /页面模型/);
  assert.match(source, /请求模型/);
  assert.match(source, /响应模型/);
  assert.match(source, /modelSnapshot/);
  assert.match(source, /updateRow\(button, 'page'/);
  assert.match(source, /updateRow\(button, 'request'/);
  assert.match(source, /updateRow\(button, 'response'/);
  assert.doesNotMatch(source, /candidates\.sort/);
});
