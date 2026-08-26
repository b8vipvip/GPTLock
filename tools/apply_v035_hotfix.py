from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one exact match, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:100]!r}")
    write(path, next_text)


# -------------------------
# background.js
# -------------------------
replace_once(
    "extension/background.js",
    "const REQUEST_TIMEOUT_MS = 7000;\n",
    "const REQUEST_TIMEOUT_MS = 7000;\n"
    "const AUTO_VERIFY_MAX_ATTEMPTS = 2;\n"
    "const AUTO_VERIFY_RESPONSE_TIMEOUT_MS = 45000;\n"
    "const AUTO_VERIFY_POLL_MS = 200;\n"
    "const AUTO_VERIFY_FALLBACK_DELAY_MS = 700;\n",
)
replace_once(
    "extension/background.js",
    "    lastError: null,\n    updatedAt: new Date().toISOString(),\n",
    "    lastError: null,\n    autoVerification: null,\n    updatedAt: new Date().toISOString(),\n",
)
replace_once(
    "extension/background.js",
    "    evidenceIssue: state.evidenceIssue,\n    lastError: state.lastError,\n    updatedAt: state.updatedAt,\n",
    "    evidenceIssue: state.evidenceIssue,\n    lastError: state.lastError,\n    autoVerification: state.autoVerification,\n    updatedAt: state.updatedAt,\n",
)

