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
      hardLimitObservedCharacters: null,
      hardLimitObservedMessages: 20,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret/);
});

test('budget bridge transports chat text locally but strips unrelated metadata', () => {
  const payload = bridge.sanitizePrivateContextBudgetPayload({
    model: 'GPT-5.6-Sol',
    history: [
      { text: 'first turn', images: 2, attachments: 1, authorEmail: 'secret@example.com' },
      { text: 'second turn', images: 100, attachments: -5 },
    ],
    draft: { text: 'draft', images: 1 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: null,
      confirmedConversationTokens: 900000,
      accountScope: 'must-not-cross',
    },
  });

  assert.deepEqual(payload, {
    model: 'gpt-5.6-sol',
    history: [
      { text: 'first turn', images: 2, attachments: 1 },
      { text: 'second turn', images: 32, attachments: 0 },
    ],
    draft: { text: 'draft', images: 1, attachments: 0 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: null,
      confirmedConversationTokens: 900000,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret@example|must-not-cross/);
});

test('budget bridge rejects oversized local context before native messaging', () => {
  assert.throws(() => bridge.sanitizePrivateContextBudgetPayload({
    history: [{ text: 'x'.repeat((16 * 1024 * 1024) + 1) }],
  }), /exceeds local evaluation limit/);
});

test('private context result normalization clamps percentage', () => {
  assert.deepEqual(
    bridge.normalizePrivateContextResult({ percent: 125, source: 'private-test' }),
    { percent: 100, source: 'private-test' },
  );
  assert.throws(() => bridge.normalizePrivateContextResult({ percent: Number.NaN, source: 'x' }));
  assert.throws(() => bridge.normalizePrivateContextResult({ percent: 10, source: '' }));
});

test('private context budget result is whitelisted and bounded', () => {
  const normalized = bridge.normalizePrivateContextBudgetResult({
    nominalLimitTokens: 1050000,
    baseSafeLimitTokens: 924000,
    adaptiveSafeLimitTokens: 0,
    hardLimitUpperBoundTokens: 0,
    confirmedLowerBoundTokens: 0,
    safeLimitTokens: 924000,
    reserveTokens: 42000,
    historyTokens: 1000,
    draftTokens: 20,
    usedTokens: 1020,
    projectedTokens: 43020,
    percentUsed: 0.11,
    projectedPercent: 4.65,
    remainingPercent: 99.89,
    remainingTokens: 922980,
    warning: false,
    wouldExceed: false,
    adaptiveActive: false,
    hardLimitActive: false,
    contextWindowSource: 'model-window',
    chatText: 'must not survive normalization',
  });
  assert.equal(normalized.safeLimitTokens, 924000);
  assert.equal(normalized.remainingPercent, 99.89);
  assert.equal(normalized.contextWindowSource, 'model-window');
  assert.equal(Object.hasOwn(normalized, 'chatText'), false);
});
