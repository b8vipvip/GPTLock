import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../private-core-channel.js', import.meta.url),
  new URL('../private-context-bridge.js', import.meta.url),
  new URL('../private-context-indicator.js', import.meta.url),
  new URL('../private-context-budget-authority.js', import.meta.url),
  new URL('../private-request-hook.js', import.meta.url),
  new URL('../private-request-routing.js', import.meta.url),
  new URL('../private-response-hook.js', import.meta.url),
  new URL('../private-response-routing.js', import.meta.url),
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
  /network-evidence\.js/i,
  /extractResponseEvidence/i,
  /streamPayloadMatches/i,
  /MODEL_CONTEXT_WINDOWS/,
  /SAFETY_BUDGET_RATIO/,
  /CONVERSATION_LENGTH_LIMIT_PATTERNS/,
  /LEARNING_HEADROOM_RATIO/,
  /MESSAGE_OVERHEAD_TOKENS/,
  /IMAGE_TOKEN_ESTIMATE/,
  /ATTACHMENT_TOKEN_ESTIMATE/,
  /nextHardLimitProfile/,
  /nextLearnedProfile/,
  /1_050_000/,
  /924_000/,
];

test('public private-core routing contains transport only, not proprietary rules', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const marker of forbiddenImplementationMarkers) {
      assert.doesNotMatch(source, marker);
    }
  }
});