AUTO_VERIFY_BLOCK = r'''function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetVerificationAttempt(state) {
  state.phase = 'initial';
  state.probeUsed = false;
  state.probeArmed = false;
  state.lastRewrite = null;
  state.lastRequest = null;
  state.lastVerification = null;
  state.lastEvidenceDiagnostics = null;
  state.evidenceIssue = null;
  state.lastError = null;
}

function requestLockConfirmed(state) {
  return Boolean(
    state.lastRequest?.model
      && currentPolicy.lockedModels.includes(state.lastRequest.model),
  );
}

function verificationOutcome(state, { timedOut = false, fallbackError = null } = {}) {
  const verification = state.lastVerification;
  const reasons = Array.isArray(verification?.reasons) ? verification.reasons : [];
  const modelAllowed = Boolean(
    verification?.model && currentPolicy.lockedModels.includes(verification.model),
  );
  if (verification?.verdict === 'verified') {
    return { outcome: 'verified', reason: null };
  }
  if (reasons.includes('model_not_allowed')) {
    return { outcome: 'model_mismatch', reason: 'confirmed_model_mismatch' };
  }
  if (modelAllowed && reasons.includes('reasoning_missing')) {
    return {
      outcome: 'model_verified_reasoning_unconfirmed',
      reason: 'reasoning_not_exposed',
    };
  }
  if (timedOut) {
    return { outcome: 'unverified', reason: 'response_verification_timeout' };
  }
  if (fallbackError) {
    return { outcome: 'unverified', reason: 'conversation_evidence_fetch_failed' };
  }
  if (state.evidenceIssue === 'response_body_read_failed') {
    return { outcome: 'unverified', reason: 'response_body_read_failed' };
  }
  if (state.evidenceIssue === 'response_model_not_exposed' || reasons.includes('model_missing')) {
    return { outcome: 'unverified', reason: 'model_not_exposed' };
  }
  if (state.evidenceIssue === 'response_reasoning_not_exposed' || reasons.includes('reasoning_missing')) {
    return { outcome: 'unverified', reason: 'reasoning_not_exposed' };
  }
  if (state.phase === 'error') {
    return { outcome: 'error', reason: state.lastError || 'verification_error' };
  }
  return { outcome: 'unverified', reason: state.evidenceIssue || verification?.reason || 'metadata_incomplete' };
}

async function waitForAttemptVerification(tabId, startedAtMs) {
  const deadline = Date.now() + AUTO_VERIFY_RESPONSE_TIMEOUT_MS;
  let requestId = null;
  while (Date.now() < deadline) {
    const state = ensureTabState(tabId);
    const requestTime = Date.parse(state.lastRequest?.capturedAt || '');
    if (
      state.lastRequest?.requestId
      && Number.isFinite(requestTime)
      && requestTime >= startedAtMs - 1500
    ) {
      requestId = state.lastRequest.requestId;
    }
    if (
      requestId
      && state.lastVerification?.requestId === `cdp-${tabId}-${requestId}`
    ) {
      return { timedOut: false, requestId };
    }
    if (state.phase === 'error' && state.lastError) {
      return { timedOut: false, requestId, error: state.lastError };
    }
    await sleep(AUTO_VERIFY_POLL_MS);
  }
  return { timedOut: true, requestId };
}

async function collectConversationEvidence(tabId, expectedAfterMs) {
  const response = await sendTabMessage(tabId, {
    type: 'GPTLOCK_FETCH_CONVERSATION_EVIDENCE',
    expectedAfterMs,
  });
  return response?.evidence ?? null;
}

async function applyConversationEvidence(tabId, evidence, attempt) {
  if (!evidence) return null;
  const state = ensureTabState(tabId);
  try {
    const result = await verifyObservation({
      model: evidence.model ?? null,
      reasoning: evidence.reasoning ?? null,
      evidenceSource: 'conversation_response_metadata',
      capturedAt: evidence.capturedAt ?? new Date().toISOString(),
      requestId: `conversation-${tabId}-${attempt}-${Date.now()}`,
    });
    state.lastVerification = result;
    state.phase = result.verdict;
    state.evidenceIssue = result.reason === 'model_missing'
      ? 'conversation_model_not_exposed'
      : result.reason === 'reasoning_missing'
        ? 'conversation_reasoning_not_exposed'
        : result.verdict === 'verified'
          ? null
          : 'conversation_metadata_incomplete';
    state.lastEvidenceDiagnostics = {
      ...(state.lastEvidenceDiagnostics ?? {}),
      conversationFallback: evidence.diagnostics ?? null,
    };
    logRuntime(result.verdict === 'verified' ? 'info' : 'warn', 'verification', 'conversation_fallback_evaluated', {
      tabId,
      attempt,
      verdict: result.verdict,
      decision: result.decision,
      reason: result.reason,
      reasons: result.reasons,
      model: result.model,
      reasoning: result.reasoning,
      evidenceSource: result.evidenceSource,
      diagnostics: evidence.diagnostics ?? null,
    });
    await broadcastTabState(tabId);
    return result;
  } catch (error) {
    state.lastError = errorText(error);
    logRuntime('error', 'verification', 'conversation_fallback_failed', {
      tabId,
      attempt,
      error: state.lastError,
      diagnostics: evidence.diagnostics ?? null,
    });
    await broadcastTabState(tabId);
    return null;
  }
}

function probeText(attempt) {
  if (attempt === 1) {
    return 'GPTLock 自动验证 1/2：请计算 37×41，并只回复结果。';
  }
  return 'GPTLock 自动验证 2/2：请计算 137×29，并只回复结果。';
}

async function autoVerify(tabId) {
  if (!currentSettings.enabled) throw new Error('GPTLock is disabled / GPTLock 已关闭');
  const tab = await chrome.tabs.get(tabId);
  if (!isChatGptUrl(tab.url ?? '')) throw new Error('Open chatgpt.com first / 请先打开 chatgpt.com');
  const state = ensureTabState(tabId, tab.url);
  const startedAt = new Date().toISOString();
  logRuntime('info', 'verification', 'auto_verify_started', {
    tabId,
    maxAttempts: AUTO_VERIFY_MAX_ATTEMPTS,
  });

  const coreCheck = await refreshNativeCore({ tolerateFailure: true });
  const monitorAttached = await networkMonitor.attach(tabId);
  const page = await collectPageObservation(tabId, state);

  state.autoVerification = {
    running: true,
    startedAt,
    completedAt: null,
    attempt: 0,
    maxAttempts: AUTO_VERIFY_MAX_ATTEMPTS,
    retries: 0,
    outcome: 'running',
    reason: null,
    requestLockConfirmed: false,
    requestModel: null,
    responseModel: null,
    responseReasoning: null,
    evidenceSource: null,
    attempts: [],
  };
  resetVerificationAttempt(state);
  state.lastError = page.error;
  await broadcastTabState(tabId);

  if (!monitorAttached) {
    logRuntime('warn', 'verification', 'auto_verify_request_lock_unavailable', {
      tabId,
      monitorError: state.monitor?.error ?? null,
    });
  }

  for (let attempt = 1; attempt <= AUTO_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    resetVerificationAttempt(state);
    state.autoVerification.running = true;
    state.autoVerification.attempt = attempt;
    state.autoVerification.retries = attempt - 1;
    state.autoVerification.reason = attempt > 1 ? 'retrying_after_incomplete_evidence' : null;
    await broadcastTabState(tabId);

    const attemptStartedMs = Date.now();
    let sendResult = null;
    let sendError = null;
    try {
      sendResult = await sendTabMessage(tabId, {
        type: 'GPTLOCK_AUTO_SEND_PROBE',
        preferredReasoning: currentSettings.preferredReasoning,
        probeText: probeText(attempt),
        probeMarker: `GPTLock 自动验证 ${attempt}/2`,
      });
    } catch (error) {
      sendError = errorText(error);
      state.lastError = sendError;
      logRuntime('error', 'verification', 'auto_probe_send_failed', {
        tabId,
        attempt,
        error: sendError,
        monitorAttached,
      });
    }

    if (sendError || !sendResult?.sent) {
      state.autoVerification.attempts.push({
        attempt,
        sent: false,
        sendError: sendError || 'visible_probe_not_sent',
        requestLockConfirmed: false,
        outcome: 'send_failed',
        reason: sendError || 'visible_probe_not_sent',
      });
      if (attempt < AUTO_VERIFY_MAX_ATTEMPTS) {
        logRuntime('warn', 'verification', 'auto_verify_retry_scheduled', {
          tabId,
          attempt,
          reason: sendError || 'visible_probe_not_sent',
        });
        await sleep(1000);
        continue;
      }
      break;
    }

    logRuntime('info', 'verification', 'auto_probe_send_completed', {
      tabId,
      attempt,
      sent: true,
      method: sendResult.method ?? null,
      draftPreserved: Boolean(sendResult.draftPreserved),
      draftRestored: Boolean(sendResult.draftRestored),
      coreConnected: coreCheck.connected,
      coreError: coreCheck.error,
      monitorAttached,
      pageCollected: page.collected,
      pageCollectionError: page.error,
    });

    const waited = await waitForAttemptVerification(tabId, attemptStartedMs);
    let fallbackAttempted = false;
    let fallbackError = null;
    if (waited.timedOut) {
      state.phase = 'unverified';
      state.evidenceIssue = 'auto_verify_response_timeout';
      state.lastError = 'response_verification_timeout';
      logRuntime('warn', 'verification', 'auto_verify_response_timeout', {
        tabId,
        attempt,
        requestId: waited.requestId,
        timeoutMs: AUTO_VERIFY_RESPONSE_TIMEOUT_MS,
      });
      await broadcastTabState(tabId);
    } else if (state.lastVerification?.verdict !== 'verified') {
      fallbackAttempted = true;
      await sleep(AUTO_VERIFY_FALLBACK_DELAY_MS);
      try {
        const evidence = await collectConversationEvidence(tabId, attemptStartedMs);
        if (evidence) await applyConversationEvidence(tabId, evidence, attempt);
      } catch (error) {
        fallbackError = errorText(error);
        logRuntime('warn', 'verification', 'conversation_fallback_unavailable', {
          tabId,
          attempt,
          error: fallbackError,
        });
      }
    }

    const requestLocked = requestLockConfirmed(state);
    const outcome = verificationOutcome(state, {
      timedOut: waited.timedOut,
      fallbackError,
    });
    const attemptSummary = {
      attempt,
      sent: true,
      requestLockConfirmed: requestLocked,
      requestModel: state.lastRequest?.model ?? null,
      rewriteReason: state.lastRewrite?.reason ?? null,
      responseModel: state.lastVerification?.model ?? null,
      responseReasoning: state.lastVerification?.reasoning ?? null,
      evidenceSource: state.lastVerification?.evidenceSource ?? null,
      verdict: state.lastVerification?.verdict ?? null,
      evidenceIssue: state.evidenceIssue ?? null,
      fallbackAttempted,
      fallbackError,
      timedOut: waited.timedOut,
      outcome: outcome.outcome,
      reason: outcome.reason,
    };
    state.autoVerification.attempts.push(attemptSummary);
    state.autoVerification.requestLockConfirmed = requestLocked;
    state.autoVerification.requestModel = attemptSummary.requestModel;
    state.autoVerification.responseModel = attemptSummary.responseModel;
    state.autoVerification.responseReasoning = attemptSummary.responseReasoning;
    state.autoVerification.evidenceSource = attemptSummary.evidenceSource;
    state.autoVerification.outcome = outcome.outcome;
    state.autoVerification.reason = outcome.reason;
    await broadcastTabState(tabId);

    if (outcome.outcome === 'verified') break;
    if (attempt < AUTO_VERIFY_MAX_ATTEMPTS) {
      logRuntime('warn', 'verification', 'auto_verify_retry_scheduled', {
        tabId,
        attempt,
        nextAttempt: attempt + 1,
        reason: outcome.reason,
        requestLockConfirmed: requestLocked,
      });
      await sleep(1000);
    }
  }

  const attempts = state.autoVerification.attempts;
  const lastAttempt = attempts[attempts.length - 1] ?? null;
  const finalOutcome = lastAttempt?.outcome ?? 'error';
  const finalReason = lastAttempt?.reason ?? state.lastError ?? 'auto_verify_failed';
  state.autoVerification.running = false;
  state.autoVerification.completedAt = new Date().toISOString();
  state.autoVerification.outcome = finalOutcome;
  state.autoVerification.reason = finalReason;
  state.autoVerification.retries = Math.max(0, attempts.length - 1);
  state.autoVerification.requestLockConfirmed = Boolean(lastAttempt?.requestLockConfirmed);
  state.autoVerification.requestModel = lastAttempt?.requestModel ?? null;
  state.autoVerification.responseModel = lastAttempt?.responseModel ?? null;
  state.autoVerification.responseReasoning = lastAttempt?.responseReasoning ?? null;
  state.autoVerification.evidenceSource = lastAttempt?.evidenceSource ?? null;
  await broadcastTabState(tabId);

  logRuntime(finalOutcome === 'verified' ? 'info' : 'warn', 'verification', 'auto_verify_completed', {
    tabId,
    outcome: finalOutcome,
    reason: finalReason,
    attempts: attempts.length,
    retries: state.autoVerification.retries,
    requestLockConfirmed: state.autoVerification.requestLockConfirmed,
    requestModel: state.autoVerification.requestModel,
    responseModel: state.autoVerification.responseModel,
    responseReasoning: state.autoVerification.responseReasoning,
    evidenceSource: state.autoVerification.evidenceSource,
  });

  return {
    ready: Boolean(lastAttempt?.sent),
    sent: Boolean(lastAttempt?.sent),
    outcome: finalOutcome,
    reason: finalReason,
    attempts: attempts.length,
    retries: state.autoVerification.retries,
    requestLockConfirmed: state.autoVerification.requestLockConfirmed,
    requestModel: state.autoVerification.requestModel,
    responseModel: state.autoVerification.responseModel,
    responseReasoning: state.autoVerification.responseReasoning,
    evidenceSource: state.autoVerification.evidenceSource,
    checks: {
      coreConnected: coreCheck.connected,
      coreError: coreCheck.error,
      monitorAttached,
      pageCollected: page.collected,
      pageCollectionError: page.error,
      pageModel: state.pageObservation?.model ?? null,
      pageReasoning: state.pageObservation?.reasoning ?? null,
    },
    autoVerification: state.autoVerification,
    tabState: publicTabState(state),
  };
}
'''
regex_once(
    "extension/background.js",
    r"async function autoVerify\(tabId\) \{.*?\n\}\n\nfunction diagnosticTabState",
    AUTO_VERIFY_BLOCK + "\nfunction diagnosticTabState",
)
replace_once(
    "extension/background.js",
    "    evidenceIssue: state.evidenceIssue,\n    lastError: state.lastError,\n    updatedAt: state.updatedAt,\n    guard: guardFor(state),\n",
    "    evidenceIssue: state.evidenceIssue,\n    lastError: state.lastError,\n    autoVerification: state.autoVerification,\n    updatedAt: state.updatedAt,\n    guard: guardFor(state),\n",
)
replace_once(
    "extension/background.js",
    "      state.evidenceIssue = null;\n      state.lastError = null;\n      void broadcastTabState(state.tabId);\n",
    "      state.evidenceIssue = null;\n      state.lastError = null;\n      state.autoVerification = null;\n      void broadcastTabState(state.tabId);\n",
)
replace_once(
    "extension/background.js",
    "        state.lastError = null;\n        state.evidenceIssue = null;\n        logRuntime('info', 'verification', 'legacy_probe_reset', { tabId });\n",
    "        state.lastError = null;\n        state.evidenceIssue = null;\n        state.autoVerification = null;\n        logRuntime('info', 'verification', 'legacy_probe_reset', { tabId });\n",
)

