from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    source = p.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one target, found {count}: {old[:80]!r}")
    p.write_text(source.replace(old, new, 1))


def replace_between(path, start, end, replacement):
    p = Path(path)
    source = p.read_text()
    a = source.find(start)
    if a < 0:
        raise SystemExit(f"{path}: missing start marker: {start!r}")
    b = source.find(end, a)
    if b < 0:
        raise SystemExit(f"{path}: missing end marker: {end!r}")
    p.write_text(source[:a] + replacement + source[b:])


path = 'extension/context-budget.js'

# Remove all model-window/token/media/budget constants from the inspectable browser runtime.
replace_between(path, '  const MODEL_CONTEXT_WINDOWS = Object.freeze([\n', '  const REFRESH_DEBOUNCE_MS = 220;\n', '')
replace_between(path, '  const LEARNING_HEADROOM_RATIO = 0.06;\n', "  const CONTEXT_PROFILE_STORAGE_PREFIX = 'gptlock.context-profile.v1:';\n", '')

# Remove local window/token/budget math. Keep only generic stored-number validation.
replace_between(
    path,
    '  function contextWindowForModel(value) {\n',
    '  function conversationMessageText(message) {\n',
    '''  function storedMetric(value) {\n    const number = Number(value);\n    if (!Number.isFinite(number) || number <= 0) return 0;\n    return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(number));\n  }\n\n''',
)

# Conversation traversal now collects raw local parts and non-sensitive structural metrics only.
replace_between(
    path,
    '  function extractConversationMetrics(payload) {\n',
    '  function profileStorageKey(accountScope, model) {\n',
    '''  function extractConversationMetrics(payload) {\n    const messages = activeConversationMessages(payload);\n    if (!messages.length) return null;\n    let characters = 0;\n    let countedMessages = 0;\n    const privateHistoryParts = [];\n    for (const message of messages) {\n      const text = conversationMessageText(message);\n      const media = conversationMessageMediaCounts(message);\n      if (!text && media.images === 0 && media.attachments === 0) continue;\n      privateHistoryParts.push({ text, images: media.images, attachments: media.attachments });\n      characters += text.length;\n      countedMessages += 1;\n    }\n    if (!countedMessages) return null;\n    return {\n      characters: Math.max(0, Math.ceil(characters)),\n      messageCount: countedMessages,\n      currentNode: payload?.current_node ? String(payload.current_node).slice(0, 256) : null,\n      privateHistoryParts,\n    };\n  }\n\n''',
)

# Delete legacy numeric learning formula helpers. Profile math is private-engine-only now.
replace_between(path, '  function nextLearnedProfile({\n', '  function classifyConversationLengthLimitText(value) {\n', '')
replace_between(path, '  function nextHardLimitProfile({\n', '  function privateHistorySnapshot() {\n', '')

# Remove formula helpers from the public compatibility API.
for line in [
    '    contextWindowForModel,\n',
    '    estimateTextTokens,\n',
    '    computeBudget,\n',
    '    learningHeadroomTokens,\n',
    '    nextLearnedProfile,\n',
    '    nextHardLimitProfile,\n',
]:
    replace_once(path, line, '')

# DOM observation keeps characters only; tokenization lives in private-engine.
replace_between(
    path,
    '  function elementMetrics(element) {\n',
    '  function conversationElements() {\n',
    '''  function elementMetrics(element) {\n    return { characters: elementText(element).length };\n  }\n\n''',
)
replace_between(
    path,
    '  function assistantStats() {\n',
    '  function detectModel() {\n',
    '''  function assistantStats() {\n    const elements = assistantElements();\n    const last = elements[elements.length - 1] || null;\n    const lastMetrics = last ? elementMetrics(last) : { characters: 0 };\n    return {\n      count: elements.length,\n      lastCharacters: lastMetrics.characters,\n    };\n  }\n\n''',
)

