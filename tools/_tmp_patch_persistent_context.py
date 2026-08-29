from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CTX = ROOT / 'extension' / 'context-budget.js'
TEST = ROOT / 'extension' / 'tests' / 'context-budget.test.mjs'

src = CTX.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str):
    global src
    count = src.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    src = src.replace(old, new, 1)

replace_once(
"  const CONTEXT_PROFILE_STORAGE_PREFIX = 'gptlock.context-profile.v1:';\n",
"  const CONTEXT_PROFILE_STORAGE_PREFIX = 'gptlock.context-profile.v1:';\n"
"  const CONTEXT_STATE_STORAGE_PREFIX = 'gptlock.context-state.v1:';\n"
"  const PENDING_BYPASS_STORAGE_PREFIX = 'gptlock.context-pending-bypass.v1:';\n"
"  const CONTEXT_CHECKPOINT_PERSIST_DEBOUNCE_MS = 800;\n",
'constants',
)

replace_once(
"  let conversationMetricsPromise = null;\n",
"  let conversationMetricsPromise = null;\n"
"  let restoredCheckpoint = null;\n"
"  let restoredCheckpointKey = null;\n"
"  let checkpointLoadSequence = 0;\n"
"  let checkpointPersistTimer = null;\n"
"  let restoredPendingKey = null;\n",
'runtime state',
)