# -------------------------
# content.js
# -------------------------
replace_once(
    "extension/content.js",
    "    '[role=\"banner\"] button[aria-haspopup]',\n    'header button[aria-haspopup]',\n",
    "    '[role=\"banner\"] button[aria-haspopup]',\n    'header button[aria-haspopup]',\n    '[data-testid*=\"composer\"] button',\n    'form button',\n",
)
replace_once(
    "extension/content.js",
    "    'button[aria-label*=\"思考\"]',\n",
    "    'button[aria-label*=\"思考\"]',\n    '[data-testid*=\"composer\"] button',\n    'form button',\n",
)
replace_once(
    "extension/content.js",
    "  const AUTO_PROBE_TEXT = 'GPTLock 自动验证测试：请只回复“验证完成”。';\n",
    "  const AUTO_PROBE_TEXT = 'GPTLock 自动验证测试：请只回复“验证完成”。';\n  const MAX_CONVERSATION_MAPPING_NODES = 5000;\n",
)
regex_once(
    "extension/content.js",
    r"  function normalizeDisplayedModel\(text\) \{.*?\n  \}\n\n  function normalizeDisplayedReasoning",
    r'''  function normalizeDisplayedModel(text) {
    if (!text) return null;
    const compact = text.trim().toLowerCase().replace(/\s+/g, '-');
    const explicit = compact.match(/gpt-?(\d+(?:\.\d+)*)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?/);
    if (explicit) {
      const suffix = explicit[2] ? `-${explicit[2]}` : '';
      const value = `gpt-${explicit[1]}${suffix}`;
      return value === 'gpt-5.6-sol-wm' ? 'gpt-5.6-sol' : value;
    }
    const compactSol = compact.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)*)-sol(?:-wm)?(?:-|$)/);
    if (compactSol) return `gpt-${compactSol[1]}-sol`;
    return null;
  }

  function normalizeDisplayedReasoning''',
)
regex_once(
    "extension/content.js",
    r"  function collectObservation\(\) \{.*?\n  \}\n\n  function sendMessage",
    r'''  function collectObservation() {
    const model = firstNormalized(MODEL_SELECTORS, normalizeDisplayedModel)
      || firstNormalized(['button'], normalizeDisplayedModel);
    const reasoning = firstNormalized(REASONING_SELECTORS, normalizeDisplayedReasoning)
      || firstNormalized(MODEL_SELECTORS, normalizeDisplayedReasoning)
      || (model ? firstNormalized(['button'], normalizeDisplayedReasoning) : null);
    return {
      model,
      reasoning,
      evidenceSource: 'page_dom',
      capturedAt: new Date().toISOString(),
    };
  }

  function sendMessage''',
)
replace_once(
    "extension/content.js",
    "    const guard = cachedState?.guard;\n    const labels = {\n",
    "    const guard = cachedState?.guard;\n    const auto = cachedState?.autoVerification;\n    if (auto?.running) {\n      button.textContent = `GPTLock · 自动验证 ${auto.attempt || 1}/${auto.maxAttempts || 2}`;\n      button.dataset.tone = 'wait';\n      button.title = `自动验证正在进行；证据不足时会自动重试 / Auto verification is running and will retry incomplete evidence.`;\n      return;\n    }\n    const labels = {\n",
)
replace_once(
    "extension/content.js",
    "    button.title = `${reasonText(guard)}\\n点击打开设置 / Click to open settings`;\n",
    "    const autoReason = auto?.outcome === 'model_verified_reasoning_unconfirmed'\n      ? '自动验证已重试：模型已确认，但 ChatGPT 未暴露推理强度元数据。'\n      : auto?.outcome && auto.outcome !== 'verified'\n        ? `自动验证已结束：${auto.reason || auto.outcome}；已尝试 ${auto.attempts?.length || 0} 次。`\n        : null;\n    button.title = `${autoReason || reasonText(guard)}\\n点击打开设置 / Click to open settings`;\n",
)

