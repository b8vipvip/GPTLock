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


test('full conversation metrics follow only the active current_node branch instead of counting abandoned forks', () => {
  const payload = {
    current_node: 'a2',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: {
        parent: 'root', children: ['a1', 'fork'],
        message: { author: { role: 'user' }, content: { parts: ['hello active branch'] }, metadata: {} },
      },
      a1: {
        parent: 'u1', children: ['a2'],
        message: { author: { role: 'assistant' }, content: { parts: ['active answer'] }, metadata: {} },
      },
      a2: {
        parent: 'a1', children: [],
        message: { author: { role: 'user' }, content: { parts: ['latest user turn'] }, metadata: {} },
      },
      fork: {
        parent: 'u1', children: [],
        message: { author: { role: 'assistant' }, content: { parts: ['x'.repeat(100_000)] }, metadata: {} },
      },
    },
  };
  const metrics = budget.extractConversationMetrics(payload);
  assert.equal(metrics.messageCount, 3);
  assert.ok(metrics.characters < 1_000);
  assert.ok(metrics.tokens > 10);
});


test('persistent context checkpoints survive shrink/reconcile and continue cumulative observation after restart', () => {
  const first = budget.buildContextCheckpoint({
    accountScope: 'acct-one',
    accountScopeSource: 'user-id',
    conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1',
    model: 'gpt-5.6-sol',
    snapshot: {
      historyTokens: 100_000,
      historyCharacters: 300_000,
      messageCount: 100,
      historyMeasurementSource: 'conversation-tree+dom-reconcile',
    },
    currentNode: 'node-a',
    measuredAt: '2026-08-29T03:00:00.000Z',
  });
  assert.equal(first.activeContextTokens, 100_000);
  assert.equal(first.cumulativeTokens, 100_000);

  const compressed = budget.buildContextCheckpoint({
    previous: first,
    accountScope: 'acct-one',
    accountScopeSource: 'user-id',
    conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1',
    model: 'gpt-5.6-sol',
    snapshot: {
      historyTokens: 70_000,
      historyCharacters: 210_000,
      messageCount: 70,
      historyMeasurementSource: 'conversation-tree+dom-reconcile',
    },
    currentNode: 'node-b',
    measuredAt: '2026-08-29T03:05:00.000Z',
  });
  assert.equal(compressed.activeContextTokens, 70_000);
  assert.equal(compressed.cumulativeTokens, 100_000);

  const continued = budget.buildContextCheckpoint({
    previous: compressed,
    accountScope: 'acct-one',
    accountScopeSource: 'user-id',
    conversationId: 'conv-1',
    conversationKey: 'conversation:conv-1',
    model: 'gpt-5.6-sol',
    snapshot: {
      historyTokens: 90_000,
      historyCharacters: 270_000,
      messageCount: 90,
      historyMeasurementSource: 'conversation-tree+dom-reconcile',
    },
    currentNode: 'node-c',
    measuredAt: '2026-08-29T03:10:00.000Z',
  });
  assert.equal(continued.activeContextTokens, 90_000);
  assert.equal(continued.cumulativeTokens, 120_000);
  assert.equal(continued.cumulativeMessages, 120);
});

test('context checkpoint keys isolate account, conversation and model', () => {
  const base = budget.checkpointStorageKey('acct-one', 'conv-one', 'gpt-5.6-sol');
  assert.ok(base?.startsWith('gptlock.context-state.v1:'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-two', 'conv-one', 'gpt-5.6-sol'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-one', 'conv-two', 'gpt-5.6-sol'));
  assert.notEqual(base, budget.checkpointStorageKey('acct-one', 'conv-one', 'gpt-5.4-mini'));
  assert.equal(budget.checkpointStorageKey(null, 'conv-one', 'gpt-5.6-sol'), null);
});

