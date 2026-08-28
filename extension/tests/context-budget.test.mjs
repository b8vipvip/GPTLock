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
