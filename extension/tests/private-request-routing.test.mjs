import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPrivateRequestPatches,
  buildPrivateRequestPayload,
  normalizePrivateRequestDecision,
  safeRequestEndpoint,
} from '../private-request-routing.js';

test('private request payload contains only bounded transport inputs', () => {
  assert.deepEqual(
    buildPrivateRequestPayload(
      { url: 'https://chatgpt.com/example/path?secret=query', method: 'POST' },
      '{"sample":true}',
      { lockedModels: ['model-a'], allowedReasoningLevels: ['high'], preferredReasoning: 'high' },
    ),
    {
      host: 'chatgpt.com',
      path: '/example/path',
      method: 'POST',
      postData: '{"sample":true}',
      lockedModels: ['model-a'],
      allowedReasoningLevels: ['high'],
      preferredReasoning: 'high',
    },
  );
});

test('private request decision accepts only generic top-level patches', () => {
  const decision = normalizePrivateRequestDecision({
    officialConversation: true,
    changed: true,
    reason: 'rewritten',
    patches: [{ op: 'replace', path: ['alpha'], value: 'beta' }],
    modelBefore: 'before',
    modelAfter: 'after',
  });
  assert.equal(decision.changed, true);
  assert.deepEqual(decision.patches, [{ op: 'replace', path: ['alpha'], value: 'beta' }]);
  assert.throws(() => normalizePrivateRequestDecision({
    officialConversation: true,
    changed: true,
    patches: [{ op: 'replace', path: ['nested', 'field'], value: true }],
  }));
  assert.throws(() => normalizePrivateRequestDecision({
    officialConversation: true,
    changed: false,
    patches: [{ op: 'remove', path: ['alpha'] }],
  }));
});

test('generic patch application mutates only the supplied top-level paths', () => {
  const result = JSON.parse(applyPrivateRequestPatches(
    '{"alpha":1,"keep":{"nested":true},"removeMe":3}',
    [
      { op: 'replace', path: ['alpha'], value: 2 },
      { op: 'add', path: ['added'], value: ['x'] },
      { op: 'remove', path: ['removeMe'] },
    ],
  ));
  assert.deepEqual(result, { alpha: 2, keep: { nested: true }, added: ['x'] });
});

test('request endpoint diagnostics strip query strings and long identifiers', () => {
  assert.equal(
    safeRequestEndpoint('https://chatgpt.com/example/abcdefghijklmnopqrstuvwxyz0123456789?token=secret'),
    '/example/:id',
  );
});
