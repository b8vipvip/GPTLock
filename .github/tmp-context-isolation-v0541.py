from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# context-budget.js: isolate restored/checkpoint state by account + conversation + model,
# and make SPA navigation/request races explicit.
path = 'extension/context-budget.js'
replace_once(path,
"""  let conversationMetricsPromise = null;\n  let restoredCheckpoint = null;\n""",
"""  let conversationMetricsPromise = null;\n  let conversationMetricsPromiseKey = null;\n  let conversationMetricsRequestSequence = 0;\n  let observedConversationKey = null;\n  let restoredCheckpoint = null;\n""")

replace_once(path,
"""  function pendingBypassStorageKey(accountScope, conversationId, model) {\n    const account = String(accountScope ?? '').trim();\n    const conversation = String(conversationId ?? '').trim();\n    const normalizedModel = normalizeModelId(model);\n    if (!account || !conversation || !normalizedModel) return null;\n    return `${PENDING_BYPASS_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;\n  }\n\n""",
"""  function pendingBypassStorageKey(accountScope, conversationId, model) {\n    const account = String(accountScope ?? '').trim();\n    const conversation = String(conversationId ?? '').trim();\n    const normalizedModel = normalizeModelId(model);\n    if (!account || !conversation || !normalizedModel) return null;\n    return `${PENDING_BYPASS_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;\n  }\n\n  function checkpointMatchesContext(checkpoint, {\n    accountScope,\n    conversationId,\n    conversationKey,\n    model,\n  } = {}) {\n    if (!checkpoint || typeof checkpoint !== 'object') return false;\n    const account = String(accountScope ?? '').trim();\n    const conversation = String(conversationId ?? '').trim();\n    const key = String(conversationKey ?? '').trim();\n    const normalizedModel = normalizeModelId(model);\n    if (!account || !conversation || !key || !normalizedModel) return false;\n    return checkpoint.accountScope === account\n      && checkpoint.conversationId === conversation\n      && checkpoint.conversationKey === key\n      && normalizeModelId(checkpoint.model) === normalizedModel;\n  }\n\n""")

replace_once(path,
"""    checkpointStorageKey,\n    pendingBypassStorageKey,\n""",
"""    checkpointStorageKey,\n    checkpointMatchesContext,\n    pendingBypassStorageKey,\n""")

replace_once(path,
"""      if (\n        checkpoint\n        && checkpoint.accountScope === currentAccountScope\n        && checkpoint.conversationId === conversationId\n        && normalizeModelId(checkpoint.model) === normalizeModelId(model)\n      ) {\n        restoredCheckpoint = checkpoint;\n      } else {\n""",
"""      if (checkpointMatchesContext(checkpoint, {\n        accountScope: currentAccountScope,\n        conversationId,\n        conversationKey: currentConversationKey(),\n        model,\n      })) {\n        restoredCheckpoint = checkpoint;\n      } else {\n""")

replace_once(path,
"""      const stored = restoredCheckpointKey === key && restoredCheckpoint\n        ? { [key]: restoredCheckpoint }\n        : await chrome.storage.local.get(key);\n""",
"""      const inMemoryCheckpointUsable = restoredCheckpointKey === key\n        && checkpointMatchesContext(restoredCheckpoint, {\n          accountScope: currentAccountScope,\n          conversationId,\n          conversationKey: snapshot.conversationKey,\n          model,\n        });\n      const stored = inMemoryCheckpointUsable\n        ? { [key]: restoredCheckpoint }\n        : await chrome.storage.local.get(key);\n""")

