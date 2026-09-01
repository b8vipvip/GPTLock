import assert from 'node:assert/strict';
import test from 'node:test';

const listeners = [];
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) { listeners.push(listener); },
    },
  },
};

const bridge = await import(`../private-context-bridge.js?test=${Date.now()}`);

test('private context bridge registers one runtime listener', () => {
  assert.equal(listeners.length, 1);
});

test('bridge strips unrelated fields and bounds numeric metrics', () => {
  const payload = bridge.sanitizePrivateContextPayload({
    snapshot: {
      hardLimitVisible: true,
      cumulativeTokens: 12.9,
      cumulativeCharacters: -1,
      cumulativeMessages: Number.POSITIVE_INFINITY,
      fallbackSafeLimitTokens: 1000,
      fallbackRemainingTokens: 250,
      chatContent: 'secret',
    },
    profile: {
      hardLimitObservedTokens: 2000,
      hardLimitObservedCharacters: null,
      hardLimitObservedMessages: 20,
      noticeText: 'secret',
    },
  });

  assert.deepEqual(payload, {
    snapshot: {
      hardLimitVisible: true,
      cumulativeTokens: 12,
      cumulativeCharacters: null,
      cumulativeMessages: null,
      fallbackSafeLimitTokens: 1000,
      fallbackRemainingTokens: 250,
    },
    profile: {
      hardLimitObservedTokens: 2000,
      hardLimitObservedCharacters: 0,
      hardLimitObservedMessages: 20,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret/);
});

test('private context result normalization clamps percentage', () => {
  assert.deepEqual(
    bridge.normalizePrivateContextResult({ percent: 125, source: 'private-test' }),
    { percent: 100, source: 'private-test' },
  );
  assert.throws(() => bridge.normalizePrivateContextResult({ percent: Number.NaN, source: 'x' }));
  assert.throws(() => bridge.normalizePrivateContextResult({ percent: 10, source: '' }));
});