# Remove stored-profile budget helpers and replace snapshotNow with a neutral collector snapshot.
replace_between(
    path,
    '  function activeAdaptiveLimit(model) {\n',
    '  function indicatorDetail(snapshot) {\n',
    '''  function snapshotNow() {\n    const messages = conversationElements();\n    const domHistoryCharacters = messages.reduce(\n      (total, element) => total + elementMetrics(element).characters,\n      0,\n    );\n    const conversationKey = currentConversationKey();\n    const cacheFresh = Boolean(\n      conversationMetricsCache\n      && conversationMetricsCache.conversationKey === conversationKey\n      && Date.now() - conversationMetricsCheckedAt <= CONVERSATION_METRICS_MAX_AGE_MS\n    );\n    const checkpointUsable = Boolean(\n      !cacheFresh\n      && restoredCheckpoint\n      && restoredCheckpoint.accountScope === currentAccountScope\n      && restoredCheckpoint.conversationKey === conversationKey\n    );\n    const historyCharacters = cacheFresh\n      ? Math.max(domHistoryCharacters, Number(conversationMetricsCache.characters) || 0)\n      : checkpointUsable\n        ? Math.max(domHistoryCharacters, Number(restoredCheckpoint.activeContextCharacters) || 0)\n        : domHistoryCharacters;\n    const historyMessageCount = cacheFresh\n      ? Math.max(messages.length, Number(conversationMetricsCache.messageCount) || 0)\n      : checkpointUsable\n        ? Math.max(messages.length, Number(restoredCheckpoint.activeMessageCount) || 0)\n        : messages.length;\n    const draft = composerText();\n    const model = detectModel();\n    const confirmedLowerBoundTokens = storedMetric(activeProfile?.confirmedConversationTokens);\n    const hardLimitUpperBoundTokens = storedMetric(activeProfile?.hardLimitUpperBoundTokens);\n    return {\n      nominalLimitTokens: 0,\n      baseSafeLimitTokens: 0,\n      adaptiveSafeLimitTokens: storedMetric(activeProfile?.adaptiveSafeLimitTokens),\n      hardLimitUpperBoundTokens,\n      confirmedLowerBoundTokens,\n      safeLimitTokens: 0,\n      reserveTokens: 0,\n      historyTokens: 0,\n      draftTokens: 0,\n      usedTokens: 0,\n      projectedTokens: 0,\n      percent: 0,\n      projectedPercent: 0,\n      remainingTokens: 0,\n      warning: false,\n      wouldExceed: false,\n      adaptiveActive: false,\n      hardLimitActive: false,\n      model,\n      contextWindowSource: 'private-engine-required',\n      messageCount: historyMessageCount,\n      historyCharacters,\n      historyMeasurementSource: cacheFresh\n        ? 'conversation-tree+dom-reconcile'\n        : checkpointUsable\n          ? 'checkpoint+dom-restore'\n          : 'dom-fallback',\n      checkpointRestored: checkpointUsable,\n      checkpointMeasuredAt: checkpointUsable ? restoredCheckpoint.lastMeasuredAt ?? null : null,\n      cumulativeConversationTokens: storedMetric(restoredCheckpoint?.cumulativeTokens),\n      cumulativeConversationCharacters: restoredCheckpoint\n        ? Math.max(historyCharacters, Number(restoredCheckpoint.cumulativeCharacters) || 0)\n        : historyCharacters,\n      cumulativeMessageCount: restoredCheckpoint\n        ? Math.max(historyMessageCount, Number(restoredCheckpoint.cumulativeMessages) || 0)\n        : historyMessageCount,\n      draftCharacters: draft.length,\n      fullConversationCharacters: historyCharacters + draft.length,\n      fullConversationTokens: 0,\n      conversationKey,\n      learnedConfirmedTokens: confirmedLowerBoundTokens,\n      learnedSuccessCount: Math.max(0, Number(activeProfile?.successfulBypassCount) || 0),\n      learnedAt: activeProfile?.lastConfirmedAt ?? null,\n      hardLimitVisible: Boolean(lastHardLimitNotice && lastHardLimitNotice.conversationKey === conversationKey),\n      hardLimitObservedTokens: storedMetric(activeProfile?.hardLimitObservedTokens),\n      hardLimitObservedCount: Math.max(0, Number(activeProfile?.hardLimitObservedCount) || 0),\n      hardLimitConfidence: activeProfile?.hardLimitConfidence ?? (lastHardLimitNotice ? 'ui-boundary-only' : null),\n      hardLimitMeasurementSource: activeProfile?.hardLimitMeasurementSource ?? null,\n      hardLimitLastObservedAt: activeProfile?.hardLimitLastObservedAt ?? null,\n      accountScopeAvailable: Boolean(currentAccountScope),\n      accountScopeSource: currentAccountScopeSource,\n      budgetAuthority: 'pending-private-engine',\n      budgetAvailable: false,\n      measuredAt: new Date().toISOString(),\n      estimateOnly: true,\n    };\n  }\n\n''',
)