old_refresh = """  async function refreshConversationMetrics(force = false) {\n    const conversationId = currentConversationId();\n    const conversationKey = currentConversationKey();\n    if (!conversationId) {\n      conversationMetricsCache = null;\n      conversationMetricsCheckedAt = Date.now();\n      return null;\n    }\n    const now = Date.now();\n    if (\n      !force\n      && conversationMetricsCache?.conversationKey === conversationKey\n      && now - conversationMetricsCheckedAt < CONVERSATION_METRICS_REFRESH_MS\n    ) return conversationMetricsCache;\n    if (conversationMetricsPromise) return conversationMetricsPromise;\n    conversationMetricsPromise = (async () => {\n      const metrics = await fetchConversationMetrics(conversationId);\n      conversationMetricsCheckedAt = Date.now();\n      if (metrics && currentConversationKey() === conversationKey) {\n        conversationMetricsCache = { ...metrics, conversationKey, measuredAt: new Date().toISOString() };\n        scheduleRefresh();\n      }\n      return conversationMetricsCache;\n    })().finally(() => {\n      conversationMetricsPromise = null;\n    });\n    return conversationMetricsPromise;\n  }\n"""
new_refresh = """  async function refreshConversationMetrics(force = false) {\n    const conversationId = currentConversationId();\n    const conversationKey = currentConversationKey();\n    if (!conversationId) {\n      conversationMetricsRequestSequence += 1;\n      conversationMetricsPromise = null;\n      conversationMetricsPromiseKey = null;\n      conversationMetricsCache = null;\n      conversationMetricsCheckedAt = Date.now();\n      return null;\n    }\n    const now = Date.now();\n    if (\n      !force\n      && conversationMetricsCache?.conversationKey === conversationKey\n      && now - conversationMetricsCheckedAt < CONVERSATION_METRICS_REFRESH_MS\n    ) return conversationMetricsCache;\n    if (conversationMetricsPromise && conversationMetricsPromiseKey === conversationKey) {\n      return conversationMetricsPromise;\n    }\n\n    const requestSequence = ++conversationMetricsRequestSequence;\n    const requestPromise = (async () => {\n      const metrics = await fetchConversationMetrics(conversationId);\n      if (requestSequence !== conversationMetricsRequestSequence || currentConversationKey() !== conversationKey) {\n        return null;\n      }\n      conversationMetricsCheckedAt = Date.now();\n      if (metrics) {\n        conversationMetricsCache = { ...metrics, conversationKey, measuredAt: new Date().toISOString() };\n        scheduleRefresh();\n      }\n      return conversationMetricsCache;\n    })();\n    conversationMetricsPromise = requestPromise;\n    conversationMetricsPromiseKey = conversationKey;\n    try {\n      return await requestPromise;\n    } finally {\n      if (conversationMetricsPromise === requestPromise) {\n        conversationMetricsPromise = null;\n        conversationMetricsPromiseKey = null;\n      }\n    }\n  }\n"""
replace_once(path, old_refresh, new_refresh)

replace_once(path,
"""    const conversationKey = currentConversationKey();\n    const cacheFresh = Boolean(\n      conversationMetricsCache\n      && conversationMetricsCache.conversationKey === conversationKey\n      && Date.now() - conversationMetricsCheckedAt <= CONVERSATION_METRICS_MAX_AGE_MS\n    );\n    const checkpointUsable = Boolean(\n      !cacheFresh\n      && restoredCheckpoint\n      && restoredCheckpoint.accountScope === currentAccountScope\n      && restoredCheckpoint.conversationKey === conversationKey\n    );\n""",
"""    const conversationKey = currentConversationKey();\n    const conversationId = currentConversationId();\n    const model = detectModel();\n    const cacheFresh = Boolean(\n      conversationMetricsCache\n      && conversationMetricsCache.conversationKey === conversationKey\n      && Date.now() - conversationMetricsCheckedAt <= CONVERSATION_METRICS_MAX_AGE_MS\n    );\n    const checkpointMatched = checkpointMatchesContext(restoredCheckpoint, {\n      accountScope: currentAccountScope,\n      conversationId,\n      conversationKey,\n      model,\n    });\n    const checkpointUsable = Boolean(!cacheFresh && checkpointMatched);\n""")

replace_once(path,
"""    const draft = composerText();\n    const model = detectModel();\n""",
"""    const draft = composerText();\n""")

