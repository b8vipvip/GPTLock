import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../private-request-hook.js', import.meta.url),
  new URL('../private-request-routing.js', import.meta.url),
];
const forbiddenImplementationMarkers = [
  /backend-api\/conversation/i,
  /backend-api\/f\/conversation/i,
  /resolved_model_slug/i,
  /served_model_slug/i,
  /stream_handoff/i,
  /encoded_item/i,
  /gpt-5\.6-sol-wm/i,
  /x-openai-model/i,
  /thinking_effort/i,
];

test('public private-request routing contains transport only, not proprietary rules', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const marker of forbiddenImplementationMarkers) {
      assert.doesNotMatch(source, marker);
    }
  }
});