replace_once(
"  function profileStorageKey(accountScope, model) {\n"
"    const account = String(accountScope ?? '').trim();\n"
"    const normalizedModel = normalizeModelId(model);\n"
"    if (!account || !normalizedModel) return null;\n"
"    return `${CONTEXT_PROFILE_STORAGE_PREFIX}${account}:${normalizedModel}`;\n"
"  }\n\n",
"  function profileStorageKey(accountScope, model) {\n"
"    const account = String(accountScope ?? '').trim();\n"
"    const normalizedModel = normalizeModelId(model);\n"
"    if (!account || !normalizedModel) return null;\n"
"    return `${CONTEXT_PROFILE_STORAGE_PREFIX}${account}:${normalizedModel}`;\n"
"  }\n\n"
"  function checkpointStorageKey(accountScope, conversationId, model) {\n"
"    const account = String(accountScope ?? '').trim();\n"
"    const conversation = String(conversationId ?? '').trim();\n"
"    const normalizedModel = normalizeModelId(model);\n"
"    if (!account || !conversation || !normalizedModel) return null;\n"
"    return `${CONTEXT_STATE_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;\n"
"  }\n\n"
"  function pendingBypassStorageKey(accountScope, conversationId, model) {\n"
"    const account = String(accountScope ?? '').trim();\n"
"    const conversation = String(conversationId ?? '').trim();\n"
"    const normalizedModel = normalizeModelId(model);\n"
"    if (!account || !conversation || !normalizedModel) return null;\n"
"    return `${PENDING_BYPASS_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;\n"
"  }\n\n"
"  function buildContextCheckpoint({\n"
"    previous = null,\n"
"    accountScope,\n"
"    accountScopeSource = 'unknown',\n"
"    conversationId,\n"
"    conversationKey,\n"
"    model,\n"
"    snapshot,\n"
"    currentNode = null,\n"
"    measuredAt = new Date().toISOString(),\n"
"  } = {}) {\n"
"    const normalizedModel = normalizeModelId(model);\n"
"    const account = String(accountScope ?? '').trim();\n"
"    const conversation = String(conversationId ?? '').trim();\n"
"    if (!account || !conversation || !normalizedModel || !snapshot) return null;\n"
"    const activeTokens = Math.max(0, Math.ceil(Number(snapshot.historyTokens) || 0));\n"
"    const activeCharacters = Math.max(0, Math.ceil(Number(snapshot.historyCharacters) || 0));\n"
"    const activeMessages = Math.max(0, Math.ceil(Number(snapshot.messageCount) || 0));\n"
"    const previousActiveTokens = Math.max(0, Math.ceil(Number(previous?.activeContextTokens) || 0));\n"
"    const previousActiveCharacters = Math.max(0, Math.ceil(Number(previous?.activeContextCharacters) || 0));\n"
"    const previousActiveMessages = Math.max(0, Math.ceil(Number(previous?.activeMessageCount) || 0));\n"
"    const cumulativeTokens = Math.max(\n"
"      activeTokens,\n"
"      Math.max(0, Math.ceil(Number(previous?.cumulativeTokens) || 0)) + Math.max(0, activeTokens - previousActiveTokens),\n"
"    );\n"
"    const cumulativeCharacters = Math.max(\n"
"      activeCharacters,\n"
"      Math.max(0, Math.ceil(Number(previous?.cumulativeCharacters) || 0)) + Math.max(0, activeCharacters - previousActiveCharacters),\n"
"    );\n"
"    const cumulativeMessages = Math.max(\n"
"      activeMessages,\n"
"      Math.max(0, Math.ceil(Number(previous?.cumulativeMessages) || 0)) + Math.max(0, activeMessages - previousActiveMessages),\n"
"    );\n"
"    return {\n"
"      schemaVersion: 1,\n"
"      accountScope: account,\n"
"      accountScopeSource,\n"
"      conversationId: conversation,\n"
"      conversationKey: String(conversationKey || `conversation:${conversation}`).slice(0, 256),\n"
"      model: normalizedModel,\n"
"      activeContextTokens: activeTokens,\n"
"      activeContextCharacters: activeCharacters,\n"
"      activeMessageCount: activeMessages,\n"
"      cumulativeTokens,\n"
"      cumulativeCharacters,\n"
"      cumulativeMessages,\n"
"      lastCurrentNode: currentNode ? String(currentNode).slice(0, 256) : null,\n"
"      measurementSource: String(snapshot.historyMeasurementSource || 'unknown').slice(0, 80),\n"
"      lastMeasuredAt: measuredAt,\n"
"      lastLiveSyncedAt: measuredAt,\n"
"    };\n"
"  }\n\n"
"  function serializePendingBypassRecord(pending) {\n"
"    if (!pending?.accountScope || !pending?.model || !pending?.conversationKey) return null;\n"
"    const startedAt = Math.max(0, Number(pending.startedAt) || 0);\n"
"    if (!startedAt) return null;\n"
"    return {\n"
"      schemaVersion: 1,\n"
"      startedAt,\n"
"      expiresAt: startedAt + BYPASS_OBSERVATION_TIMEOUT_MS,\n"
"      conversationKey: String(pending.conversationKey).slice(0, 256),\n"
"      model: normalizeModelId(pending.model),\n"
"      accountScope: String(pending.accountScope),\n"
"      accountScopeSource: String(pending.accountScopeSource || 'unknown').slice(0, 80),\n"
"      baselineAssistantCount: Math.max(0, Math.floor(Number(pending.baselineAssistantCount) || 0)),\n"
"      requestId: pending.requestId ? String(pending.requestId).slice(0, 256) : null,\n"
"      requestObserved: Boolean(pending.requestObserved),\n"
"      responseSeen: Boolean(pending.responseSeen),\n"
"      responseSuccessful: pending.responseSuccessful === true ? true : pending.responseSuccessful === false ? false : null,\n"
"      preSnapshot: pending.preSnapshot ? {\n"
"        usedTokens: Math.max(0, Math.ceil(Number(pending.preSnapshot.usedTokens) || 0)),\n"
"        fullConversationCharacters: Math.max(0, Math.ceil(Number(pending.preSnapshot.fullConversationCharacters) || 0)),\n"
"        conversationKey: String(pending.preSnapshot.conversationKey || pending.conversationKey).slice(0, 256),\n"
"        model: normalizeModelId(pending.preSnapshot.model || pending.model),\n"
"      } : null,\n"
"    };\n"
"  }\n\n"
"  function restorePendingBypassRecord(record, {\n"
"    now = Date.now(),\n"
"    accountScope,\n"
"    conversationKey,\n"
"    model,\n"
"  } = {}) {\n"
"    if (!record || Number(record.schemaVersion) !== 1) return null;\n"
"    if (Number(record.expiresAt) <= Number(now)) return null;\n"
"    if (String(record.accountScope || '') !== String(accountScope || '')) return null;\n"
"    if (String(record.conversationKey || '') !== String(conversationKey || '')) return null;\n"
"    if (normalizeModelId(record.model) !== normalizeModelId(model)) return null;\n"
"    if (!record.requestObserved || !record.preSnapshot?.usedTokens) return null;\n"
"    return {\n"
"      ...record,\n"
"      learningStarted: false,\n"
"      stableSignature: null,\n"
"      stableSince: 0,\n"
"    };\n"
"  }\n\n",
'checkpoint helpers',
)