CONTENT_AUTO_BLOCK = r'''  function currentConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? null;
  }

  function normalizeMetadataModel(value) {
    if (typeof value !== 'string') return null;
    const compact = value.trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(compact)) return null;
    return compact === 'gpt-5.6-sol-wm' ? 'gpt-5.6-sol' : compact;
  }

  function metadataEvidence(message) {
    if (!message || message.author?.role !== 'assistant') return null;
    const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
    const modelKeys = ['served_model', 'resolved_model', 'used_model', 'model_slug', 'model'];
    const reasoningKeys = ['reasoning_effort', 'reasoning_level', 'thinking_level'];
    let model = null;
    let modelField = null;
    let reasoning = null;
    let reasoningField = null;
    for (const key of modelKeys) {
      model = normalizeMetadataModel(metadata[key]);
      if (model) {
        modelField = `message.metadata.${key}`;
        break;
      }
    }
    for (const key of reasoningKeys) {
      reasoning = normalizeDisplayedReasoning(metadata[key]);
      if (reasoning) {
        reasoningField = `message.metadata.${key}`;
        break;
      }
    }
    const createdSeconds = Number(message.create_time);
    const createdAtMs = Number.isFinite(createdSeconds) ? Math.round(createdSeconds * 1000) : null;
    return {
      model,
      reasoning,
      createdAtMs,
      diagnostics: {
        modelField,
        reasoningField,
      },
    };
  }

  function extractConversationEvidence(payload, expectedAfterMs = null) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Conversation detail is not an object / 会话详情格式无效');
    }
    const mapping = payload.mapping && typeof payload.mapping === 'object' ? payload.mapping : null;
    if (!mapping) throw new Error('Conversation mapping missing / 会话详情缺少 mapping');
    const mappingEntries = Object.entries(mapping).slice(0, MAX_CONVERSATION_MAPPING_NODES);
    let selected = null;
    let selectedBy = null;
    let nodeId = typeof payload.current_node === 'string' ? payload.current_node : null;
    const visited = new Set();
    for (let depth = 0; nodeId && depth < 128 && !visited.has(nodeId); depth += 1) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      const candidate = metadataEvidence(node?.message);
      if (candidate) {
        selected = candidate;
        selectedBy = 'current_node_parent_chain';
        break;
      }
      nodeId = typeof node?.parent === 'string' ? node.parent : null;
    }
    if (!selected) {
      const candidates = mappingEntries
        .map(([, node]) => metadataEvidence(node?.message))
        .filter(Boolean)
        .sort((left, right) => (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0));
      selected = candidates[0] ?? null;
      selectedBy = selected ? 'latest_assistant_create_time' : null;
    }
    if (!selected) throw new Error('No assistant metadata found / 未找到助手消息元数据');
    if (
      Number.isFinite(expectedAfterMs)
      && Number.isFinite(selected.createdAtMs)
      && selected.createdAtMs < expectedAfterMs - 5000
    ) {
      throw new Error('Conversation detail has not updated to the probe yet / 会话详情尚未更新到本次测试消息');
    }
    return {
      model: selected.model,
      reasoning: selected.reasoning,
      evidenceSource: 'conversation_response_metadata',
      capturedAt: new Date().toISOString(),
      diagnostics: {
        selectedBy,
        assistantCreatedAt: selected.createdAtMs ? new Date(selected.createdAtMs).toISOString() : null,
        mappingNodeCount: mappingEntries.length,
        ...selected.diagnostics,
      },
    };
  }

  async function fetchConversationEvidence(expectedAfterMs = null) {
    const conversationId = currentConversationId();
    if (!conversationId) throw new Error('Current conversation id missing / 当前会话 ID 缺失');
    const response = await fetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Conversation detail HTTP ${response.status}`);
    }
    const payload = await response.json();
    return extractConversationEvidence(payload, expectedAfterMs);
  }

  async function autoSendProbe(options = {}) {
    if (autoProbeRunning) throw new Error('Automatic verification is already running / 自动验证正在进行');
    autoProbeRunning = true;
    try {
      await waitForIdle();
      await alignSelection({ force: true });
      await new Promise((resolve) => window.setTimeout(resolve, 450));

      const composer = await waitUntil(findComposer, 5000, 100);
      if (!composer) throw new Error('ChatGPT composer not found / 未找到 ChatGPT 输入框');
      const originalDraft = composerText(composer);
      const draftPreserved = Boolean(originalDraft.trim());
      const probeText = typeof options.probeText === 'string' && options.probeText.trim()
        ? options.probeText.trim().slice(0, 500)
        : AUTO_PROBE_TEXT;
      const probeMarker = typeof options.probeMarker === 'string' && options.probeMarker.trim()
        ? options.probeMarker.trim().slice(0, 120)
        : 'GPTLock 自动验证';

      setComposerText(composer, probeText);
      const filled = await waitUntil(() => composerText(composer).includes(probeMarker), 2500, 80);
      if (!filled) throw new Error('Failed to write visible test message / 无法写入可见测试消息');

      const sendButton = await waitUntil(findSendButton, 5000, 100);
      if (!sendButton) {
        if (draftPreserved) setComposerText(composer, originalDraft);
        throw new Error('ChatGPT send button is unavailable / ChatGPT 发送按钮不可用');
      }
      sendButton.click();

      const sent = await waitUntil(() => {
        const currentComposer = findComposer();
        const current = composerText(currentComposer);
        return !current.includes(probeMarker) || Boolean(document.querySelector(GENERATING_SELECTORS.join(',')));
      }, 5000, 100);
      if (!sent) {
        if (draftPreserved) setComposerText(composer, originalDraft);
        throw new Error('Visible test message was not accepted by ChatGPT / 可见测试消息未被 ChatGPT 接收');
      }

      let draftRestored = false;
      if (draftPreserved) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        const restoreComposer = await waitUntil(findComposer, 3000, 100);
        if (restoreComposer) {
          setComposerText(restoreComposer, originalDraft);
          draftRestored = composerText(restoreComposer).trim() === originalDraft.trim();
        }
      }
      return {
        sent: true,
        method: 'visible_composer_click',
        draftPreserved,
        draftRestored,
      };
    } finally {
      autoProbeRunning = false;
    }
  }
'''
regex_once(
    "extension/content.js",
    r"  async function autoSendProbe\(\) \{.*?\n  \}\n\n  chrome\.runtime\.onMessage",
    CONTENT_AUTO_BLOCK + "\n  chrome.runtime.onMessage",
)
replace_once(
    "extension/content.js",
    "    if (message?.type === 'GPTLOCK_AUTO_SEND_PROBE') {\n      void autoSendProbe().then(\n",
    "    if (message?.type === 'GPTLOCK_AUTO_SEND_PROBE') {\n      void autoSendProbe(message).then(\n",
)
replace_once(
    "extension/content.js",
    "      return true;\n    }\n    return false;\n  });\n",
    "      return true;\n    }\n    if (message?.type === 'GPTLOCK_FETCH_CONVERSATION_EVIDENCE') {\n      void fetchConversationEvidence(Number(message.expectedAfterMs)).then(\n        (evidence) => sendResponse({ ok: true, evidence }),\n        (error) => sendResponse({\n          ok: false,\n          error: error instanceof Error ? error.message : String(error),\n        }),\n      );\n      return true;\n    }\n    return false;\n  });\n",
)