replace_once(path,
"""      checkpointRestored: checkpointUsable,\n      checkpointMeasuredAt: checkpointUsable ? restoredCheckpoint.lastMeasuredAt ?? null : null,\n      cumulativeConversationTokens: storedMetric(restoredCheckpoint?.cumulativeTokens),\n      cumulativeConversationCharacters: restoredCheckpoint\n        ? Math.max(historyCharacters, Number(restoredCheckpoint.cumulativeCharacters) || 0)\n        : historyCharacters,\n      cumulativeMessageCount: restoredCheckpoint\n        ? Math.max(historyMessageCount, Number(restoredCheckpoint.cumulativeMessages) || 0)\n        : historyMessageCount,\n""",
"""      checkpointRestored: checkpointUsable,\n      checkpointMatched,\n      checkpointMeasuredAt: checkpointMatched ? restoredCheckpoint.lastMeasuredAt ?? null : null,\n      cumulativeConversationTokens: checkpointMatched ? storedMetric(restoredCheckpoint.cumulativeTokens) : 0,\n      cumulativeConversationCharacters: checkpointMatched\n        ? Math.max(historyCharacters, Number(restoredCheckpoint.cumulativeCharacters) || 0)\n        : historyCharacters,\n      cumulativeMessageCount: checkpointMatched\n        ? Math.max(historyMessageCount, Number(restoredCheckpoint.cumulativeMessages) || 0)\n        : historyMessageCount,\n""")

replace_once(path,
"""  function recompute() {\n    refreshTimer = null;\n    try {\n      const notice = findVisibleConversationLengthLimit();\n""",
"""  function recompute() {\n    refreshTimer = null;\n    try {\n      ensureConversationNavigation();\n      const notice = findVisibleConversationLengthLimit();\n""")

old_nav = """  function handleConversationNavigation() {\n    // Detach only. The old conversation's pending record remains recoverable until its TTL expires.\n    pendingBypass = null;\n    restoredPendingKey = null;\n    restoredCheckpoint = null;\n    restoredCheckpointKey = null;\n    conversationMetricsCache = null;\n    conversationMetricsCheckedAt = 0;\n    lastHardLimitNotice = null;\n    lastHardLimitFingerprint = null;\n    scheduleRefresh();\n    void refreshAccountScope(true).then(() => {\n      void loadConversationCheckpoint();\n      void restorePendingBypass();\n    });\n    void refreshConversationMetrics(true);\n  }\n  window.addEventListener('popstate', handleConversationNavigation);\n  window.addEventListener('hashchange', handleConversationNavigation);\n"""
new_nav = """  function resetConversationScopedState() {\n    // Detach only. The old conversation's pending record remains recoverable until its TTL expires.\n    pendingBypass = null;\n    restoredPendingKey = null;\n    restoredCheckpoint = null;\n    restoredCheckpointKey = null;\n    checkpointLoadSequence += 1;\n    conversationMetricsRequestSequence += 1;\n    conversationMetricsPromise = null;\n    conversationMetricsPromiseKey = null;\n    conversationMetricsCache = null;\n    conversationMetricsCheckedAt = 0;\n    lastHardLimitNotice = null;\n    lastHardLimitFingerprint = null;\n  }\n\n  function handleConversationNavigation() {\n    const nextConversationKey = currentConversationKey();\n    if (observedConversationKey === nextConversationKey) return false;\n    observedConversationKey = nextConversationKey;\n    resetConversationScopedState();\n    scheduleRefresh();\n    void refreshAccountScope(true).then(() => {\n      if (observedConversationKey !== nextConversationKey) return;\n      void loadConversationCheckpoint();\n      void restorePendingBypass();\n    });\n    void refreshConversationMetrics(true);\n    return true;\n  }\n\n  function ensureConversationNavigation() {\n    const nextConversationKey = currentConversationKey();\n    if (observedConversationKey === null) {\n      observedConversationKey = nextConversationKey;\n      return false;\n    }\n    if (observedConversationKey === nextConversationKey) return false;\n    return handleConversationNavigation();\n  }\n\n  observedConversationKey = currentConversationKey();\n  window.addEventListener('popstate', handleConversationNavigation);\n  window.addEventListener('hashchange', handleConversationNavigation);\n"""
replace_once(path, old_nav, new_nav)

