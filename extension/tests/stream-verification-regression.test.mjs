import test from 'node:test';
import assert from 'node:assert/strict';

import { extractResponseEvidence } from '../network-evidence.js';
import {
  hasCompleteResponseEvidence,
  webSocketFrameMatchesHandoff,
} from '../network-monitor.js';

function embeddedFrame(metadata) {
  const encoded = `event: delta\ndata: ${JSON.stringify({
    v: {
      message: {
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['ok'] },
        metadata,
      },
    },
  })}\n\n`;
  return JSON.stringify([{
    type: 'message',
    topic_id: 'conversation-turn-turn-12345678',
    payload: {
      type: 'conversation-turn-stream',
      payload: {
        type: 'stream-item',
        conversation_id: 'conversation-12345678',
        turn_id: 'turn-12345678',
        encoded_item: encoded,
      },
    },
  }]);
}

test('resolved routing metadata cannot override conflicting locked-model metadata', () => {
  const evidence = extractResponseEvidence({
    body: embeddedFrame({
      resolved_model_slug: 'gpt-5-6-auto-thinking',
      model_slug: 'gpt-5-6',
      default_model_slug: 'gpt-5.6-sol-wm',
      thinking_effort: 'extended',
    }),
    mimeType: 'application/json',
  });

  assert.equal(evidence.model, null);
  assert.equal(evidence.reasoning, 'high');
  assert.equal(evidence.conflicts.model, true);
  assert.deepEqual(
    new Set(evidence.diagnostics.modelCandidateValues),
    new Set(['gpt-5-6-auto-thinking', 'gpt-5.6-sol']),
  );
  assert.equal(hasCompleteResponseEvidence(evidence), false);
});

test('consistent disallowed backend model remains complete evidence', () => {
  const evidence = extractResponseEvidence({
    body: embeddedFrame({
      resolved_model_slug: 'gpt-5.5',
      model_slug: 'gpt-5.5',
      default_model_slug: 'gpt-5.5',
      thinking_effort: 'high',
    }),
    mimeType: 'application/json',
  });

  assert.equal(evidence.model, 'gpt-5.5');
  assert.equal(evidence.reasoning, 'high');
  assert.equal(evidence.conflicts.model, false);
  assert.equal(hasCompleteResponseEvidence(evidence), true);
});

test('metadata-empty control frames are not verification-bearing evidence', () => {
  const evidence = extractResponseEvidence({
    body: JSON.stringify([{ type: 'reply', reply: { type: 'unsubscribe' } }]),
    mimeType: 'application/json',
  });

  assert.equal(evidence.model, null);
  assert.equal(evidence.reasoning, null);
  assert.equal(hasCompleteResponseEvidence(evidence), false);
});

test('websocket verification requires a marker from the exact handoff', () => {
  const handoff = {
    conversationId: 'conversation-12345678',
    turnExchangeId: 'turn-12345678',
    topicIds: ['conversation-turn-turn-12345678'],
    resumeToken: 'resume-token-12345678',
  };

  assert.equal(
    webSocketFrameMatchesHandoff(
      JSON.stringify({ topic_id: 'conversation-turn-turn-12345678', payload: 'delta' }),
      handoff,
    ),
    true,
  );
  assert.equal(
    webSocketFrameMatchesHandoff(
      JSON.stringify({ topic_id: 'conversation-turn-other-99999999', payload: 'delta' }),
      handoff,
    ),
    false,
  );
});
