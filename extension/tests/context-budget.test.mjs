import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../context-budget.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
await import(`${sourceUrl.href}?test=${Date.now()}`);
const budget = globalThis.__GPTLOCK_CONTEXT_BUDGET__;

test('browser context API exposes collection and storage only, not proprietary math', () => {
  for (const name of [
    'contextWindowForModel', 'estimateTextTokens', 'computeBudget', 'learningHeadroomTokens',
    'nextLearnedProfile', 'nextHardLimitProfile',
  ]) {
    assert.equal(Object.hasOwn(budget, name), false, `${name} must not be exposed`);
  }
  for (const marker of [
    /MODEL_CONTEXT_WINDOWS/, /SAFETY_BUDGET_RATIO/, /MESSAGE_OVERHEAD_TOKENS/,
    /IMAGE_TOKEN_ESTIMATE/, /ATTACHMENT_TOKEN_ESTIMATE/, /LEARNING_HEADROOM_RATIO/,
    /LEARNING_HEADROOM_MIN_TOKENS/, /LEARNING_HEADROOM_MAX_TOKENS/, /MAX_ADAPTIVE_LIMIT_TOKENS/,
    /function estimateTextTokens/, /function computeBudget/, /function nextLearnedProfile/,
    /function nextHardLimitProfile/, /1_050_000/, /924_000/,
  ]) assert.doesNotMatch(source, marker);
});

test('active conversation collector follows current_node and preserves local raw parts without tokenizing', () => {
  const payload = {
    current_node: 'a2',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: { parent: 'root', children: ['a1', 'fork'], message: { content: { parts: ['hello active branch'] }, metadata: {} } },
      a1: { parent: 'u1', children: ['a2'], message: { content: { parts: ['active answer'] }, metadata: {} } },
      a2: { parent: 'a1', children: [], message: { content: { parts: ['latest user turn'] }, metadata: {} } },
      fork: { parent: 'u1', children: [], message: { content: { parts: ['x'.repeat(100_000)] }, metadata: {} } },
    },
  };
  const metrics = budget.extractConversationMetrics(payload);
  assert.equal(metrics.messageCount, 3);
  assert.ok(metrics.characters < 1_000);
  assert.equal(metrics.privateHistoryParts.length, 3);
  assert.equal(Object.hasOwn(metrics, 'tokens'), false);
});

test('profile keys remain account-scoped and model-aware', () => {
  const one = budget.profileStorageKey('acct-one', 'gpt-5.6-sol');
  const same = budget.profileStorageKey('acct-one', 'gpt-5.6-sol-wm');
  assert.equal(one, same);
  assert.notEqual(one, budget.profileStorageKey('acct-two', 'gpt-5.6-sol'));
  assert.notEqual(one, budget.profileStorageKey('acct-one', 'gpt-5.4-mini'));
  assert.equal(budget.profileStorageKey(null, 'gpt-5.6-sol'), null);
});

test('persistent checkpoints reconcile cumulative private measurements without deriving tokens', () => {
  const first = budget.buildContextCheckpoint({
    accountScope: 'acct-one', accountScopeSource: 'user-id', conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1', model: 'gpt-5.6-sol',
    snapshot: { historyTokens: 100_000, historyCharacters: 300_000, messageCount: 100, historyMeasurementSource: 'conversation-tree+dom-reconcile' },
    currentNode: 'node-a', measuredAt: '2026-08-29T03:00:00.000Z',
  });
  const compressed = budget.buildContextCheckpoint({
    previous: first, accountScope: 'acct-one', accountScopeSource: 'user-id', conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1', model: 'gpt-5.6-sol',
    snapshot: { historyTokens: 70_000, historyCharacters: 210_000, messageCount: 70, historyMeasurementSource: 'conversation-tree+dom-reconcile' },
    currentNode: 'node-b', measuredAt: '2026-08-29T03:05:00.000Z',
  });
  const continued = budget.buildContextCheckpoint({
    previous: compressed, accountScope: 'acct-one', accountScopeSource: 'user-id', conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1', model: 'gpt-5.6-sol',
    snapshot: { historyTokens: 90_000, historyCharacters: 270_000, messageCount: 90, historyMeasurementSource: 'conversation-tree+dom-reconcile' },
    currentNode: 'node-c', measuredAt: '2026-08-29T03:10:00.000Z',
  });
  assert.equal(compressed.activeContextTokens, 70_000);
  assert.equal(compressed.cumulativeTokens, 100_000);
  assert.equal(continued.activeContextTokens, 90_000);
  assert.equal(continued.cumulativeTokens, 120_000);
  assert.equal(continued.cumulativeMessages, 120);
});

test('checkpoint keys isolate account conversation and model', () => {
  const base = budget.checkpointStorageKey('acct-one', 'conv-one', 'gpt-5.6-sol');
  assert.ok(base?.startsWith('gptlock.context-state.v1:'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-two', 'conv-one', 'gpt-5.6-sol'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-one', 'conv-two', 'gpt-5.6-sol'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-one', 'conv-one', 'gpt-5.4-mini'));
});

test('pending bypass evidence can resume only for the matching fresh account conversation and model', () => {
  const startedAt = 1_000_000;
  const record = budget.serializePendingBypassRecord({
    startedAt, conversationKey: 'conversation:conv-one',
    preSnapshot: { usedTokens: 1_010_000, fullConversationCharacters: 3_000_000, conversationKey: 'conversation:conv-one', model: 'gpt-5.6-sol' },
    baselineAssistantCount: 100, model: 'gpt-5.6-sol', accountScope: 'acct-one', accountScopeSource: 'user-id',
    requestId: 'req-1', requestObserved: true, responseSeen: true, responseSuccessful: true,
  });
  const resumed = budget.restorePendingBypassRecord(record, {
    now: startedAt + 10_000, accountScope: 'acct-one', conversationKey: 'conversation:conv-one', model: 'gpt-5.6-sol',
  });
  assert.equal(resumed.requestObserved, true);
  assert.equal(resumed.preSnapshot.usedTokens, 1_010_000);
  assert.equal(budget.restorePendingBypassRecord(record, {
    now: record.expiresAt + 1, accountScope: 'acct-one', conversationKey: 'conversation:conv-one', model: 'gpt-5.6-sol',
  }), null);
});

test('real ChatGPT conversation-length boundary text remains a collection signal', () => {
  assert.equal(budget.classifyConversationLengthLimitText('你已到达此对话的长度上限，你可以开始新聊天以继续对话。')?.locale, 'zh-CN');
  assert.equal(budget.classifyConversationLengthLimitText("You've reached the maximum length for this conversation. You can start a new chat to continue.")?.locale, 'en');
  assert.equal(budget.classifyConversationLengthLimitText('我们正在讨论对话长度上限这个概念。'), null);
});
