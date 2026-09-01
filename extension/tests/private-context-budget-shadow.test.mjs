import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../private-context-budget-shadow.js?test=${Date.now()}`);
const shadow = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_SHADOW__;

test('shadow payload keeps only generic text/media/profile facts', () => {
  const payload = shadow.buildBudgetPayload({
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

test('shadow comparison is only authoritative for DOM-fallback legacy measurement', () => {
  const privateResult = {
    safeLimitTokens: 924000,
    usedTokens: 10000,
    remainingTokens: 914000,
    wouldExceed: false,
  };
  const comparable = shadow.compareWithLegacy(privateResult, {
    historyMeasurementSource: 'dom-fallback',
    safeLimitTokens: 924000,
    usedTokens: 10000,
    remainingTokens: 914000,
    wouldExceed: false,
  });
  assert.equal(comparable.comparable, true);
  assert.equal(comparable.safeLimitDelta, 0);
  assert.equal(comparable.usedTokensDelta, 0);
  assert.equal(comparable.remainingTokensDelta, 0);
  assert.equal(comparable.wouldExceedMatches, true);

  const treeBacked = shadow.compareWithLegacy(privateResult, {
    historyMeasurementSource: 'conversation-tree+dom-reconcile',
    safeLimitTokens: 924000,
    usedTokens: 12000,
    remainingTokens: 912000,
    wouldExceed: false,
  });
  assert.equal(treeBacked.comparable, false);
});

test('shadow media counts are bounded without implementing token weights', () => {
  assert.deepEqual(
    shadow.normalizePart({ text: 'x', images: 999, attachments: -1 }),
    { text: 'x', images: 32, attachments: 0 },
  );
});