replace_once(path,
"""  document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState === 'visible') {\n      void refreshAccountScope(true);\n      void refreshConversationMetrics(true);\n    }\n  });\n""",
"""  document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState === 'visible') {\n      ensureConversationNavigation();\n      void refreshAccountScope(true);\n      void refreshConversationMetrics(true);\n    }\n  });\n""")

# Remaining indicator: keep one decimal, expose diagnostic hashing, and emit privacy-safe snapshots.
path = 'extension/chat-length-remaining-indicator.js'
replace_once(path,
"""  const REFRESH_MS = 750;\n""",
"""  const REFRESH_MS = 750;\n  const DIAGNOSTIC_MIN_INTERVAL_MS = 5_000;\n""")

replace_once(path,
"""  function formatPercent(value) {\n    const percent = clampPercent(value);\n    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;\n    if (percent < 10) return `${percent.toFixed(1)}%`;\n    return `${Math.round(percent)}%`;\n  }\n""",
"""  function formatPercent(value) {\n    const percent = clampPercent(value);\n    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;\n    return `${percent.toFixed(1)}%`;\n  }\n""")

replace_once(path,
"""  function calculateRemainingPercent({ snapshot = null, profile = null, hardLimitVisible = false, localBudget = null } = {}) {\n""",
"""  function diagnosticConversationHash(value) {\n    const text = String(value ?? 'unknown');\n    let hash = 0x811c9dc5;\n    for (let index = 0; index < text.length; index += 1) {\n      hash ^= text.charCodeAt(index);\n      hash = Math.imul(hash, 0x01000193) >>> 0;\n    }\n    return `ctx-${hash.toString(16).padStart(8, '0')}`;\n  }\n\n  function buildDiagnosticDetails(snapshot, localBudget, result) {\n    return {\n      conversationHash: diagnosticConversationHash(snapshot?.conversationKey),\n      model: normalizeModelId(snapshot?.model),\n      remainingPercent: Number(clampPercent(result?.percent).toFixed(2)),\n      remainingDisplay: formatPercent(result?.percent),\n      remainingSource: String(result?.source || 'unknown'),\n      measurementSource: String(localBudget?.measurementSource || 'unknown'),\n      historyTokens: Math.max(0, Math.ceil(Number(localBudget?.historyTokens) || 0)),\n      historyCharacters: Math.max(0, Math.ceil(Number(localBudget?.historyCharacters) || 0)),\n      historyMessages: Math.max(0, Math.ceil(Number(localBudget?.historyMessages) || 0)),\n      cumulativeTokens: Math.max(0, Math.ceil(Number(localBudget?.cumulativeTokens) || 0)),\n      cumulativeCharacters: Math.max(0, Math.ceil(Number(localBudget?.cumulativeCharacters) || 0)),\n      cumulativeMessages: Math.max(0, Math.ceil(Number(localBudget?.cumulativeMessages) || 0)),\n      checkpointMatched: snapshot?.checkpointMatched === true,\n      checkpointRestored: snapshot?.checkpointRestored === true,\n      hardLimitObservedCount: Math.max(0, Math.floor(Number(snapshot?.hardLimitObservedCount) || 0)),\n    };\n  }\n\n  function calculateRemainingPercent({ snapshot = null, profile = null, hardLimitVisible = false, localBudget = null } = {}) {\n""")

replace_once(path,
"""    calculateRemainingPercent,\n  });\n""",
"""    calculateRemainingPercent,\n    diagnosticConversationHash,\n    buildDiagnosticDetails,\n  });\n""")

replace_once(path,
"""  let rootObserver = null;\n  let observedRoot = null;\n  let refreshQueued = false;\n""",
"""  let rootObserver = null;\n  let observedRoot = null;\n  let refreshQueued = false;\n  let lastDiagnosticFingerprint = '';\n  let lastDiagnosticAt = 0;\n""")

replace_once(path,
"""      measurementSource: measured.source,\n      cumulativeTokens: Math.max(measured.tokens, Number(snapshot?.cumulativeConversationTokens) || 0),\n""",
"""      measurementSource: measured.source,\n      historyCharacters: measured.characters,\n      historyMessages: measured.messages,\n      cumulativeTokens: Math.max(measured.tokens, Number(snapshot?.cumulativeConversationTokens) || 0),\n""")