replace_once(
"    extractConversationMetrics,\n"
"    snapshot: () => lastSnapshot,\n"
"    learningProfile: () => activeProfile,\n",
"    extractConversationMetrics,\n"
"    checkpointStorageKey,\n"
"    pendingBypassStorageKey,\n"
"    buildContextCheckpoint,\n"
"    serializePendingBypassRecord,\n"
"    restorePendingBypassRecord,\n"
"    snapshot: () => lastSnapshot,\n"
"    learningProfile: () => activeProfile,\n"
"    checkpoint: () => restoredCheckpoint,\n",
'api exports',
)

replace_once(
"    return {\n"
"      tokens: Math.max(0, Math.ceil(tokens)),\n"
"      characters: Math.max(0, Math.ceil(characters)),\n"
"      messageCount: countedMessages,\n"
"    };\n"
"  }\n\n"
"  function profileStorageKey",
"    return {\n"
"      tokens: Math.max(0, Math.ceil(tokens)),\n"
"      characters: Math.max(0, Math.ceil(characters)),\n"
"      messageCount: countedMessages,\n"
"      currentNode: payload?.current_node ? String(payload.current_node).slice(0, 256) : null,\n"
"    };\n"
"  }\n\n"
"  function profileStorageKey",
'conversation current node',
)

replace_once(
"  async function fetchConversationMetrics(conversationId) {\n",
"  async function loadConversationCheckpoint() {\n"
"    const sequence = ++checkpointLoadSequence;\n"
"    const conversationId = currentConversationId();\n"
"    const model = detectModel();\n"
"    const key = checkpointStorageKey(currentAccountScope, conversationId, model);\n"
"    restoredCheckpointKey = key;\n"
"    if (!key) {\n"
"      restoredCheckpoint = null;\n"
"      scheduleRefresh();\n"
"      return null;\n"
"    }\n"
"    try {\n"
"      const stored = await chrome.storage.local.get(key);\n"
"      if (sequence !== checkpointLoadSequence) return null;\n"
"      const checkpoint = stored[key] ?? null;\n"
"      if (\n"
"        checkpoint\n"
"        && checkpoint.accountScope === currentAccountScope\n"
"        && checkpoint.conversationId === conversationId\n"
"        && normalizeModelId(checkpoint.model) === normalizeModelId(model)\n"
"      ) {\n"
"        restoredCheckpoint = checkpoint;\n"
"      } else {\n"
"        restoredCheckpoint = null;\n"
"      }\n"
"    } catch {\n"
"      if (sequence !== checkpointLoadSequence) return null;\n"
"      restoredCheckpoint = null;\n"
"    }\n"
"    scheduleRefresh();\n"
"    return restoredCheckpoint;\n"
"  }\n\n"
"  async function persistConversationCheckpoint(snapshot) {\n"
"    const conversationId = currentConversationId();\n"
"    const model = normalizeModelId(snapshot?.model) || detectModel();\n"
"    const key = checkpointStorageKey(currentAccountScope, conversationId, model);\n"
"    if (!key || snapshot?.historyMeasurementSource !== 'conversation-tree+dom-reconcile') return null;\n"
"    try {\n"
"      const stored = restoredCheckpointKey === key && restoredCheckpoint\n"
"        ? { [key]: restoredCheckpoint }\n"
"        : await chrome.storage.local.get(key);\n"
"      const previous = stored[key] ?? null;\n"
"      const next = buildContextCheckpoint({\n"
"        previous,\n"
"        accountScope: currentAccountScope,\n"
"        accountScopeSource: currentAccountScopeSource || 'unknown',\n"
"        conversationId,\n"
"        conversationKey: snapshot.conversationKey,\n"
"        model,\n"
"        snapshot,\n"
"        currentNode: conversationMetricsCache?.currentNode || null,\n"
"        measuredAt: new Date().toISOString(),\n"
"      });\n"
"      if (!next) return null;\n"
"      await chrome.storage.local.set({ [key]: next });\n"
"      restoredCheckpoint = next;\n"
"      restoredCheckpointKey = key;\n"
"      return next;\n"
"    } catch {\n"
"      return null;\n"
"    }\n"
"  }\n\n"
"  function queueConversationCheckpointPersist(snapshot) {\n"
"    if (checkpointPersistTimer !== null) window.clearTimeout(checkpointPersistTimer);\n"
"    checkpointPersistTimer = window.setTimeout(() => {\n"
"      checkpointPersistTimer = null;\n"
"      void persistConversationCheckpoint(snapshot);\n"
"    }, CONTEXT_CHECKPOINT_PERSIST_DEBOUNCE_MS);\n"
"  }\n\n"
"  async function persistPendingBypassState() {\n"
"    if (!pendingBypass) return null;\n"
"    const conversationId = currentConversationId();\n"
"    const model = normalizeModelId(pendingBypass.model) || detectModel();\n"
"    const key = pendingBypassStorageKey(pendingBypass.accountScope || currentAccountScope, conversationId, model);\n"
"    const record = serializePendingBypassRecord(pendingBypass);\n"
"    if (!key || !record) return null;\n"
"    try {\n"
"      await chrome.storage.local.set({ [key]: record });\n"
"      restoredPendingKey = key;\n"
"      return record;\n"
"    } catch {\n"
"      return null;\n"
"    }\n"
"  }\n\n"
"  async function discardPendingBypass(removeStorage = true) {\n"
"    const old = pendingBypass;\n"
"    pendingBypass = null;\n"
"    const conversationId = currentConversationId();\n"
"    const model = normalizeModelId(old?.model) || detectModel();\n"
"    const key = restoredPendingKey || pendingBypassStorageKey(old?.accountScope || currentAccountScope, conversationId, model);\n"
"    restoredPendingKey = null;\n"
"    if (removeStorage && key) {\n"
"      try { await chrome.storage.local.remove(key); } catch { /* best effort */ }\n"
"    }\n"
"  }\n\n"
"  async function restorePendingBypass() {\n"
"    if (pendingBypass) return pendingBypass;\n"
"    const conversationId = currentConversationId();\n"
"    const conversationKey = currentConversationKey();\n"
"    const model = detectModel();\n"
"    const key = pendingBypassStorageKey(currentAccountScope, conversationId, model);\n"
"    if (!key) return null;\n"
"    try {\n"
"      const stored = await chrome.storage.local.get(key);\n"
"      const restored = restorePendingBypassRecord(stored[key], {\n"
"        now: Date.now(),\n"
"        accountScope: currentAccountScope,\n"
"        conversationKey,\n"
"        model,\n"
"      });\n"
"      if (!restored) {\n"
"        if (stored[key]) await chrome.storage.local.remove(key);\n"
"        return null;\n"
"      }\n"
"      pendingBypass = restored;\n"
"      restoredPendingKey = key;\n"
"      scheduleRefresh();\n"
"      void maybeFinalizeBypassLearning();\n"
"      return pendingBypass;\n"
"    } catch {\n"
"      return null;\n"
"    }\n"
"  }\n\n"
"  async function fetchConversationMetrics(conversationId) {\n",
'runtime persistence helpers',
)