# UI must never present neutral zeroes as a real estimate.
replace_between(
    path,
    '  function indicatorDetail(snapshot) {\n',
    '  function mountIndicatorRow(snapshot) {\n',
    '''  function indicatorDetail(snapshot) {\n    const historySource = snapshot.historyMeasurementSource === 'conversation-tree+dom-reconcile'\n      ? '完整活动分支'\n      : snapshot.historyMeasurementSource === 'checkpoint+dom-restore'\n        ? '本地检查点恢复'\n        : 'DOM 回退';\n    if (snapshot.budgetAuthority !== 'private-engine') {\n      const rows = [\n        '上下文额度：等待本地私有核心评估',\n        `当前活动聊天：${formatCompactNumber(snapshot.fullConversationCharacters)} 字符 · ${snapshot.messageCount} 条消息 · ${historySource}`,\n        `模型：${snapshot.model || '未识别'}`,\n        '安全策略：浏览器扩展不再执行模型窗口、token/media 权重或发送预算公式；私有核心不可用时正常聊天 fail-open，不生成伪 token 额度。',\n      ];\n      if (snapshot.learnedConfirmedTokens > 0) {\n        rows.push(`历史私有学习：已保存成功下限 ${formatCompactTokens(snapshot.learnedConfirmedTokens)} tokens（${snapshot.learnedSuccessCount} 次）`);\n      }\n      if (snapshot.hardLimitVisible) rows.push('ChatGPT 已显示真实“对话长度上限”提示；等待私有核心决定是否形成数值上界。');\n      return rows.join('\\n');\n    }\n\n    const rows = [\n      `上下文额度：${snapshot.percent.toFixed(1)}%（本地私有核心）`,\n      `当前完整聊天：约 ${formatCompactTokens(snapshot.fullConversationTokens)} tokens · ${formatCompactNumber(snapshot.fullConversationCharacters)} 字符 · ${snapshot.messageCount} 条消息 · ${historySource}`,\n      `基础安全预算：${formatCompactTokens(snapshot.baseSafeLimitTokens)} / 模型窗口 ${formatCompactTokens(snapshot.nominalLimitTokens)}`,\n    ];\n    if (snapshot.checkpointRestored) {\n      rows.push(`恢复状态：已从上次本地检查点恢复（${snapshot.checkpointMeasuredAt || '时间未知'}），正在与 ChatGPT 当前活动会话重新对账。`);\n    }\n    if (snapshot.cumulativeConversationTokens > snapshot.fullConversationTokens || snapshot.cumulativeMessageCount > snapshot.messageCount) {\n      rows.push(`会话累计观测：约 ${formatCompactTokens(snapshot.cumulativeConversationTokens)} tokens · ${formatCompactNumber(snapshot.cumulativeConversationCharacters)} 字符 · ${snapshot.cumulativeMessageCount} 条消息`);\n    }\n    if (snapshot.hardLimitVisible || snapshot.hardLimitObservedCount > 0) {\n      if (snapshot.hardLimitUpperBoundTokens > snapshot.confirmedLowerBoundTokens) {\n        const lower = snapshot.confirmedLowerBoundTokens > 0 ? `；已确认成功下限 ≥ ${formatCompactTokens(snapshot.confirmedLowerBoundTokens)}` : '';\n        rows.push(`ChatGPT 实测会话硬上限：≤ ${formatCompactTokens(snapshot.hardLimitUpperBoundTokens)} tokens${lower}`);\n      } else {\n        rows.push('ChatGPT 已检测到真实“对话长度上限”提示；当前没有可用的可信数值上界。');\n      }\n    }\n    if (snapshot.adaptiveActive) {\n      rows.push(\n        `账户实测成功下限：至少 ${formatCompactTokens(snapshot.learnedConfirmedTokens)} tokens（${snapshot.learnedSuccessCount} 次超限成功）`,\n        `当前自适应发送预算：${formatCompactTokens(snapshot.safeLimitTokens)} tokens`,\n      );\n    } else {\n      rows.push(`当前发送预算：${formatCompactTokens(snapshot.safeLimitTokens)} tokens`);\n    }\n    rows.push(\n      `预留回复：${formatCompactTokens(snapshot.reserveTokens)}`,\n      `剩余发送预算：约 ${formatCompactTokens(snapshot.remainingTokens)}`,\n      `模型：${snapshot.model || '未识别'} · 本地私有核心`,\n      snapshot.accountScopeAvailable\n        ? '账户学习：已建立本地匿名账户范围；数值学习由本地私有核心完成。'\n        : '账户学习：尚未识别当前 ChatGPT 账户；识别成功前不会跨账户学习。',\n      '说明：浏览器只采集当前活动 conversation tree、DOM 与媒体计数；模型窗口、token 估算、预算和学习数值均由本地编译私有核心计算。',\n    );\n    return rows.join('\\n');\n  }\n\n''',
)
replace_once(
    path,
    "    row.dataset.status = snapshot.wouldExceed ? 'danger' : snapshot.warning ? 'warning' : 'safe';\n    const value = row.querySelector('.model-value');\n    if (value) {\n      const adaptiveMark = snapshot.adaptiveActive ? '↗' : '';\n      value.textContent = `${snapshot.percent.toFixed(snapshot.percent < 10 ? 1 : 0)}%${adaptiveMark} · 约${formatCompactTokens(snapshot.remainingTokens)}余`;\n    }\n",
    "    const hasPrivateBudget = snapshot.budgetAuthority === 'private-engine';\n    row.dataset.status = hasPrivateBudget && snapshot.wouldExceed ? 'danger' : hasPrivateBudget && snapshot.warning ? 'warning' : 'safe';\n    const value = row.querySelector('.model-value');\n    if (value) {\n      if (hasPrivateBudget) {\n        const adaptiveMark = snapshot.adaptiveActive ? '↗' : '';\n        value.textContent = `${snapshot.percent.toFixed(snapshot.percent < 10 ? 1 : 0)}%${adaptiveMark} · 约${formatCompactTokens(snapshot.remainingTokens)}余`;\n      } else {\n        value.textContent = '等待私有核心';\n      }\n    }\n",
)