replace_once(path,
"""  function detailText(result, localBudget) {\n""",
"""  function maybeLogDiagnostic(details) {\n    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;\n    const fingerprint = [\n      details.conversationHash,\n      details.remainingDisplay,\n      details.remainingSource,\n      details.measurementSource,\n      details.historyTokens,\n      details.cumulativeTokens,\n      details.cumulativeCharacters,\n      details.cumulativeMessages,\n      details.checkpointMatched,\n    ].join(':');\n    if (fingerprint === lastDiagnosticFingerprint) return;\n    const now = Date.now();\n    if (lastDiagnosticAt && now - lastDiagnosticAt < DIAGNOSTIC_MIN_INTERVAL_MS) return;\n    lastDiagnosticFingerprint = fingerprint;\n    lastDiagnosticAt = now;\n    void chrome.runtime.sendMessage({\n      type: 'GPTLOCK_CONTEXT_BUDGET_DIAGNOSTIC',\n      details,\n    }).catch(() => {});\n  }\n\n  function detailText(result, localBudget, snapshot) {\n    const scope = `\\n统计范围：仅当前对话（${diagnosticConversationHash(snapshot?.conversationKey)}）`;\n""")

replace_once(path,
"""      return '聊天长度剩余：0%\\nChatGPT 已明确提示当前对话达到长度上限，因此当前聊天剩余长度直接记为 0%。';\n""",
"""      return `聊天长度剩余：0%\\nChatGPT 已明确提示当前对话达到长度上限，因此当前聊天剩余长度直接记为 0%。${scope}`;\n""")
replace_once(path,
"""      return `聊天长度剩余：${formatPercent(result.percent)}\\n沿用已验证逻辑：基于该账户/模型此前真实“对话长度上限”样本，按累计 token/字符/消息规模取最保守剩余比例。`;\n""",
"""      return `聊天长度剩余：${formatPercent(result.percent)}\\n沿用已验证逻辑：基于该账户/模型此前真实“对话长度上限”样本，按当前对话自己的累计 token/字符/消息规模取最保守剩余比例。${scope}`;\n""")
replace_once(path,
"""      return `聊天长度剩余：${formatPercent(result.percent)}\\n沿用已验证的本地上下文估算逻辑；当前按${source}和模型安全预算计算，不依赖私有核心返回 remainingPercent。`;\n""",
"""      return `聊天长度剩余：${formatPercent(result.percent)}\\n沿用已验证的本地上下文估算逻辑；当前按${source}和模型安全预算计算，不依赖私有核心返回 remainingPercent。${scope}`;\n""")
replace_once(path,
"""    return '聊天长度剩余：未知\\n当前页面尚没有足够聊天内容用于估算。';\n""",
"""    return `聊天长度剩余：未知\\n当前页面尚没有足够聊天内容用于估算。${scope}`;\n""")

replace_once(path,
"""    const result = calculateRemainingPercent({ snapshot, profile, hardLimitVisible, localBudget });\n\n    const host = document.getElementById('gptlock-model-indicator-host');\n""",
"""    const result = calculateRemainingPercent({ snapshot, profile, hardLimitVisible, localBudget });\n    const diagnosticDetails = buildDiagnosticDetails(snapshot, localBudget, result);\n    maybeLogDiagnostic(diagnosticDetails);\n\n    const host = document.getElementById('gptlock-model-indicator-host');\n""")

replace_once(path,
"""    const detail = detailText(result, localBudget);\n""",
"""    const detail = detailText(result, localBudget, snapshot);\n""")

