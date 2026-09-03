import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import(`../chat-length-remaining-indicator.js?test=${Date.now()}`);
const indicator = globalThis.__GPTLOCK_CHAT_LENGTH_REMAINING_INDICATOR__;
const source = await readFile(new URL('../chat-length-remaining-indicator.js', import.meta.url), 'utf8');

test('visible ChatGPT conversation hard limit always forces remaining chat length to zero', () => {
  const state = indicator.selectDisplayState({
    snapshot: {
      hardLimitVisible: true,
      budgetAuthority: 'private-engine',
      remainingPercent: 87.5,
      conversationKey: 'conversation:1',
      model: 'gpt-5.6-sol',
    },
    authority: {
      available: true,
      conversationKey: 'conversation:1',
      model: 'gpt-5.6-sol',
      privateResult: { remainingPercent: 87.5 },
    },
  });
  assert.equal(state.percent, 0);
  assert.equal(state.source, 'chatgpt-visible-hard-limit');
});

test('indicator renders private remaining percentage without reimplementing token budget math', () => {
  const state = indicator.selectDisplayState({
    snapshot: {
      hardLimitVisible: false,
      budgetAuthority: 'private-engine',
      remainingPercent: 37.4,
      conversationKey: 'conversation:1',
      model: 'gpt-5.6-sol',
    },
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.percent, 37.4);
  assert.equal(indicator.formatPercent(state.percent), '37%');
  assert.match(source, /聊天长度剩余/);
  assert.doesNotMatch(source, /等待私有核心/);
  assert.doesNotMatch(source, /remainingTokens\s*\/|safeLimitTokens|nominalLimitTokens|tokenWeight|mediaWeight/);
});

test('stale private result is only reused for the same conversation and model', () => {
  const matching = indicator.selectDisplayState({
    snapshot: { conversationKey: 'conversation:1', model: 'gpt-5.6-sol' },
    authority: {
      available: true,
      stale: true,
      conversationKey: 'conversation:1',
      model: 'gpt-5.6-sol',
      privateResult: { remainingPercent: 62.8 },
    },
  });
  assert.equal(matching.status, 'ready');
  assert.equal(matching.percent, 62.8);
  assert.equal(matching.stale, true);

  const mismatched = indicator.selectDisplayState({
    snapshot: { conversationKey: 'conversation:2', model: 'gpt-5.6-sol' },
    authority: {
      available: true,
      stale: true,
      conversationKey: 'conversation:1',
      model: 'gpt-5.6-sol',
      privateResult: { remainingPercent: 62.8 },
    },
  });
  assert.equal(mismatched.status, 'pending');
  assert.equal(mismatched.percent, null);
});

test('private calculation errors surface as unavailable instead of waiting forever', () => {
  const state = indicator.selectDisplayState({
    snapshot: { conversationKey: 'conversation:1', model: 'gpt-5.6-sol' },
    authority: { available: false, error: 'private_context_budget_unavailable' },
  });
  assert.equal(state.status, 'unavailable');
  assert.equal(state.percent, null);
});

test('missing full-history input does not leave the indicator stuck on calculating forever', () => {
  const state = indicator.selectDisplayState({
    snapshot: { conversationKey: 'conversation:1', model: 'gpt-5.6-sol' },
    authority: { available: false, error: 'full_history_unavailable' },
  });
  assert.equal(state.status, 'unavailable');
  assert.equal(state.percent, null);
});