# Only private-engine token measurements may update token checkpoints; include authority in change fingerprint.
replace_once(
    path,
    "      ? `${Math.round(lastSnapshot.percent * 10)}:${lastSnapshot.model}:${lastSnapshot.messageCount}:${lastSnapshot.wouldExceed}:${lastSnapshot.safeLimitTokens}`\n",
    "      ? `${Math.round(lastSnapshot.percent * 10)}:${lastSnapshot.model}:${lastSnapshot.messageCount}:${lastSnapshot.wouldExceed}:${lastSnapshot.safeLimitTokens}:${lastSnapshot.budgetAuthority}`\n",
)
replace_once(
    path,
    "    if (next.historyMeasurementSource === 'conversation-tree+dom-reconcile') {\n      queueConversationCheckpointPersist(next);\n    }\n",
    "    if (next.historyMeasurementSource === 'conversation-tree+dom-reconcile' && next.budgetAuthority === 'private-engine') {\n      queueConversationCheckpointPersist(next);\n    }\n",
)
replace_once(
    path,
    "    const fingerprint = `${Math.round(next.percent * 10)}:${next.model}:${next.messageCount}:${next.wouldExceed}:${next.safeLimitTokens}`;\n",
    "    const fingerprint = `${Math.round(next.percent * 10)}:${next.model}:${next.messageCount}:${next.wouldExceed}:${next.safeLimitTokens}:${next.budgetAuthority}`;\n",
)
replace_once(
    path,
    "      const next = snapshotNow();\n      publishSnapshot(next);\n      if (notice) void persistHardLimitObservation(next, lastHardLimitNotice);\n",
    "      publishSnapshot(snapshotNow());\n      if (notice) void persistHardLimitObservation(lastSnapshot, lastHardLimitNotice);\n",
)