# -------------------------
# popup.js
# -------------------------
replace_once(
    "extension/popup.js",
    "function valuePair(model, reasoning) {\n  return model || reasoning ? `${model || 'model ?'} · ${reasoning || 'reasoning ?'}` : '无 / None';\n}\n\n",
    "function valuePair(model, reasoning) {\n  return model || reasoning ? `${model || 'model ?'} · ${reasoning || 'reasoning ?'}` : '无 / None';\n}\n\nfunction autoReasonText(auto) {\n  const reasons = {\n    confirmed_model_mismatch: '响应明确确认了不允许的模型。',\n    reasoning_not_exposed: '模型已确认，但 ChatGPT 未暴露推理强度元数据。',\n    model_not_exposed: '正式请求已经锁定，但流式响应和会话详情都没有暴露可验证模型元数据。',\n    response_verification_timeout: '等待响应确认超时。',\n    conversation_evidence_fetch_failed: '流式响应证据不足，且会话详情回查失败。',\n    response_body_read_failed: '浏览器无法读取响应体。',\n    metadata_incomplete: '响应元数据仍不完整。',\n  };\n  return reasons[auto?.reason] || auto?.reason || null;\n}\n\n",
)
replace_once(
    "extension/popup.js",
    "  const guard = tab?.guard;\n  const enabled = state.settings?.enabled !== false;\n",
    "  const guard = tab?.guard;\n  const auto = tab?.autoVerification;\n  const enabled = state.settings?.enabled !== false;\n",
)
replace_once(
    "extension/popup.js",
    "  const [title, detail, tone] = states[guard?.status] || ['无活动状态 / No active state', '请打开 chatgpt.com 后重试。', 'off'];\n",
    "  let [title, detail, tone] = states[guard?.status] || ['无活动状态 / No active state', '请打开 chatgpt.com 后重试。', 'off'];\n  if (auto?.running) {\n    title = `自动验证中 ${auto.attempt || 1}/${auto.maxAttempts || 2} / Auto verifying`;\n    detail = '正在等待本次真实聊天响应；如果响应证据不足，程序会自动回查会话详情并最多再发送一次测试消息。';\n    tone = 'wait';\n  } else if (auto?.completedAt) {\n    if (auto.outcome === 'verified') {\n      title = '自动验证通过 / Verified';\n      detail = `已完成 ${auto.attempts?.length || 1} 次尝试；响应证据确认 ${auto.responseModel || auto.requestModel || 'locked model'}。`;\n      tone = 'good';\n    } else if (auto.outcome === 'model_verified_reasoning_unconfirmed') {\n      title = '模型已确认，推理未确认 / Partial verification';\n      detail = `已自动重试 ${auto.retries || 0} 次；${autoReasonText(auto)}`;\n      tone = 'wait';\n    } else {\n      title = '自动验证未完全确认 / Auto verification incomplete';\n      detail = `已自动尝试 ${auto.attempts?.length || 0} 次；${autoReasonText(auto) || '证据仍不足。'} 请求层锁定${auto.requestLockConfirmed ? '已确认' : '未确认'}。`;\n      tone = auto.outcome === 'model_mismatch' ? 'bad' : 'wait';\n    }\n  }\n",
)
replace_once(
    "extension/popup.js",
    "    response_body_unparseable: '本次响应格式无法安全解析为元数据。',\n",
    "    response_body_unparseable: '本次响应格式无法安全解析为元数据。',\n    conversation_model_not_exposed: '会话详情也没有暴露模型元数据。',\n    conversation_reasoning_not_exposed: '会话详情确认了模型，但没有暴露推理强度元数据。',\n    auto_verify_response_timeout: '自动验证等待响应确认超时。',\n",
)
regex_once(
    "extension/popup.js",
    r"elements\.autoVerify\.addEventListener\('click', \(\) => \{.*?\n\}\);\n\nasync function load",
    r'''elements.autoVerify.addEventListener('click', () => {
  elements.message.textContent = '正在自动验证；证据不足会自动回查并重试一次 / Auto verification is running…';
  elements.autoVerify.disabled = true;
  void sendMessage({ type: 'GPTLOCK_AUTO_VERIFY' })
    .then(async (result) => {
      await load();
      if (result.outcome === 'verified') {
        elements.message.textContent = `自动验证通过；共尝试 ${result.attempts} 次 / Verified.`;
      } else if (result.outcome === 'model_verified_reasoning_unconfirmed') {
        elements.message.textContent = `模型已确认 ${result.responseModel || result.requestModel || ''}；已自动重试 ${result.retries} 次，但服务端未暴露推理强度。`;
      } else {
        elements.message.textContent = `自动验证未完全确认：${result.reason || 'metadata_incomplete'}；已自动尝试 ${result.attempts} 次，请求锁定=${result.requestLockConfirmed ? '成功' : '未确认'}。`;
      }
    })
    .catch((error) => { elements.message.textContent = `自动验证失败 / Auto verification failed: ${error.message}`; })
    .finally(() => { elements.autoVerify.disabled = false; });
});

async function load''',
)