replace_once(
"    const history = cacheFresh ? {\n"
"      tokens: Math.max(domHistory.tokens, conversationMetricsCache.tokens),\n"
"      characters: Math.max(domHistory.characters, conversationMetricsCache.characters),\n"
"    } : domHistory;\n"
"    const historyMessageCount = cacheFresh\n"
"      ? Math.max(messages.length, conversationMetricsCache.messageCount)\n"
"      : messages.length;\n",
"    const checkpointUsable = Boolean(\n"
"      !cacheFresh\n"
"      && restoredCheckpoint\n"
"      && restoredCheckpoint.accountScope === currentAccountScope\n"
"      && restoredCheckpoint.conversationKey === currentConversationKey()\n"
"    );\n"
"    const history = cacheFresh ? {\n"
"      tokens: Math.max(domHistory.tokens, conversationMetricsCache.tokens),\n"
"      characters: Math.max(domHistory.characters, conversationMetricsCache.characters),\n"
"    } : checkpointUsable ? {\n"
"      tokens: Math.max(domHistory.tokens, Number(restoredCheckpoint.activeContextTokens) || 0),\n"
"      characters: Math.max(domHistory.characters, Number(restoredCheckpoint.activeContextCharacters) || 0),\n"
"    } : domHistory;\n"
"    const historyMessageCount = cacheFresh\n"
"      ? Math.max(messages.length, conversationMetricsCache.messageCount)\n"
"      : checkpointUsable\n"
"        ? Math.max(messages.length, Number(restoredCheckpoint.activeMessageCount) || 0)\n"
"        : messages.length;\n",
'snapshot restore history',
)