# Hard-limit learning is private numeric first; without it, record metadata only and never derive a new cap in JS.
source = Path(path).read_text()
start = source.index("      const privateNumbers = await evaluatePrivateContextProfile('hard_limit', {")
end = source.index('      if (!next) return null;\n', start)
replacement = '''      const privateNumbers = await evaluatePrivateContextProfile('hard_limit', {\n        model,\n        previous,\n        observedConversationTokens: observedTokens,\n        measurementReliable,\n      });\n      let next;\n      if (privateNumbers) {\n        next = {\n          ...(previous && typeof previous === 'object' ? previous : {}),\n          schemaVersion: 1,\n          accountScope: currentAccountScope,\n          accountScopeSource: currentAccountScopeSource || 'unknown',\n          model,\n          hardLimitObserved: true,\n          hardLimitObservedCount: privateNumbers.hardLimitObservedCount,\n          hardLimitObservedTokens: observedTokens,\n          hardLimitObservedCharacters: Math.max(0, Math.ceil(Number(observedCharacters) || 0)),\n          hardLimitObservedMessages: Math.max(0, Math.ceil(Number(observedMessages) || 0)),\n          hardLimitUpperBoundTokens: privateNumbers.hardLimitUpperBoundTokens,\n          hardLimitTokenCapUsable: privateNumbers.hardLimitTokenCapUsable,\n          hardLimitConfidence: privateNumbers.hardLimitConfidence,\n          hardLimitMeasurementSource: String(snapshot.historyMeasurementSource || 'unknown').slice(0, 80),\n          hardLimitLastObservedAt: measuredAt,\n          hardLimitLastConversationKey: String(snapshot.conversationKey || 'unknown').slice(0, 256),\n          hardLimitLastText: String(notice.text || '').replace(/\\s+/g, ' ').trim().slice(0, 500),\n          hardLimitActionText: String(notice.actionText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),\n          hardLimitEvidence: 'chatgpt-visible-conversation-length-limit',\n          numericDerivation: 'private-engine',\n        };\n      } else {\n        next = {\n          ...(previous && typeof previous === 'object' ? previous : {}),\n          schemaVersion: 1,\n          accountScope: currentAccountScope,\n          accountScopeSource: currentAccountScopeSource || 'unknown',\n          model,\n          hardLimitObserved: true,\n          hardLimitObservedCount: Math.max(0, Math.floor(Number(previous?.hardLimitObservedCount) || 0)) + 1,\n          hardLimitObservedTokens: storedMetric(observedTokens),\n          hardLimitObservedCharacters: Math.max(0, Math.ceil(Number(observedCharacters) || 0)),\n          hardLimitObservedMessages: Math.max(0, Math.ceil(Number(observedMessages) || 0)),\n          hardLimitUpperBoundTokens: storedMetric(previous?.hardLimitUpperBoundTokens),\n          hardLimitTokenCapUsable: previous?.hardLimitTokenCapUsable === true,\n          hardLimitConfidence: 'ui-boundary-only',\n          hardLimitMeasurementSource: String(snapshot.historyMeasurementSource || 'unknown').slice(0, 80),\n          hardLimitLastObservedAt: measuredAt,\n          hardLimitLastConversationKey: String(snapshot.conversationKey || 'unknown').slice(0, 256),\n          hardLimitLastText: String(notice.text || '').replace(/\\s+/g, ' ').trim().slice(0, 500),\n          hardLimitActionText: String(notice.actionText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),\n          hardLimitEvidence: 'chatgpt-visible-conversation-length-limit',\n          numericDerivation: 'unavailable',\n        };\n      }\n'''
Path(path).write_text(source[:start] + replacement + source[end:])

# Successful-bypass learning has no JS numeric fallback anymore.
source = Path(path).read_text()
start = source.index("      const privateNumbers = await evaluatePrivateContextProfile('successful_bypass', {")
end = source.index('      if (!next) {\n', start)
replacement = '''      const privateNumbers = await evaluatePrivateContextProfile('successful_bypass', {\n        model,\n        previous,\n        confirmedConversationTokens,\n        confirmedCharacters,\n      });\n      if (!privateNumbers) {\n        await discardPendingBypass();\n        return null;\n      }\n      const next = {\n        ...(previous && typeof previous === 'object' ? previous : {}),\n        schemaVersion: 1,\n        accountScope,\n        accountScopeSource,\n        model,\n        confirmedConversationTokens: privateNumbers.confirmedConversationTokens,\n        confirmedCharacters: privateNumbers.confirmedCharacters,\n        adaptiveSafeLimitTokens: privateNumbers.adaptiveSafeLimitTokens,\n        successfulBypassCount: privateNumbers.successfulBypassCount,\n        firstConfirmedAt: previous?.firstConfirmedAt || measuredAt,\n        lastConfirmedAt: measuredAt,\n        lastConversationKey: String(postSnapshot.conversationKey || 'unknown').slice(0, 256),\n        evidence: 'explicit-over-limit-send+formal-request+settled-assistant-turn',\n        numericDerivation: 'private-engine',\n      };\n'''
Path(path).write_text(source[:start] + replacement + source[end:])
# The old if (!next) block is now dead/unreachable and refers only to a guaranteed object; remove it.
replace_once(
    path,
    '''      if (!next) {\n        await discardPendingBypass();\n        return null;\n      }\n''',
    '',
)

