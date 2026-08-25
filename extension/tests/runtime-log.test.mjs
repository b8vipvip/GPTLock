import assert from 'node:assert/strict';
import test from 'node:test';

import { boundRuntimeLogs, sanitizeLogValue } from '../runtime-log.js';

test('redacts secrets and chat payload fields from runtime logs', () => {
  const result = sanitizeLogValue({
    model: 'gpt-5.6-sol',
    authorization: 'Bearer secret',
    requestBody: '{"prompt":"private"}',
    chatContent: 'private answer',
    nested: { cookie: 'session', status: 200 },
  });
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.authorization, '[redacted]');
  assert.equal(result.requestBody, '[redacted]');
  assert.equal(result.chatContent, '[redacted]');
  assert.equal(result.nested.cookie, '[redacted]');
  assert.equal(result.nested.status, 200);
});

test('bounds the persisted runtime log ring buffer', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ index }));
  assert.deepEqual(boundRuntimeLogs(entries, 3), [{ index: 5 }, { index: 6 }, { index: 7 }]);
  assert.deepEqual(boundRuntimeLogs(null), []);
});

test('clips overly long strings without dropping diagnostic context', () => {
  const value = sanitizeLogValue({ error: 'x'.repeat(1000) });
  assert.match(value.error, /^x+…\[truncated:1000\]$/);
  assert.ok(value.error.length < 900);
});