replace_once(
"      historyMeasurementSource: cacheFresh ? 'conversation-tree+dom-reconcile' : 'dom-fallback',\n",
"      historyMeasurementSource: cacheFresh\n"
"        ? 'conversation-tree+dom-reconcile'\n"
"        : checkpointUsable\n"
"          ? 'checkpoint+dom-restore'\n"
"          : 'dom-fallback',\n"
"      checkpointRestored: checkpointUsable,\n"
"      checkpointMeasuredAt: checkpointUsable ? restoredCheckpoint.lastMeasuredAt ?? null : null,\n"
"      cumulativeConversationTokens: checkpointUsable || restoredCheckpoint\n"
"        ? Math.max(history.tokens, Number(restoredCheckpoint?.cumulativeTokens) || 0)\n"
"        : history.tokens,\n"
"      cumulativeConversationCharacters: checkpointUsable || restoredCheckpoint\n"
"        ? Math.max(history.characters, Number(restoredCheckpoint?.cumulativeCharacters) || 0)\n"
"        : history.characters,\n"
"      cumulativeMessageCount: checkpointUsable || restoredCheckpoint\n"
"        ? Math.max(historyMessageCount, Number(restoredCheckpoint?.cumulativeMessages) || 0)\n"
"        : historyMessageCount,\n",
'snapshot restore metadata',
)

replace_once(
"    if (snapshot.adaptiveActive) {\n",
"    if (snapshot.checkpointRestored) {\n"
"      rows.push(`恢复状态：已从上次本地检查点恢复（${snapshot.checkpointMeasuredAt || '时间未知'}），正在与 ChatGPT 当前活动会话重新对账。`);\n"
"    }\n"
"    if (snapshot.cumulativeConversationTokens > snapshot.fullConversationTokens || snapshot.cumulativeMessageCount > snapshot.messageCount) {\n"
"      rows.push(`会话累计观测：约 ${formatCompactTokens(snapshot.cumulativeConversationTokens)} tokens · ${formatCompactNumber(snapshot.cumulativeConversationCharacters)} 字符 · ${snapshot.cumulativeMessageCount} 条消息`);\n"
"    }\n"
"    if (snapshot.adaptiveActive) {\n",
'indicator checkpoint rows',
)

replace_once(
"    lastSnapshot = next;\n"
"    mountIndicatorRow(next);\n",
"    lastSnapshot = next;\n"
"    mountIndicatorRow(next);\n"
"    if (next.historyMeasurementSource === 'conversation-tree+dom-reconcile') {\n"
"      queueConversationCheckpointPersist(next);\n"
"    }\n",
'checkpoint queue publish',
)

replace_once(
"      if (changed) await loadActiveProfile();\n"
"      return currentAccountScope;\n",
"      if (changed) {\n"
"        await loadActiveProfile();\n"
"        await loadConversationCheckpoint();\n"
"        await restorePendingBypass();\n"
"      }\n"
"      return currentAccountScope;\n",
'account restore',
)

replace_once(
"    const observation = pendingBypass;\n"
"    void refreshAccountScope(true).then(() => {\n",
"    const observation = pendingBypass;\n"
"    if (observation.accountScope) void persistPendingBypassState();\n"
"    void refreshAccountScope(true).then(() => {\n",
'pending initial persist',
)

replace_once(
"      observation.accountScope = currentAccountScope;\n"
"      observation.accountScopeSource = currentAccountScopeSource;\n"
"      void maybeFinalizeBypassLearning();\n",
"      observation.accountScope = currentAccountScope;\n"
"      observation.accountScopeSource = currentAccountScopeSource;\n"
"      void persistPendingBypassState();\n"
"      void maybeFinalizeBypassLearning();\n",
'pending account persist',
)

replace_once(
"    if (!pendingBypass.requestObserved) return;\n"
"    if (state?.phase === 'error' && state?.lastError) {\n",
"    if (!pendingBypass.requestObserved) return;\n"
"    void persistPendingBypassState();\n"
"    if (state?.phase === 'error' && state?.lastError) {\n",
'pending request persist',
)

replace_once(
"      pendingBypass.responseSuccessful = false;\n"
"      return;\n",
"      pendingBypass.responseSuccessful = false;\n"
"      void persistPendingBypassState();\n"
"      return;\n",
'pending error persist',
)

replace_once(
"      pendingBypass.responseSuccessful = !Number.isFinite(status) || status === 0 || (status >= 200 && status < 400);\n"
"    }\n"
"  }\n\n"
"  function responseCanBeConsideredSuccessful",
"      pendingBypass.responseSuccessful = !Number.isFinite(status) || status === 0 || (status >= 200 && status < 400);\n"
"      void persistPendingBypassState();\n"
"    }\n"
"  }\n\n"
"  function responseCanBeConsideredSuccessful",
'pending response persist',
)

