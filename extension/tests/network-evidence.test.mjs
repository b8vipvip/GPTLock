import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractHeaderEvidence,
  extractRequestEvidence,
  extractResponseEvidence,
  isChatGptConversationRequest,
  parseSseObjects,
} from '../network-evidence.js';

test('extracts strong metadata from a JSON response', () => {
  const result = extractResponseEvidence({
    body: JSON.stringify({ message: { metadata: { model_slug: 'gpt-5.6-sol', reasoning_effort: 'high' } } }),
    mimeType: 'application/json',
  });
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.reasoning, 'high');
  assert.equal(result.evidenceSource, 'network_response_metadata');
});

test('extracts metadata from SSE without treating DONE as JSON', () => {
  const body = [
    'event: message',
    'data: {"message":{"metadata":{"model_slug":"gpt-5.6-sol","thinking_level":"xhigh"}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.equal(parseSseObjects(body).length, 1);
  const result = extractResponseEvidence({ body, mimeType: 'text/event-stream' });
  assert.deepEqual([result.model, result.reasoning], ['gpt-5.6-sol', 'extra-high']);
});

test('never parses model-looking JSON inside message content', () => {
  const result = extractResponseEvidence({
    body: JSON.stringify({
      message: {
        content: { parts: ['{"model_slug":"gpt-5.5","reasoning_effort":"low"}'] },
        metadata: {},
      },
    }),
  });
  assert.equal(result.model, null);
  assert.equal(result.reasoning, null);
});

test('marks conflicting highest-confidence metadata as unusable', () => {
  const result = extractResponseEvidence({
    body: JSON.stringify([
      { metadata: { model_slug: 'gpt-5.6-sol' } },
      { metadata: { model_slug: 'gpt-5.5' } },
    ]),
  });
  assert.equal(result.model, null);
  assert.equal(result.conflicts.model, true);
});

test('response headers are whitelisted and normalized', () => {
  const result = extractHeaderEvidence({
    'X-OpenAI-Model': 'GPT-5.6-SOL',
    'X-Reasoning-Effort': 'extra_high',
    Authorization: 'must-not-be-copied',
  });
  assert.deepEqual([result.model, result.reasoning], ['gpt-5.6-sol', 'extra-high']);
  assert.deepEqual(result.fields, {
    model: 'x-openai-model',
    reasoning: 'x-reasoning-effort',
  });
});

test('request metadata stays explicitly non-authoritative', () => {
  const result = extractRequestEvidence('{"model":"gpt-5.6-sol","reasoning_effort":"medium"}');
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.reasoning, 'medium');
  assert.equal(result.evidenceSource, 'network_request_metadata');
});

test('only accepts ChatGPT backend conversation-like POST requests', () => {
  assert.equal(isChatGptConversationRequest('https://chatgpt.com/backend-api/conversation', 'POST'), true);
  assert.equal(isChatGptConversationRequest('https://chatgpt.com/backend-api/accounts', 'POST'), false);
  assert.equal(isChatGptConversationRequest('https://evil.example/backend-api/conversation', 'POST'), false);
  assert.equal(isChatGptConversationRequest('https://chatgpt.com/backend-api/conversation', 'GET'), false);
});

test('missing metadata remains missing instead of being invented', () => {
  const result = extractResponseEvidence({ body: '{"status":"ok"}' });
  assert.equal(result.model, null);
  assert.equal(result.reasoning, null);
  assert.deepEqual(result.conflicts, { model: false, reasoning: false });
});