# -------------------------
# runtime-log.js and tests
# -------------------------
replace_once("extension/runtime-log.js", "const MAX_ARRAY_ITEMS = 100;\n", "const MAX_ARRAY_ITEMS = 250;\n")
replace_once(
    "extension/runtime-log.js",
    "  if (Array.isArray(value)) {\n    const result = value\n      .slice(0, MAX_ARRAY_ITEMS)\n      .map((item) => sanitizeLogValue(item, depth + 1, seen));\n    if (value.length > MAX_ARRAY_ITEMS) result.push(`[truncated:${value.length}]`);\n    return result;\n  }\n",
    "  if (Array.isArray(value)) {\n    const omitted = Math.max(0, value.length - MAX_ARRAY_ITEMS);\n    const result = value\n      .slice(-MAX_ARRAY_ITEMS)\n      .map((item) => sanitizeLogValue(item, depth + 1, seen));\n    if (omitted > 0) result.unshift(`[truncated:${value.length};omitted:${omitted};kept:last]`);\n    return result;\n  }\n",
)
replace_once(
    "extension/tests/runtime-log.test.mjs",
    "test('clips overly long strings without dropping diagnostic context', () => {\n",
    "test('diagnostic array sanitization keeps the newest entries', () => {\n  const entries = Array.from({ length: 300 }, (_, index) => ({ index }));\n  const result = sanitizeLogValue(entries);\n  assert.equal(result[0], '[truncated:300;omitted:50;kept:last]');\n  assert.equal(result[1].index, 50);\n  assert.equal(result.at(-1).index, 299);\n});\n\ntest('clips overly long strings without dropping diagnostic context', () => {\n",
)

