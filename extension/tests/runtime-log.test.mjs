import assert from 'node:assert/strict';
import test from 'node:test';

import { boundRuntimeLogs, sanitizeLogValue } from '../runtime-log.js';

test('redacts secrets and chat payload fields while preserving safe technical diagnostics', () => {
  const result = sanitizeLogValue({
    model: 'gpt-5.6-sol',
    authorization: 'Bearer secret',
    requestBody: '{"prompt":"private"}',
    postData: '{"prompt":"private"}',
    postDataLength: 1234,
    chatContent: 'private answer',
    diagnostics: {
      endpoint: '/backend-api/f/conversation',
      modelCandidatePaths: ['message.metadata.model_slug', 'metadata.served_model'],
      nested: { fields: { model: 'message.metadata.model_slug' } },
    },
    nested: { cookie: 'session', status: 200 },
  });
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.authorization, '[redacted]');
  assert.equal(result.requestBody, '[redacted]');
  assert.equal(result.postData, '[redacted]');
  assert.equal(result.postDataLength, 1234);
  assert.equal(result.chatContent, '[redacted]');
  assert.equal(result.nested.cookie, '[redacted]');
  assert.equal(result.nested.status, 200);
  assert.deepEqual(result.diagnostics.modelCandidatePaths, [
    'message.metadata.model_slug',
    'metadata.served_model',
  ]);
  assert.equal(result.diagnostics.nested.fields.model, 'message.metadata.model_slug');
});

test('bounds the persisted runtime log ring buffer', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ index }));
  assert.deepEqual(boundRuntimeLogs(entries, 3), [{ index: 5 }, { index: 6 }, { index: 7 }]);
  assert.deepEqual(boundRuntimeLogs(null), []);
});

test('diagnostic array sanitization keeps the newest entries', () => {
  const entries = Array.from({ length: 300 }, (_, index) => ({ index }));
  const result = sanitizeLogValue(entries);
  assert.equal(result[0], '[truncated:300;omitted:50;kept:last]');
  assert.equal(result[1].index, 50);
  assert.equal(result.at(-1).index, 299);
});

test('clips overly long strings without dropping diagnostic context', () => {
  const value = sanitizeLogValue({ error: 'x'.repeat(2500) });
  assert.match(value.error, /^x+…\[truncated:2500\]$/);
  assert.ok(value.error.length < 2100);
});