# background: accept only a strict, content-free diagnostic shape from the content script.
path = 'extension/background.js'
replace_once(path,
"""      case 'GPTLOCK_CONTEXT_CHANGED': {\n""",
"""      case 'GPTLOCK_CONTEXT_BUDGET_DIAGNOSTIC': {\n        if (!sender.tab?.id) throw new Error('Context budget diagnostic requires a tab');\n        const details = message.details && typeof message.details === 'object' ? message.details : {};\n        const numberOrZero = (value) => {\n          const number = Number(value);\n          return Number.isFinite(number) && number > 0 ? number : 0;\n        };\n        logRuntime('info', 'context-budget', 'remaining_snapshot', {\n          tabId: sender.tab.id,\n          conversationHash: String(details.conversationHash || 'ctx-unknown').slice(0, 32),\n          model: String(details.model || '').slice(0, 128) || null,\n          remainingPercent: Math.min(100, Math.max(0, Number(details.remainingPercent) || 0)),\n          remainingDisplay: String(details.remainingDisplay || '').slice(0, 16),\n          remainingSource: String(details.remainingSource || 'unknown').slice(0, 80),\n          measurementSource: String(details.measurementSource || 'unknown').slice(0, 80),\n          historyTokens: numberOrZero(details.historyTokens),\n          historyCharacters: numberOrZero(details.historyCharacters),\n          historyMessages: numberOrZero(details.historyMessages),\n          cumulativeTokens: numberOrZero(details.cumulativeTokens),\n          cumulativeCharacters: numberOrZero(details.cumulativeCharacters),\n          cumulativeMessages: numberOrZero(details.cumulativeMessages),\n          checkpointMatched: details.checkpointMatched === true,\n          checkpointRestored: details.checkpointRestored === true,\n          hardLimitObservedCount: Math.max(0, Math.floor(Number(details.hardLimitObservedCount) || 0)),\n        });\n        return { recorded: true };\n      }\n      case 'GPTLOCK_CONTEXT_CHANGED': {\n""")

# Tests: strengthen conversation isolation and visible precision.
path = 'extension/tests/chat-length-remaining-indicator.test.mjs'
replace_once(path,
"""  assert.equal(indicator.formatPercent(result.percent), '75%');\n""",
"""  assert.equal(indicator.formatPercent(result.percent), '75.0%');\n""")
with (ROOT / path).open('a', encoding='utf-8') as f:
    f.write("""\n\ntest('remaining display keeps one decimal so active conversations visibly move', () => {\n  assert.equal(indicator.formatPercent(17.34), '17.3%');\n  assert.equal(indicator.formatPercent(16.96), '17.0%');\n  assert.equal(indicator.formatPercent(16.94), '16.9%');\n});\n\ntest('diagnostic hashes do not expose raw conversation ids', () => {\n  const one = indicator.diagnosticConversationHash('conversation:alpha-secret-id');\n  const two = indicator.diagnosticConversationHash('conversation:beta-secret-id');\n  assert.match(one, /^ctx-[0-9a-f]{8}$/);\n  assert.notEqual(one, two);\n  assert.doesNotMatch(one, /alpha|secret/i);\n});\n""")

path = 'extension/tests/context-budget.test.mjs'
with (ROOT / path).open('a', encoding='utf-8') as f:
    f.write("""\n\ntest('restored checkpoints must match account conversation key and model before reuse', () => {\n  const checkpoint = budget.buildContextCheckpoint({\n    accountScope: 'acct-one', accountScopeSource: 'user-id', conversationId: 'conv-a',\n    conversationKey: 'conversation:conv-a', model: 'gpt-5.6-sol',\n    snapshot: { historyTokens: 800, historyCharacters: 3200, messageCount: 8, historyMeasurementSource: 'conversation-tree+dom-reconcile' },\n    currentNode: 'node-a', measuredAt: '2026-09-05T09:00:00.000Z',\n  });\n  assert.equal(budget.checkpointMatchesContext(checkpoint, {\n    accountScope: 'acct-one', conversationId: 'conv-a', conversationKey: 'conversation:conv-a', model: 'gpt-5.6-sol',\n  }), true);\n  assert.equal(budget.checkpointMatchesContext(checkpoint, {\n    accountScope: 'acct-one', conversationId: 'conv-b', conversationKey: 'conversation:conv-b', model: 'gpt-5.6-sol',\n  }), false);\n  assert.equal(budget.checkpointMatchesContext(checkpoint, {\n    accountScope: 'acct-two', conversationId: 'conv-a', conversationKey: 'conversation:conv-a', model: 'gpt-5.6-sol',\n  }), false);\n});\n""")

