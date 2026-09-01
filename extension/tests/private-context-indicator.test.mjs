import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../private-context-indicator.js?test=${Date.now()}`);
const remaining = globalThis.__GPTLOCK_PRIVATE_CONTEXT_REMAINING__;

test('private context payload contains only bounded context metrics', () => {
  const payload = remaining.buildPrivateContextPayload({
    hardLimitVisible: false,
    cumulativeConversationTokens: 20_000,
    cumulativeConversationCharacters: 150_000,
    cumulativeMessageCount: 70,
    safeLimitTokens: 924_000,
    remainingTokens: 800_000,
    ignoredChatText: 'must not cross the bridge',
  }, {
    hardLimitObservedTokens: 100_000,
    hardLimitObservedCharacters: 300_000,
    hardLimitObservedMessages: 100,
    hardLimitLastText: 'must not cross the bridge',
  });

  assert.deepEqual(payload, {
    snapshot: {
      hardLimitVisible: false,
      cumulativeTokens: 20_000,
      cumulativeCharacters: 150_000,
      cumulativeMessages: 70,
      fallbackSafeLimitTokens: 924_000,
      fallbackRemainingTokens: 800_000,
    },
    profile: {
      hardLimitObservedTokens: 100_000,
      hardLimitObservedCharacters: 300_000,
      hardLimitObservedMessages: 100,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /must not cross the bridge/);
});

test('visible hard limit still fails safe to zero before async private evaluation', () => {
  const result = remaining.fallbackRemaining({
    hardLimitVisible: true,
    safeLimitTokens: 924_000,
    remainingTokens: 900_000,
  });
  assert.equal(result.percent, 0);
  assert.equal(result.source, 'visible-boundary-fallback');
});

test('private-core outage fallback is only generic local budget arithmetic', () => {
  const result = remaining.fallbackRemaining({
    safeLimitTokens: 924_000,
    remainingTokens: 900_000,
  });
  assert.ok(result.percent > 97 && result.percent < 98);
  assert.equal(result.source, 'local-budget-fallback');
  assert.equal(remaining.formatRemainingPercent(result.percent), '97%');
});

test('private result normalization accepts only bounded percent and source', () => {
  assert.deepEqual(
    remaining.normalizePrivateResult({ percent: 30.25, source: 'learned-chat-boundary' }),
    { percent: 30.25, source: 'learned-chat-boundary', privateEngine: true },
  );
  assert.equal(remaining.normalizePrivateResult({ percent: 'not-a-number', source: 'x' }), null);
  assert.equal(remaining.normalizePrivateResult({ percent: 10, source: '' }), null);
});

test('percentage formatting remains compact', () => {
  assert.equal(remaining.formatRemainingPercent(100), '100%');
  assert.equal(remaining.formatRemainingPercent(97.4), '97%');
  assert.equal(remaining.formatRemainingPercent(8.25), '8.3%');
  assert.equal(remaining.formatRemainingPercent(-1), '0%');
});
