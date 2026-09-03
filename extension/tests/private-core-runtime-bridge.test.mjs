import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('public native bridge stays generic and contains no private decision rules', async () => {
  const bridge = await readFile(new URL('native-core/src/private_engine.rs', root), 'utf8');
  assert.match(bridge, /gptwork-engine/);
  for (const operation of ['evaluate_request', 'evaluate_response', 'evaluate_context']) {
    assert.match(bridge, new RegExp(operation));
  }
  for (const privateMarker of [
    /backend-api\/conversation/i,
    /resolved_model_slug/i,
    /served_model_slug/i,
    /gpt-5\.6-sol-wm/i,
    /network_response_metadata/i,
    /stream_handoff/i,
  ]) {
    assert.doesNotMatch(bridge, privateMarker);
  }
});
