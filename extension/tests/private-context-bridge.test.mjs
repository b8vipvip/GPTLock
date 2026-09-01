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

test('legacy coarse context remaining bridge surface is removed', () => {
  assert.equal(Object.hasOwn(bridge, 'sanitizePrivateContextPayload'), false);
  assert.equal(Object.hasOwn(bridge, 'normalizePrivateContextResult'), false);
  assert.equal(Object.hasOwn(bridge, 'PRIVATE_CONTEXT_MESSAGE_TYPE'), false);
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

test('private context profile bridge strips metadata and keeps numeric learning facts', () => {
  const payload = bridge.sanitizePrivateContextProfilePayload({
    event: 'successful_bypass',
    model: 'GPT-5.6-SOL',
    previous: {
      confirmedConversationTokens: 900000,
      adaptiveSafeLimitTokens: 950000,
      successfulBypassCount: 2,
      noticeText: 'secret',
    },
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    accountScope: 'must-not-cross',
  });
  assert.deepEqual(payload, {
    event: 'successful_bypass',
    model: 'gpt-5.6-sol',
    previous: {
      confirmedConversationTokens: 900000,
      confirmedCharacters: null,
      adaptiveSafeLimitTokens: 950000,
      successfulBypassCount: 2,
      hardLimitUpperBoundTokens: null,
      hardLimitObservedCount: null,
    },
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    observedConversationTokens: null,
    measurementReliable: false,
  });
  assert.doesNotMatch(JSON.stringify(payload), /accountScope|noticeText|secret|must-not-cross/);
});

test('private context profile result accepts only compact numeric decisions', () => {
  const result = bridge.normalizePrivateContextProfileResult({
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    adaptiveSafeLimitTokens: 1017600,
    successfulBypassCount: 3,
    hardLimitUpperBoundTokens: 0,
    hardLimitObservedCount: 0,
    hardLimitTokenCapUsable: false,
    hardLimitConfidence: 'ui-boundary-only',
    privateFormula: 'must-not-survive',
  });
  assert.equal(result.adaptiveSafeLimitTokens, 1017600);
  assert.equal(result.successfulBypassCount, 3);
  assert.equal(Object.hasOwn(result, 'privateFormula'), false);
});