# -------------------------
# package syntax checks + versions
# -------------------------
text = read("extension/package.json")
text = text.replace('"version": "0.3.4"', '"version": "0.3.5"')
text = text.replace('"test": "node --test tests/*.test.mjs"', '"test": "node --check background.js && node --check content.js && node --check popup.js && node --test tests/*.test.mjs"')
write("extension/package.json", text)

replace_once("extension/manifest.json", '"version": "0.3.4"', '"version": "0.3.5"')
replace_once("native-core/Cargo.toml", 'version = "0.3.4"', 'version = "0.3.5"')

# Update hard-coded/current docs. Cargo.lock is intentionally refreshed by cargo below.
for path in [
    "README.md",
    "docs/INSTALL.md",
    "docs/USAGE.md",
    "docs/ARCHITECTURE.md",
    "docs/SECURITY.md",
    "extension/options.html",
]:
    text = read(path)
    write(path, text.replace("0.3.4", "0.3.5"))

replace_once(
    "README.md",
    "当前版本：`0.3.5`。本版把产品主流程从“先验证、再允许聊天”调整为“正式聊天请求先锁定，响应验证作为附加确认”，并把“一键自动验证”改成真正的全自动流程：程序会尽力对齐页面选择，并在当前 ChatGPT 对话中自动写入、发送一条可见测试消息，不再要求用户人工发送探针。",
    "当前版本：`0.3.5`。本版延续“正式聊天请求先锁定，响应验证作为附加确认”的主流程，并修复 0.3.4 自动验证在 `model_missing / reasoning_missing` 后直接停在“确认不足”的问题：自动验证现在会等待本次真实响应、回查当前会话详情元数据，并在证据仍不足时自动再发送一次可见测试消息；最终明确反馈是模型未暴露、推理强度未暴露、会话回查失败还是等待超时。页面底部 `5.6 Sol 高` 这类不带 `GPT-` 前缀的选择标签也会被识别。"
)