multi_test = ROOT / 'extension/tests/multi-conversation-context-isolation.test.mjs'
multi_test.write_text("""import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\nawait import(`../context-budget.js?test=${Date.now()}`);\nawait import(`../chat-length-remaining-indicator.js?test=${Date.now()}`);\nconst budget = globalThis.__GPTLOCK_CONTEXT_BUDGET__;\nconst indicator = globalThis.__GPTLOCK_CHAT_LENGTH_REMAINING_INDICATOR__;\nconst contextSource = await readFile(new URL('../context-budget.js', import.meta.url), 'utf8');\nconst backgroundSource = await readFile(new URL('../background.js', import.meta.url), 'utf8');\n\ntest('two conversations keep independent persistent checkpoint keys', () => {\n  const a = budget.checkpointStorageKey('acct-one', 'conv-a', 'gpt-5.6-sol');\n  const b = budget.checkpointStorageKey('acct-one', 'conv-b', 'gpt-5.6-sol');\n  assert.notEqual(a, b);\n});\n\ntest('two conversations calculate remaining percentage from their own cumulative usage', () => {\n  const profile = { hardLimitObservedCount: 1, hardLimitObservedTokens: 1000 };\n  const a = indicator.calculateRemainingPercent({\n    snapshot: { cumulativeConversationTokens: 830 },\n    profile,\n    localBudget: { cumulativeTokens: 830, cumulativeCharacters: 0, cumulativeMessages: 0 },\n  });\n  const b = indicator.calculateRemainingPercent({\n    snapshot: { cumulativeConversationTokens: 210 },\n    profile,\n    localBudget: { cumulativeTokens: 210, cumulativeCharacters: 0, cumulativeMessages: 0 },\n  });\n  assert.equal(indicator.formatPercent(a.percent), '17.0%');\n  assert.equal(indicator.formatPercent(b.percent), '79.0%');\n});\n\ntest('SPA navigation and in-flight history requests are conversation-key aware', () => {\n  assert.match(contextSource, /function ensureConversationNavigation\(\)/);\n  assert.match(contextSource, /ensureConversationNavigation\(\);[\\s\\S]*findVisibleConversationLengthLimit/);\n  assert.match(contextSource, /conversationMetricsPromiseKey === conversationKey/);\n  assert.match(contextSource, /requestSequence !== conversationMetricsRequestSequence/);\n  assert.match(contextSource, /checkpointMatched \? storedMetric\(restoredCheckpoint\.cumulativeTokens\) : 0/);\n  assert.match(backgroundSource, /GPTLOCK_CONTEXT_BUDGET_DIAGNOSTIC/);\n  assert.match(backgroundSource, /'context-budget', 'remaining_snapshot'/);\n});\n""", encoding='utf-8')

# Version bump: client behavior changed, so publish v0.5.41.
manifest = ROOT / 'extension/manifest.json'
data = json.loads(manifest.read_text(encoding='utf-8'))
if data.get('version') != '0.5.40':
    raise SystemExit(f"unexpected manifest version {data.get('version')}")
data['version'] = '0.5.41'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

package = ROOT / 'extension/package.json'
data = json.loads(package.read_text(encoding='utf-8'))
if data.get('version') != '0.5.40':
    raise SystemExit(f"unexpected package version {data.get('version')}")
data['version'] = '0.5.41'
package.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

replace_once('native-core/Cargo.toml', 'version = "0.5.40"', 'version = "0.5.41"')
lock_path = ROOT / 'native-core/Cargo.lock'
lock_text = lock_path.read_text(encoding='utf-8')
old_lock = 'name = "gptwork-core"\nversion = "0.5.40"'
new_lock = 'name = "gptwork-core"\nversion = "0.5.41"'
if lock_text.count(old_lock) != 1:
    raise SystemExit(f'Cargo.lock: expected one gptwork-core 0.5.40 entry, got {lock_text.count(old_lock)}')
lock_path.write_text(lock_text.replace(old_lock, new_lock, 1), encoding='utf-8')

print('context isolation v0.5.41 patch applied')