# In the async learner, clear persisted pending state on terminal paths.
for old, new, label in [
    ("    if (!key) {\n      pendingBypass = null;\n      return null;\n    }\n", "    if (!key) {\n      await discardPendingBypass();\n      return null;\n    }\n", 'learner no key'),
    ("      if (!next) {\n        pendingBypass = null;\n        return null;\n      }\n", "      if (!next) {\n        await discardPendingBypass();\n        return null;\n      }\n", 'learner no profile'),
    ("      pendingBypass = null;\n      window.dispatchEvent(new CustomEvent('gptlock:context-limit-learned', { detail }));\n", "      await discardPendingBypass();\n      window.dispatchEvent(new CustomEvent('gptlock:context-limit-learned', { detail }));\n", 'learner success clear'),
    ("    } catch {\n      pendingBypass = null;\n      return null;\n    }\n  }\n\n  async function maybeFinalizeBypassLearning", "    } catch {\n      await discardPendingBypass();\n      return null;\n    }\n  }\n\n  async function maybeFinalizeBypassLearning", 'learner catch clear'),
]:
    replace_once(old, new, label)

replace_once(
"    if (Date.now() - pending.startedAt > BYPASS_OBSERVATION_TIMEOUT_MS) {\n"
"      pendingBypass = null;\n"
"      return;\n"
"    }\n",
"    if (Date.now() - pending.startedAt > BYPASS_OBSERVATION_TIMEOUT_MS) {\n"
"      await discardPendingBypass();\n"
"      return;\n"
"    }\n",
'pending timeout clear',
)

replace_once(
"    if (pending.responseSuccessful === false) {\n"
"      pendingBypass = null;\n"
"      return;\n"
"    }\n",
"    if (pending.responseSuccessful === false) {\n"
"      await discardPendingBypass();\n"
"      return;\n"
"    }\n",
'pending response failure clear',
)

replace_once(
"    if (hasVisibleGenerationError()) {\n"
"      pendingBypass = null;\n"
"      return;\n"
"    }\n",
"    if (hasVisibleGenerationError()) {\n"
"      await discardPendingBypass();\n"
"      return;\n"
"    }\n",
'pending visible failure clear',
)

replace_once(
"      void loadActiveProfile();\n"
"    }\n"
"    if (!currentAccountScope) void refreshAccountScope();\n",
"      void loadActiveProfile();\n"
"      void loadConversationCheckpoint();\n"
"      void restorePendingBypass();\n"
"    }\n"
"    if (!currentAccountScope) void refreshAccountScope();\n",
'model change restore',
)

replace_once(
"  function handleConversationNavigation() {\n"
"    pendingBypass = null;\n"
"    conversationMetricsCache = null;\n"
"    conversationMetricsCheckedAt = 0;\n"
"    scheduleRefresh();\n"
"    void refreshAccountScope(true);\n"
"    void refreshConversationMetrics(true);\n"
"  }\n",
"  function handleConversationNavigation() {\n"
"    // Detach only. The old conversation's pending record remains recoverable until its TTL expires.\n"
"    pendingBypass = null;\n"
"    restoredPendingKey = null;\n"
"    restoredCheckpoint = null;\n"
"    restoredCheckpointKey = null;\n"
"    conversationMetricsCache = null;\n"
"    conversationMetricsCheckedAt = 0;\n"
"    scheduleRefresh();\n"
"    void refreshAccountScope(true).then(() => {\n"
"      void loadConversationCheckpoint();\n"
"      void restorePendingBypass();\n"
"    });\n"
"    void refreshConversationMetrics(true);\n"
"  }\n",
'navigation restore',
)

replace_once(
"  void refreshAccountScope(true);\n"
"  void refreshConversationMetrics(true);\n"
"  recompute();\n",
"  void refreshAccountScope(true).then(() => {\n"
"    void loadConversationCheckpoint();\n"
"    void restorePendingBypass();\n"
"  });\n"
"  void refreshConversationMetrics(true);\n"
"  recompute();\n",
'startup restore',
)

CTX.write_text(src, encoding='utf-8')

# Append pure-logic regression tests. They run in Node before DOM/browser code exits.
test_src = TEST.read_text(encoding='utf-8')
marker = "test('persistent context checkpoints survive shrink/reconcile and continue cumulative observation after restart'"
if marker not in test_src:
    test_src += r'''

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
'''
TEST.write_text(test_src, encoding='utf-8')

print('persistent context patch applied')