# Stability detection must not depend on a browser token estimator.
replace_once(path, '    if (assistant.count <= pending.baselineAssistantCount || assistant.lastTokens <= 0) return;\n', '    if (assistant.count <= pending.baselineAssistantCount || assistant.lastCharacters <= 0) return;\n')
replace_once(path, '    const signature = `${assistant.count}:${assistant.lastTokens}:${assistant.lastCharacters}`;\n', '    const signature = `${assistant.count}:${assistant.lastCharacters}`;\n')

# Any remaining generic stored-number uses must not refer to the removed adaptive clamp.
source = Path(path).read_text().replace('clampAdaptiveLimit(', 'storedMetric(')
Path(path).write_text(source)

# Private authority explicitly marks a real numeric result as available.
replace_once(
    'extension/private-context-budget-authority.js',
    "      budgetAuthority: 'private-engine',\n      privateBudgetCoverage: meta.coverage || 'conversation-tree',\n",
    "      budgetAuthority: 'private-engine',\n      budgetAvailable: true,\n      privateBudgetCoverage: meta.coverage || 'conversation-tree',\n",
)

# Rewrite legacy formula tests as collector/storage/boundary tests.
Path('extension/tests/context-budget.test.mjs').write_text(r'''import assert from 'node:assert/strict';
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
''')

Path('extension/tests/private-context-profile-integration.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../context-budget.js', import.meta.url), 'utf8');

test('successful bypass numeric learning requires private engine and has no browser formula fallback', () => {
  const start = source.indexOf('async function persistLearnedProfile');
  const end = source.indexOf('async function maybeFinalizeBypassLearning', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('successful_bypass'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /if \(!privateNumbers\)/);
  assert.doesNotMatch(block, /nextLearnedProfile|learningHeadroom|SAFETY_BUDGET_RATIO|contextWindowForModel/);
});

test('hard-limit fallback records metadata only and never derives a new numeric cap in browser', () => {
  const start = source.indexOf('async function persistHardLimitObservation');
  const end = source.indexOf('async function refreshAccountScope', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('hard_limit'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /numericDerivation: 'unavailable'/);
  assert.match(block, /hardLimitUpperBoundTokens: storedMetric\(previous\?\.hardLimitUpperBoundTokens\)/);
  assert.doesNotMatch(block, /nextHardLimitProfile|LEARNING_HEADROOM_RATIO|SAFETY_BUDGET_RATIO/);
});

test('checkpoint persistence accepts token state only after private authority overlay', () => {
  const start = source.indexOf('function publishSnapshot');
  const end = source.indexOf('function recompute', start);
  const block = source.slice(start, end);
  assert.match(block, /next\.budgetAuthority === 'private-engine'/);
});

test('hard-limit learning consumes the authority-overlaid last snapshot', () => {
  const start = source.indexOf('function recompute');
  const end = source.indexOf('function scheduleRefresh', start);
  const block = source.slice(start, end);
  assert.match(block, /publishSnapshot\(snapshotNow\(\)\)/);
  assert.match(block, /persistHardLimitObservation\(lastSnapshot/);
});
''')

# Final hard guard: inspectable context shell must contain no proprietary numeric implementation markers.
source = Path(path).read_text()
for marker in [
    'MODEL_CONTEXT_WINDOWS', 'SAFETY_BUDGET_RATIO', 'MESSAGE_OVERHEAD_TOKENS',
    'IMAGE_TOKEN_ESTIMATE', 'ATTACHMENT_TOKEN_ESTIMATE', 'LEARNING_HEADROOM_RATIO',
    'LEARNING_HEADROOM_MIN_TOKENS', 'LEARNING_HEADROOM_MAX_TOKENS', 'MAX_ADAPTIVE_LIMIT_TOKENS',
    'function estimateTextTokens', 'function computeBudget', 'function nextLearnedProfile',
    'function nextHardLimitProfile', '1_050_000', '924_000',
]:
    if marker in source:
        raise SystemExit(f'context-budget.js still contains private math marker: {marker}')
