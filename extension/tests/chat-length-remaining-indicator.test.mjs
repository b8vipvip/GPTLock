import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import(`../chat-length-remaining-indicator.js?test=${Date.now()}`);
const indicator = globalThis.__GPTLOCK_CHAT_LENGTH_REMAINING_INDICATOR__;
const source = await readFile(new URL('../chat-length-remaining-indicator.js', import.meta.url), 'utf8');

test('visible ChatGPT conversation hard limit always forces remaining chat length to zero', () => {
  const result = indicator.calculateRemainingPercent({
    snapshot: { hardLimitVisible: true, model: 'gpt-5.6-sol' },
    localBudget: { safeLimitTokens: 924_000, remainingTokens: 800_000 },
  });
  assert.equal(result.percent, 0);
  assert.equal(result.source, 'chatgpt-visible-hard-limit');
});

test('GPT-5.6 local budget preserves the previously verified 88 percent safety window', () => {
  const window = indicator.contextWindowForModel('gpt-5.6-sol');
  const budget = indicator.computeLocalBudget({
    historyTokens: 92_400,
    draftTokens: 0,
    contextLimitTokens: window.tokens,
  });
  assert.equal(window.tokens, 1_050_000);
  assert.equal(budget.safeLimitTokens, 924_000);
  assert.equal(budget.remainingTokens, 831_600);
  assert.equal(budget.remainingPercent, 90);
});

test('learned real ChatGPT thread boundary remains more conservative than the local model budget', () => {
  const result = indicator.calculateRemainingPercent({
    snapshot: {
      hardLimitVisible: false,
      cumulativeConversationTokens: 700,
      cumulativeConversationCharacters: 6_000,
      cumulativeMessageCount: 70,
    },
    profile: {
      hardLimitObservedCount: 2,
      hardLimitObservedTokens: 1_000,
      hardLimitObservedCharacters: 10_000,
      hardLimitObservedMessages: 100,
    },
    localBudget: {
      safeLimitTokens: 10_000,
      remainingTokens: 9_000,
      cumulativeTokens: 700,
      cumulativeCharacters: 6_000,
      cumulativeMessages: 70,
    },
  });
  assert.equal(result.source, 'learned-chatgpt-thread-boundary');
  assert.equal(result.metricCount, 3);
  assert.ok(Math.abs(result.percent - 30) < 1e-9);
});

test('chat length display no longer waits for or consumes private remainingPercent', () => {
  const result = indicator.calculateRemainingPercent({
    snapshot: {
      hardLimitVisible: false,
      budgetAuthority: 'private-engine',
      remainingPercent: 3,
      model: 'gpt-5.6-sol',
    },
    profile: null,
    localBudget: {
      safeLimitTokens: 1_000,
      remainingTokens: 750,
      cumulativeTokens: 250,
      cumulativeCharacters: 1_000,
      cumulativeMessages: 10,
    },
  });
  assert.equal(result.source, 'local-operational-budget');
  assert.equal(result.percent, 75);
  assert.equal(indicator.formatPercent(result.percent), '75.0%');
  assert.match(source, /estimateTextTokens/);
  assert.match(source, /local-operational-budget/);
  assert.doesNotMatch(source, /__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__/);
});

test('unknown models retain the conservative fallback window from the verified estimator', () => {
  const window = indicator.contextWindowForModel('some-new-model');
  assert.equal(window.tokens, 128_000);
  assert.equal(window.source, 'conservative-fallback');
});


test('remaining display keeps one decimal so active conversations visibly move', () => {
  assert.equal(indicator.formatPercent(17.34), '17.3%');
  assert.equal(indicator.formatPercent(16.96), '17.0%');
  assert.equal(indicator.formatPercent(16.94), '16.9%');
});

test('diagnostic hashes do not expose raw conversation ids', () => {
  const one = indicator.diagnosticConversationHash('conversation:alpha-secret-id');
  const two = indicator.diagnosticConversationHash('conversation:beta-secret-id');
  assert.match(one, /^ctx-[0-9a-f]{8}$/);
  assert.notEqual(one, two);
  assert.doesNotMatch(one, /alpha|secret/i);
});
