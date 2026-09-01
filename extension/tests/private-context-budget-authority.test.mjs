import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../private-context-budget-authority.js?test=${Date.now()}`);
const authority = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__;

test('authority payload keeps only generic local text/media/profile facts', () => {
  const payload = authority.buildBudgetPayload({
    model: 'gpt-5.6-sol',
    history: [{ text: 'hello', images: 2, attachments: 1, endpoint: '/secret' }],
    draft: { text: 'draft', images: 1 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: 950000,
      confirmedConversationTokens: 900000,
      noticeText: 'secret',
    },
  });
  assert.deepEqual(payload, {
    model: 'gpt-5.6-sol',
    history: [{ text: 'hello', images: 2, attachments: 1 }],
    draft: { text: 'draft', images: 1, attachments: 0 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: 950000,
      confirmedConversationTokens: 900000,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /endpoint|noticeText|secret/);
});

test('authority maps private numeric decisions onto the legacy compatibility snapshot', () => {
  const snapshot = authority.applyResultToSnapshot({
    conversationKey: 'conversation:1',
    model: 'gpt-5.6-sol',
    fullConversationCharacters: 1234,
  }, {
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
    remainingTokens: 922980,
    warning: false,
    wouldExceed: false,
    adaptiveActive: false,
    hardLimitActive: false,
    contextWindowSource: 'model-window',
  }, { evaluatedAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(snapshot.budgetAuthority, 'private-engine');
  assert.equal(snapshot.fullConversationTokens, 1020);
  assert.equal(snapshot.safeLimitTokens, 924000);
  assert.equal(snapshot.percent, 0.11);
  assert.equal(snapshot.fullConversationCharacters, 1234);
});

test('authority media counts are bounded without implementing token weights', () => {
  assert.deepEqual(
    authority.normalizePart({ text: 'x', images: 999, attachments: -1 }),
    { text: 'x', images: 32, attachments: 0 },
  );
});
