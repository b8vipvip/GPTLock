import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../context-remaining-indicator.js?test=${Date.now()}`);
const remaining = globalThis.__GPTLOCK_CONTEXT_REMAINING__;

test('a real ChatGPT conversation-length notice forces remaining chat length to zero', () => {
  const result = remaining.calculateRemainingPercent({
    snapshot: {
      hardLimitVisible: false,
      safeLimitTokens: 924_000,
      remainingTokens: 900_000,
      cumulativeConversationTokens: 24_000,
    },
    hardLimitVisible: true,
  });
  assert.equal(result.percent, 0);
  assert.equal(result.source, 'chatgpt-visible-hard-limit');
  assert.equal(remaining.formatRemainingPercent(result.percent), '0%');
});

test('fallback display is remaining percentage rather than used percentage or token bytes', () => {
  const result = remaining.calculateRemainingPercent({
    snapshot: {
      safeLimitTokens: 924_000,
      remainingTokens: 900_000,
    },
  });
  assert.ok(result.percent > 97 && result.percent < 98);
  assert.equal(result.source, 'local-operational-budget');
  assert.equal(remaining.formatRemainingPercent(result.percent), '97%');
});

test('learned real thread boundary uses the most conservative observed chat-scale ratio', () => {
  const result = remaining.calculateRemainingPercent({
    snapshot: {
      safeLimitTokens: 924_000,
      remainingTokens: 800_000,
      cumulativeConversationTokens: 20_000,
      cumulativeConversationCharacters: 150_000,
      cumulativeMessageCount: 70,
    },
    profile: {
      hardLimitObservedCount: 1,
      hardLimitObservedTokens: 100_000,
      hardLimitObservedCharacters: 300_000,
      hardLimitObservedMessages: 100,
    },
  });
  assert.equal(result.percent, 30);
  assert.equal(result.metricCount, 3);
  assert.equal(result.source, 'learned-chatgpt-thread-boundary');
});

test('learned boundary can still estimate from whichever observed metrics are available', () => {
  const result = remaining.calculateRemainingPercent({
    snapshot: {
      cumulativeConversationTokens: 50_000,
      cumulativeConversationCharacters: 0,
      cumulativeMessageCount: 0,
    },
    profile: {
      hardLimitObservedCount: 1,
      hardLimitObservedTokens: 100_000,
    },
  });
  assert.equal(result.percent, 50);
  assert.equal(result.metricCount, 1);
});

test('percentage formatting is compact and percentage-only', () => {
  assert.equal(remaining.formatRemainingPercent(100), '100%');
  assert.equal(remaining.formatRemainingPercent(97.4), '97%');
  assert.equal(remaining.formatRemainingPercent(8.25), '8.3%');
  assert.equal(remaining.formatRemainingPercent(-1), '0%');
});
