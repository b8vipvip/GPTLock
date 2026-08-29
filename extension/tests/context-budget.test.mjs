import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../context-budget.js?test=${Date.now()}`);
const budget = globalThis.__GPTLOCK_CONTEXT_BUDGET__;

test('uses published GPT-5.6/5.5 context profiles with a conservative unknown fallback', () => {
  assert.equal(budget.contextWindowForModel('gpt-5.6-sol').tokens, 1_050_000);
  assert.equal(budget.contextWindowForModel('gpt-5.6-sol-wm').tokens, 1_050_000);
  assert.equal(budget.contextWindowForModel('gpt-5.5').tokens, 1_050_000);
  assert.equal(budget.contextWindowForModel('gpt-5.4-mini').tokens, 400_000);
  assert.equal(budget.contextWindowForModel('unknown-model').tokens, 128_000);
});

test('token estimator is multilingual and intentionally conservative', () => {
  const english = budget.estimateTextTokens('This is a short English sentence with several ordinary words.');
  const chinese = budget.estimateTextTokens('这是一个用于测试上下文估算的中文句子。');
  const emoji = budget.estimateTextTokens('😀🚀🧠');
  assert.ok(english >= 8);
  assert.ok(chinese >= 15);
  assert.ok(emoji >= 6);
});

test('budget reserves hidden headroom and future assistant output before blocking', () => {
  const safe = budget.computeBudget({ historyTokens: 100_000, draftTokens: 5_000, contextLimitTokens: 1_050_000 });
  assert.equal(safe.wouldExceed, false);
  assert.ok(safe.safeLimitTokens < safe.nominalLimitTokens);
  assert.ok(safe.reserveTokens >= 8_192);

  const nearLimit = budget.computeBudget({ historyTokens: 875_000, draftTokens: 12_000, contextLimitTokens: 1_050_000 });
  assert.equal(nearLimit.wouldExceed, true);
  assert.ok(nearLimit.projectedPercent >= 100);
});

test('indicator percentage is based on the safety budget, not a fake server counter', () => {
  const snapshot = budget.computeBudget({ historyTokens: 420_000, draftTokens: 0, contextLimitTokens: 1_050_000 });
  assert.ok(snapshot.percent > 45 && snapshot.percent < 46);
  assert.equal(snapshot.warning, false);
});

test('an account-learned operational limit can exceed the conservative safety budget without changing the published model window', () => {
  const base = budget.computeBudget({
    historyTokens: 900_000,
    draftTokens: 20_000,
    contextLimitTokens: 1_050_000,
  });
  assert.equal(base.wouldExceed, true);

  const adaptive = budget.computeBudget({
    historyTokens: 900_000,
    draftTokens: 20_000,
    contextLimitTokens: 1_050_000,
    adaptiveSafeLimitTokens: 1_100_000,
  });
  assert.equal(adaptive.wouldExceed, false);
  assert.equal(adaptive.nominalLimitTokens, 1_050_000);
  assert.equal(adaptive.baseSafeLimitTokens, 924_000);
  assert.equal(adaptive.safeLimitTokens, 1_100_000);
  assert.equal(adaptive.adaptiveActive, true);
});

test('successful over-limit answers raise the per-account/model confirmed floor and keep extra exploration headroom', () => {
  const first = budget.nextLearnedProfile({
    accountScope: 'acct-0123456789abcdef',
    accountScopeSource: 'user-id',
    model: 'gpt-5.6-sol',
    confirmedConversationTokens: 1_000_000,
    confirmedCharacters: 3_000_000,
    conversationKey: 'conversation:first',
    measuredAt: '2026-08-29T01:00:00.000Z',
    baseSafeLimitTokens: 924_000,
  });
  assert.equal(first.confirmedConversationTokens, 1_000_000);
  assert.ok(first.adaptiveSafeLimitTokens > first.confirmedConversationTokens);
  assert.equal(first.successfulBypassCount, 1);

  const second = budget.nextLearnedProfile({
    previous: first,
    accountScope: 'acct-0123456789abcdef',
    accountScopeSource: 'user-id',
    model: 'gpt-5.6-sol',
    confirmedConversationTokens: 980_000,
    confirmedCharacters: 2_900_000,
    conversationKey: 'conversation:second',
    measuredAt: '2026-08-29T02:00:00.000Z',
    baseSafeLimitTokens: 924_000,
  });
  assert.equal(second.confirmedConversationTokens, first.confirmedConversationTokens);
  assert.equal(second.adaptiveSafeLimitTokens, first.adaptiveSafeLimitTokens);
  assert.equal(second.successfulBypassCount, 2);
});

test('learned profile keys are account-scoped and model-aware', () => {
  const one = budget.profileStorageKey('acct-one', 'gpt-5.6-sol');
  const same = budget.profileStorageKey('acct-one', 'gpt-5.6-sol-wm');
  const otherAccount = budget.profileStorageKey('acct-two', 'gpt-5.6-sol');
  const otherModel = budget.profileStorageKey('acct-one', 'gpt-5.4-mini');
  assert.equal(one, same);
  assert.notEqual(one, otherAccount);
  assert.notEqual(one, otherModel);
  assert.equal(budget.profileStorageKey(null, 'gpt-5.6-sol'), null);
});