replace_once(
    "docs/USAGE.md",
    "点击弹窗或设置页的 **“自动验证 / Auto verify”** 后，不需要再人工输入或发送“探针”。程序会自动：",
    "点击弹窗或设置页的 **“自动验证 / Auto verify”** 后，不需要再人工输入或发送“探针”。0.3.5 会对一次自动验证最多执行 2 次可见测试尝试：第一次响应证据不足时先自动回查当前会话详情，仍不足才自动发送第二条测试消息。程序会自动：",
)
replace_once(
    "docs/USAGE.md",
    "9. 将全过程的技术状态写入运行日志/诊断包。",
    "9. 若流式响应未暴露模型/推理元数据，自动读取当前会话详情中的最新助手消息元数据作为第二证据源；\n10. 若仍为 `unverified`，自动再发送一次可见测试消息；\n11. 最终明确显示失败/不足原因与已执行的尝试次数，并将全过程写入运行日志/诊断包。",
)

# Refresh the local package entry in Cargo.lock without changing dependency versions.
lock_path = ROOT / "native-core/Cargo.lock"
lock = lock_path.read_text(encoding="utf-8")
old = 'name = "gptlock-core"\nversion = "0.3.4"'
new = 'name = "gptlock-core"\nversion = "0.3.5"'
if old not in lock:
    raise RuntimeError("native-core/Cargo.lock: gptlock-core 0.3.4 entry not found")
lock_path.write_text(lock.replace(old, new, 1), encoding="utf-8")

print("Applied GPTLock 0.3.5 hotfix patches")