test('pending over-limit learning can resume after browser restart only with matching fresh evidence', () => {
  const startedAt = 1_000_000;
  const record = budget.serializePendingBypassRecord({
    startedAt,
    conversationKey: 'conversation:conv-one',
    preSnapshot: {
      usedTokens: 1_010_000,
      fullConversationCharacters: 3_000_000,
      conversationKey: 'conversation:conv-one',
      model: 'gpt-5.6-sol',
    },
    baselineAssistantCount: 100,
    model: 'gpt-5.6-sol',
    accountScope: 'acct-one',
    accountScopeSource: 'user-id',
    requestId: 'req-1',
    requestObserved: true,
    responseSeen: true,
    responseSuccessful: true,
  });
  assert.ok(record);
  const resumed = budget.restorePendingBypassRecord(record, {
    now: startedAt + 10_000,
    accountScope: 'acct-one',
    conversationKey: 'conversation:conv-one',
    model: 'gpt-5.6-sol',
  });
  assert.equal(resumed.requestObserved, true);
  assert.equal(resumed.preSnapshot.usedTokens, 1_010_000);
  assert.equal(resumed.learningStarted, false);

  assert.equal(budget.restorePendingBypassRecord(record, {
    now: record.expiresAt + 1,
    accountScope: 'acct-one',
    conversationKey: 'conversation:conv-one',
    model: 'gpt-5.6-sol',
  }), null);
  assert.equal(budget.restorePendingBypassRecord(record, {
    now: startedAt + 10_000,
    accountScope: 'acct-two',
    conversationKey: 'conversation:conv-one',
    model: 'gpt-5.6-sol',
  }), null);
});


test('recognizes ChatGPT real conversation-length boundary text in Chinese and English', () => {
  const zh = budget.classifyConversationLengthLimitText('你已到达此对话的长度上限，你可以开始新聊天以继续对话。');
  assert.equal(zh?.locale, 'zh-CN');
  const en = budget.classifyConversationLengthLimitText("You've reached the maximum length for this conversation. You can start a new chat to continue.");
  assert.equal(en?.locale, 'en');
  assert.equal(budget.classifyConversationLengthLimitText('我们正在讨论对话长度上限这个概念。'), null);
});

test('hard-limit learning records a reliable upper bound but refuses to convert DOM-only fallback into a fake token maximum', () => {
  const previous = budget.nextLearnedProfile({
    accountScope: 'acct-one', model: 'gpt-5.6-sol', confirmedConversationTokens: 100_000, baseSafeLimitTokens: 90_000,
  });
  const domOnly = budget.nextHardLimitProfile({
    previous, accountScope: 'acct-one', model: 'gpt-5.6-sol', observedConversationTokens: 112_000,
    measurementSource: 'dom-fallback', measurementReliable: false, conversationKey: 'conversation:one',
  });
  assert.equal(domOnly.hardLimitObserved, true);
  assert.equal(domOnly.hardLimitUpperBoundTokens || 0, 0);
  assert.equal(domOnly.hardLimitConfidence, 'ui-boundary-only');

  const measured = budget.nextHardLimitProfile({
    previous: domOnly, accountScope: 'acct-one', model: 'gpt-5.6-sol', observedConversationTokens: 128_000,
    measurementSource: 'conversation-tree+dom-reconcile', measurementReliable: true, conversationKey: 'conversation:one',
  });
  assert.equal(measured.hardLimitUpperBoundTokens, 128_000);
  assert.equal(measured.hardLimitConfidence, 'measured-upper-bound');

  const constrained = budget.computeBudget({
    historyTokens: 110_000, contextLimitTokens: 1_050_000, adaptiveSafeLimitTokens: 180_000,
    hardLimitUpperBoundTokens: measured.hardLimitUpperBoundTokens, confirmedLowerBoundTokens: measured.confirmedConversationTokens,
  });
  assert.equal(constrained.safeLimitTokens, 128_000);
  assert.equal(constrained.reserveTokens, 8_192);
  assert.equal(constrained.hardLimitActive, true);
});
