from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one replacement target, found {count}')
    p.write_text(text.replace(old, new, 1))


# 1) Native core: probe the installed compiled engine and surface only generic feature flags.
path = 'native-core/src/private_engine.rs'
replace_once(
    path,
    '''pub fn capability() -> Value {
    let path = configured_path().ok();
    serde_json::json!({
        "available": path.as_deref().map(usable_file).unwrap_or(false),
        "protocolVersion": PRIVATE_ENGINE_PROTOCOL,
    })
}
''',
    '''fn capability_from_probe(installed: bool, response: Option<&Value>) -> Value {
    let mut capability = serde_json::json!({
        "available": installed,
        "protocolVersion": PRIVATE_ENGINE_PROTOCOL,
        "capabilityProbe": false,
        "requestEvaluation": false,
        "responseEvaluation": false,
        "contextEvaluation": false,
        "contextBudgetEvaluation": false,
        "compactRequestPatches": false,
    });
    if !installed {
        return capability;
    }
    let Some(response) = response else {
        return capability;
    };
    if response.get("ok").and_then(Value::as_bool) != Some(true)
        || response.get("protocolVersion").and_then(Value::as_u64) != Some(PRIVATE_ENGINE_PROTOCOL)
    {
        return capability;
    }
    let Some(data) = response.get("data").and_then(Value::as_object) else {
        return capability;
    };
    let Some(object) = capability.as_object_mut() else {
        return capability;
    };
    object.insert("capabilityProbe".to_string(), Value::Bool(true));
    for feature in [
        "requestEvaluation",
        "responseEvaluation",
        "contextEvaluation",
        "contextBudgetEvaluation",
        "compactRequestPatches",
    ] {
        object.insert(
            feature.to_string(),
            Value::Bool(data.get(feature).and_then(Value::as_bool) == Some(true)),
        );
    }
    capability
}

pub fn capability() -> Value {
    let installed = configured_path()
        .map(|path| usable_file(&path))
        .unwrap_or(false);
    if !installed {
        return capability_from_probe(false, None);
    }
    let probe = serde_json::json!({
        "id": "native-capability-probe",
        "type": "get_capabilities",
        "protocolVersion": PRIVATE_ENGINE_PROTOCOL,
        "payload": {},
    });
    let response = request(probe).ok();
    capability_from_probe(true, response.as_ref())
}
''',
)
replace_once(
    path,
    '''    #[test]
    fn default_artifact_name_is_stable() {
        assert!(executable_name().starts_with("gptlock-engine"));
    }
''',
    '''    #[test]
    fn capability_probe_exposes_only_declared_feature_flags() {
        let response = serde_json::json!({
            "id": "cap",
            "ok": true,
            "protocolVersion": 2,
            "data": {
                "requestEvaluation": true,
                "responseEvaluation": true,
                "contextEvaluation": true,
                "contextBudgetEvaluation": true,
                "compactRequestPatches": true,
                "privateRuleDump": true
            }
        });
        let capability = capability_from_probe(true, Some(&response));
        assert_eq!(capability["available"], true);
        assert_eq!(capability["capabilityProbe"], true);
        assert_eq!(capability["contextBudgetEvaluation"], true);
        assert!(capability.get("privateRuleDump").is_none());
    }

    #[test]
    fn capability_probe_is_backward_compatible_with_an_older_engine() {
        let response = serde_json::json!({
            "id": "cap",
            "ok": true,
            "protocolVersion": 2,
            "data": { "contextEvaluation": true }
        });
        let capability = capability_from_probe(true, Some(&response));
        assert_eq!(capability["available"], true);
        assert_eq!(capability["contextEvaluation"], true);
        assert_eq!(capability["contextBudgetEvaluation"], false);
    }

    #[test]
    fn default_artifact_name_is_stable() {
        assert!(executable_name().starts_with("gptlock-engine"));
    }
''',
)

# 2) Extension native channel: cache a whitelisted feature set and support feature gating.
Path('extension/private-core-channel.js').write_text(r'''import { createCoreBridgeRequest, parseCoreBridgeResponse } from './core-bridge.js';

const NATIVE_HOST = 'com.gptlock.core';
const REQUEST_TIMEOUT_MS = 4500;
const CAPABILITY_TTL_MS = 30_000;
const PRIVATE_ENGINE_FEATURES = Object.freeze([
  'requestEvaluation',
  'responseEvaluation',
  'contextEvaluation',
  'contextBudgetEvaluation',
  'compactRequestPatches',
]);

export function normalizePrivateEngineCapabilities(response) {
  const engine = response?.ok === true && response?.data?.privateEngine && typeof response.data.privateEngine === 'object'
    ? response.data.privateEngine
    : {};
  const capability = {
    available: engine.available === true && Number(engine.protocolVersion) === 2,
    protocolVersion: Number(engine.protocolVersion) === 2 ? 2 : null,
    capabilityProbe: engine.capabilityProbe === true,
  };
  for (const feature of PRIVATE_ENGINE_FEATURES) capability[feature] = engine[feature] === true;
  return capability;
}

export class PrivateCoreChannel {
  constructor() {
    this.port = null;
    this.sequence = 0;
    this.pending = new Map();
    this.capabilityCache = null;
  }

  connect() {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    this.port = port;
    port.onMessage.addListener((message) => {
      const id = String(message?.id ?? '');
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      const detail = chrome.runtime.lastError?.message || 'Private core channel disconnected';
      this.port = null;
      this.capabilityCache = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(detail));
      }
      this.pending.clear();
    });
    return port;
  }

  nextId(prefix = 'private') {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  requestRaw(message) {
    const id = String(message?.id ?? '');
    if (!id) return Promise.reject(new TypeError('private core channel message id is required'));
    const port = this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Private core channel timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async capabilities() {
    const now = Date.now();
    if (this.capabilityCache && this.capabilityCache.expiresAt > now) {
      return this.capabilityCache.data;
    }
    try {
      const response = await this.requestRaw({ id: this.nextId('cap'), type: 'get_capabilities' });
      const data = normalizePrivateEngineCapabilities(response);
      this.capabilityCache = { data, expiresAt: now + CAPABILITY_TTL_MS };
      return data;
    } catch {
      const data = normalizePrivateEngineCapabilities(null);
      this.capabilityCache = { data, expiresAt: now + Math.min(CAPABILITY_TTL_MS, 5000) };
      return data;
    }
  }

  async isAvailable() {
    return (await this.capabilities()).available;
  }

  async supports(feature) {
    if (!PRIVATE_ENGINE_FEATURES.includes(feature)) return false;
    const capability = await this.capabilities();
    return capability.available && capability.capabilityProbe && capability[feature] === true;
  }

  async request(type, payload, prefix = 'private') {
    const id = this.nextId(prefix);
    const message = createCoreBridgeRequest(id, type, payload);
    const raw = await this.requestRaw(message);
    const parsed = parseCoreBridgeResponse(raw, id);
    if (!parsed.ok) {
      this.capabilityCache = null;
      const error = new Error(parsed.error.message);
      error.code = parsed.error.code;
      throw error;
    }
    return parsed.data;
  }

  invalidate() {
    this.capabilityCache = null;
  }
}

export const privateCoreChannel = new PrivateCoreChannel();
''')

# 3) Budget bridge: require the concrete private-engine feature, not mere artifact presence.
path = 'extension/private-context-bridge.js'
replace_once(
    path,
    '''    try {
      if (!(await privateCoreChannel.isAvailable())) {
        sendResponse({ ok: false, error: 'private_engine_unavailable' });
        return;
      }
      if (message.type === BUDGET_MESSAGE_TYPE) {
        const budget = sanitizePrivateContextBudgetPayload(message.payload);
''',
    '''    try {
      if (message.type === BUDGET_MESSAGE_TYPE) {
        if (!(await privateCoreChannel.supports('contextBudgetEvaluation'))) {
          sendResponse({ ok: false, error: 'private_context_budget_unsupported' });
          return;
        }
        const budget = sanitizePrivateContextBudgetPayload(message.payload);
''',
)
replace_once(
    path,
    '''        sendResponse({ ok: true, data: normalizePrivateContextBudgetResult(raw) });
        return;
      }
      const payload = sanitizePrivateContextPayload(message.payload);
''',
    '''        sendResponse({ ok: true, data: normalizePrivateContextBudgetResult(raw) });
        return;
      }
      if (!(await privateCoreChannel.isAvailable())) {
        sendResponse({ ok: false, error: 'private_engine_unavailable' });
        return;
      }
      const payload = sanitizePrivateContextPayload(message.payload);
''',
)

# 4) Private engine: tighten model-family matching while it is now the authority.
path = 'private-engine/src/context_budget.rs'
replace_once(
    path,
    '''fn model_window(model: Option<&str>) -> (u64, &'static str) {
    let Some(model) = normalize_model(model) else {
        return (DEFAULT_CONTEXT_WINDOW_TOKENS, "conservative-fallback");
    };
    if model.starts_with("gpt-5.4-mini") || model.starts_with("gpt-5.4-nano") {
        return (400_000, "model-window");
    }
    if model.starts_with("gpt-5.6") || model.starts_with("gpt-5.5") || model.starts_with("gpt-5.4")
    {
        return (1_050_000, "model-window");
    }
    (DEFAULT_CONTEXT_WINDOW_TOKENS, "conservative-fallback")
}
''',
    '''fn matches_model_family(model: &str, family: &str) -> bool {
    model == family
        || model
            .strip_prefix(family)
            .map(|suffix| suffix.starts_with('-'))
            .unwrap_or(false)
}

fn model_window(model: Option<&str>) -> (u64, &'static str) {
    let Some(model) = normalize_model(model) else {
        return (DEFAULT_CONTEXT_WINDOW_TOKENS, "conservative-fallback");
    };
    if matches_model_family(&model, "gpt-5.4-mini") || matches_model_family(&model, "gpt-5.4-nano") {
        return (400_000, "model-window");
    }
    if matches_model_family(&model, "gpt-5.6")
        || matches_model_family(&model, "gpt-5.5")
        || matches_model_family(&model, "gpt-5.4")
    {
        return (1_050_000, "model-window");
    }
    (DEFAULT_CONTEXT_WINDOW_TOKENS, "conservative-fallback")
}
''',
)
replace_once(
    path,
    '''    #[test]
    fn learned_upper_bound_caps_operational_budget() {
''',
    '''    #[test]
    fn model_family_matching_does_not_accept_lookalike_prefixes() {
        let result = evaluate_context_budget(&ContextBudgetInput {
            model: Some("gpt-5.4-minimum".to_string()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(result.nominal_limit_tokens, DEFAULT_CONTEXT_WINDOW_TOKENS);
        assert_eq!(result.context_window_source, "conservative-fallback");
    }

    #[test]
    fn learned_upper_bound_caps_operational_budget() {
''',
)

# 5) Legacy context collector: retain raw active-branch parts transiently so the compiled engine can do the math.
path = 'extension/context-budget.js'
replace_once(
    path,
    '''  let lastHardLimitFingerprint = null;
''',
    '''  let lastHardLimitFingerprint = null;
  let privateSendCheckInFlight = false;
  let privateAuthorityReplayUntil = 0;
''',
)
replace_once(
    path,
    '''    let tokens = 0;
    let characters = 0;
    let countedMessages = 0;
    for (const message of messages) {
      const text = conversationMessageText(message);
      const media = conversationMessageMediaCounts(message);
      if (!text && media.images === 0 && media.attachments === 0) continue;
      characters += text.length;
      tokens += estimateTextTokens(text)
        + (media.images * IMAGE_TOKEN_ESTIMATE)
        + (media.attachments * ATTACHMENT_TOKEN_ESTIMATE)
        + MESSAGE_OVERHEAD_TOKENS;
      countedMessages += 1;
    }
    if (!countedMessages) return null;
    return {
      tokens: Math.max(0, Math.ceil(tokens)),
      characters: Math.max(0, Math.ceil(characters)),
      messageCount: countedMessages,
      currentNode: payload?.current_node ? String(payload.current_node).slice(0, 256) : null,
    };
''',
    '''    let tokens = 0;
    let characters = 0;
    let countedMessages = 0;
    const privateHistoryParts = [];
    for (const message of messages) {
      const text = conversationMessageText(message);
      const media = conversationMessageMediaCounts(message);
      if (!text && media.images === 0 && media.attachments === 0) continue;
      privateHistoryParts.push({ text, images: media.images, attachments: media.attachments });
      characters += text.length;
      tokens += estimateTextTokens(text)
        + (media.images * IMAGE_TOKEN_ESTIMATE)
        + (media.attachments * ATTACHMENT_TOKEN_ESTIMATE)
        + MESSAGE_OVERHEAD_TOKENS;
      countedMessages += 1;
    }
    if (!countedMessages) return null;
    return {
      tokens: Math.max(0, Math.ceil(tokens)),
      characters: Math.max(0, Math.ceil(characters)),
      messageCount: countedMessages,
      currentNode: payload?.current_node ? String(payload.current_node).slice(0, 256) : null,
      privateHistoryParts,
    };
''',
)
replace_once(
    path,
    '''  const api = {
''',
    '''  function privateHistorySnapshot() {
    const conversationKey = currentConversationKey();
    const cacheFresh = Boolean(
      conversationMetricsCache
      && conversationMetricsCache.conversationKey === conversationKey
      && Date.now() - conversationMetricsCheckedAt <= CONVERSATION_METRICS_MAX_AGE_MS
      && Array.isArray(conversationMetricsCache.privateHistoryParts)
      && conversationMetricsCache.privateHistoryParts.length > 0
    );
    if (!cacheFresh) return null;
    return {
      conversationKey,
      model: detectModel(),
      measuredAt: conversationMetricsCache.measuredAt || null,
      history: conversationMetricsCache.privateHistoryParts.map((part) => ({
        text: typeof part?.text === 'string' ? part.text : '',
        images: Math.max(0, Number(part?.images) || 0),
        attachments: Math.max(0, Number(part?.attachments) || 0),
      })),
    };
  }

  const api = {
''',
)
replace_once(
    path,
    '''    restorePendingBypassRecord,
    snapshot: () => lastSnapshot,
''',
    '''    restorePendingBypassRecord,
    privateHistorySnapshot,
    refreshPrivateHistory: async () => {
      await refreshConversationMetrics(true);
      return privateHistorySnapshot();
    },
    snapshot: () => lastSnapshot,
''',
)
replace_once(
    path,
    '''  function indicatorDetail(snapshot) {
    const source = snapshot.contextWindowSource === 'openai-api-model-window'
      ? '公开模型窗口'
      : '保守回退窗口';
''',
    '''  function indicatorDetail(snapshot) {
    const source = snapshot.budgetAuthority === 'private-engine'
      ? '本地私有核心'
      : snapshot.contextWindowSource === 'openai-api-model-window'
        ? '公开模型窗口'
        : '保守回退窗口';
''',
)
replace_once(
    path,
    '''  function publishSnapshot(next) {
    const previousFingerprint = lastSnapshot
''',
    '''  function publishSnapshot(next) {
    const authority = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__;
    if (authority?.applyToSnapshot) {
      try { next = authority.applyToSnapshot(next) || next; } catch { /* compatibility fallback */ }
    }
    const previousFingerprint = lastSnapshot
''',
)
replace_once(
    path,
    '''  function showContextWarning(snapshot) {
''',
    '''  function replayPotentialSend() {
    privateAuthorityReplayUntil = Date.now() + 1_500;
    const button = findSendButton();
    if (button) {
      button.click();
      return;
    }
    const composer = findComposer();
    const form = composer?.closest('form');
    if (form?.requestSubmit) form.requestSubmit();
  }

  function showContextWarning(snapshot) {
''',
)
replace_once(
    path,
    '''    if (bypassUntil > now) {
      bypassUntil = 0;
      sendAllowedAt = now;
      return true;
    }

    recompute();
''',
    '''    if (privateAuthorityReplayUntil > now) {
      privateAuthorityReplayUntil = 0;
      sendAllowedAt = now;
      return true;
    }
    if (bypassUntil > now) {
      bypassUntil = 0;
      sendAllowedAt = now;
      return true;
    }

    const authority = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__;
    if (authority?.shouldGuardSend?.()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (privateSendCheckInFlight) return false;
      privateSendCheckInFlight = true;
      void authority.evaluateForSend().then((outcome) => {
        if (outcome?.ok && outcome.result) {
          let next = snapshotNow();
          next = authority.applyResultToSnapshot?.(next, outcome.result, outcome) || next;
          publishSnapshot(next);
          if (next.wouldExceed) showContextWarning(next);
          else replayPotentialSend();
          return;
        }
        recompute();
        const fallback = lastSnapshot;
        if (fallback?.wouldExceed) showContextWarning(fallback);
        else replayPotentialSend();
      }).catch(() => {
        recompute();
        const fallback = lastSnapshot;
        if (fallback?.wouldExceed) showContextWarning(fallback);
        else replayPotentialSend();
      }).finally(() => {
        privateSendCheckInFlight = false;
      });
      return false;
    }

    recompute();
''',
)

# 6) Replace the former shadow with the private-engine authority controller.
Path('extension/private-context-budget-authority.js').write_text(r'''(() => {
  const KEY = '__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__';
  if (globalThis[KEY]) return;

  const MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_BUDGET';
  const REFRESH_MS = 30_000;
  const MIN_BACKGROUND_REFRESH_MS = 10_000;
  const STALE_REFRESH_DELAY_MS = 1_500;
  const ERROR_BACKOFF_MS = 5 * 60 * 1000;
  const MAX_SOURCE_AGE_MS = 15_000;
  const MAX_PARTS = 20_000;
  const MAX_MEDIA_PER_PART = 32;

  function boundedCount(value, max = MAX_MEDIA_PER_PART) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(max, Math.floor(number));
  }

  function normalizePart(value = {}) {
    return {
      text: typeof value?.text === 'string' ? value.text : '',
      images: boundedCount(value?.images),
      attachments: boundedCount(value?.attachments),
    };
  }

  function buildBudgetPayload({ model = null, history = [], draft = {}, profile = null } = {}) {
    const normalizedHistory = Array.isArray(history)
      ? history.slice(0, MAX_PARTS).map(normalizePart)
      : [];
    return {
      model: typeof model === 'string' ? model.slice(0, 128) : null,
      history: normalizedHistory,
      draft: normalizePart(draft),
      profile: {
        adaptiveSafeLimitTokens: Number(profile?.adaptiveSafeLimitTokens) || 0,
        hardLimitUpperBoundTokens: Number(profile?.hardLimitUpperBoundTokens) || 0,
        confirmedConversationTokens: Number(profile?.confirmedConversationTokens) || 0,
      },
    };
  }

  function applyResultToSnapshot(base, result, meta = {}) {
    if (!base || !result) return base;
    return {
      ...base,
      nominalLimitTokens: Number(result.nominalLimitTokens) || 0,
      baseSafeLimitTokens: Number(result.baseSafeLimitTokens) || 0,
      adaptiveSafeLimitTokens: Number(result.adaptiveSafeLimitTokens) || 0,
      hardLimitUpperBoundTokens: Number(result.hardLimitUpperBoundTokens) || 0,
      confirmedLowerBoundTokens: Number(result.confirmedLowerBoundTokens) || 0,
      safeLimitTokens: Number(result.safeLimitTokens) || 0,
      reserveTokens: Number(result.reserveTokens) || 0,
      historyTokens: Number(result.historyTokens) || 0,
      draftTokens: Number(result.draftTokens) || 0,
      usedTokens: Number(result.usedTokens) || 0,
      projectedTokens: Number(result.projectedTokens) || 0,
      percent: Number(result.percentUsed) || 0,
      projectedPercent: Number(result.projectedPercent) || 0,
      remainingTokens: Number(result.remainingTokens) || 0,
      warning: Boolean(result.warning),
      wouldExceed: Boolean(result.wouldExceed),
      adaptiveActive: Boolean(result.adaptiveActive),
      hardLimitActive: Boolean(result.hardLimitActive),
      contextWindowSource: String(result.contextWindowSource || base.contextWindowSource || 'private-engine'),
      fullConversationTokens: Number(result.usedTokens) || 0,
      budgetAuthority: 'private-engine',
      privateBudgetCoverage: meta.coverage || 'conversation-tree',
      privateBudgetEvaluatedAt: meta.evaluatedAt || new Date().toISOString(),
      estimateOnly: true,
    };
  }

  const api = {
    state: null,
    normalizePart,
    buildBudgetPayload,
    applyResultToSnapshot,
    shouldGuardSend() {
      const state = api.state;
      if (!state?.available || Date.now() < Number(state.retryAfter || 0)) return false;
      const source = globalThis.__GPTLOCK_CONTEXT_BUDGET__?.privateHistorySnapshot?.();
      return Boolean(
        source
        && source.conversationKey === state.conversationKey
        && String(source.model || '') === String(state.model || ''),
      );
    },
    applyToSnapshot(snapshot) {
      const state = api.state;
      if (!state?.available || state.stale || !state.privateResult) return snapshot;
      if (Date.now() - Number(state.evaluatedAtMs || 0) > REFRESH_MS + 5_000) return snapshot;
      if (snapshot?.conversationKey !== state.conversationKey) return snapshot;
      if (String(snapshot?.model || '') !== String(state.model || '')) return snapshot;
      return applyResultToSnapshot(snapshot, state.privateResult, state);
    },
    async evaluateForSend() {
      return evaluate({ reason: 'send', refreshHistory: true, force: true });
    },
    invalidate() {
      if (api.state) api.state = { ...api.state, stale: true };
    },
  };
  globalThis[KEY] = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let inFlight = false;
  let lastAttemptAt = 0;
  let refreshTimer = null;

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function textOf(element) {
    return element?.innerText || element?.textContent || '';
  }

  function mediaCounts(root) {
    if (!root?.querySelectorAll) return { images: 0, attachments: 0 };
    return {
      images: boundedCount(root.querySelectorAll('img').length),
      attachments: boundedCount(root.querySelectorAll('[data-testid*="file" i],[data-testid*="attachment" i],a[download]').length),
    };
  }

  function currentDraftPart() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-testid*="prompt"]',
      '[contenteditable="true"][data-testid*="composer"]',
      '.ProseMirror[contenteditable="true"]',
    ];
    const composer = selectors
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element)) || null;
    if (!composer) return normalizePart();
    const root = composer.closest('form') || composer.parentElement || composer;
    const text = 'value' in composer ? composer.value || '' : textOf(composer);
    return normalizePart({ text, ...mediaCounts(root) });
  }

  function sourceIsFresh(source) {
    const measuredAt = Date.parse(source?.measuredAt || '');
    return Number.isFinite(measuredAt) && Date.now() - measuredAt <= MAX_SOURCE_AGE_MS;
  }

  async function evaluationSource(refreshHistory) {
    const legacy = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    if (!legacy) return null;
    const source = refreshHistory && typeof legacy.refreshPrivateHistory === 'function'
      ? await legacy.refreshPrivateHistory()
      : legacy.privateHistorySnapshot?.();
    if (!source || !sourceIsFresh(source) || !Array.isArray(source.history) || !source.history.length) return null;
    return {
      source,
      payload: buildBudgetPayload({
        model: source.model,
        history: source.history,
        draft: currentDraftPart(),
        profile: legacy.learningProfile?.() || null,
      }),
    };
  }

  function failure(error, preserveAvailability = false) {
    const code = String(error || 'private_context_budget_unavailable').slice(0, 80);
    const previous = api.state;
    api.state = {
      available: preserveAvailability ? Boolean(previous?.available) : false,
      stale: true,
      error: code,
      retryAfter: preserveAvailability ? 0 : Date.now() + ERROR_BACKOFF_MS,
      privateResult: null,
      evaluatedAt: null,
      evaluatedAtMs: 0,
      conversationKey: null,
      model: null,
      coverage: null,
    };
    return { ok: false, error: code };
  }

  async function evaluate({ reason = 'background', refreshHistory = false, force = false } = {}) {
    const now = Date.now();
    if (inFlight) return { ok: false, error: 'private_context_budget_busy' };
    if (!force && api.state?.retryAfter && now < api.state.retryAfter) return { ok: false, error: api.state.error || 'private_context_budget_backoff' };
    const input = await evaluationSource(refreshHistory);
    if (!input) return failure('full_history_unavailable', true);

    inFlight = true;
    lastAttemptAt = now;
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload: input.payload });
      if (!response?.ok || !response.data) return failure(response?.error || 'private_context_budget_unavailable');
      const evaluatedAt = new Date().toISOString();
      api.state = {
        available: true,
        stale: false,
        error: null,
        retryAfter: 0,
        privateResult: response.data,
        evaluatedAt,
        evaluatedAtMs: Date.now(),
        conversationKey: input.source.conversationKey,
        model: input.source.model,
        coverage: 'conversation-tree',
        reason,
      };
      window.dispatchEvent(new CustomEvent('gptlock:private-context-budget-authority', {
        detail: {
          available: true,
          evaluatedAt,
          conversationKey: input.source.conversationKey,
          model: input.source.model,
          coverage: 'conversation-tree',
          result: response.data,
        },
      }));
      return { ok: true, result: response.data, ...api.state };
    } catch (error) {
      return failure(error?.code || 'private_context_budget_unavailable');
    } finally {
      inFlight = false;
    }
  }

  function scheduleRefresh(delay = STALE_REFRESH_DELAY_MS) {
    if (refreshTimer !== null) return;
    const elapsed = Date.now() - lastAttemptAt;
    const wait = Math.max(delay, MIN_BACKGROUND_REFRESH_MS - elapsed, 0);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void evaluate({ reason: 'background' });
    }, wait);
  }

  function markStale() {
    api.invalidate();
    scheduleRefresh();
  }

  window.addEventListener('gptlock:context-budget', () => scheduleRefresh(500));
  document.addEventListener('input', markStale, true);
  window.addEventListener('popstate', markStale);
  window.addEventListener('hashchange', markStale);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh(250);
  });
  window.setInterval(() => void evaluate({ reason: 'periodic' }), REFRESH_MS);
  window.setTimeout(() => void evaluate({ reason: 'initial', refreshHistory: true }), 1_500);
})();
''')
Path('extension/private-context-budget-shadow.js').unlink()

# 7) Manifest/package switch.
path = 'extension/manifest.json'
replace_once(path, '"private-context-budget-shadow.js",', '"private-context-budget-authority.js",')
path = 'extension/package.json'
replace_once(path, 'node --check private-context-budget-shadow.js', 'node --check private-context-budget-authority.js')

# 8) Replace old shadow unit tests with authority + feature-gating tests.
Path('extension/tests/private-context-budget-authority.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../private-context-budget-authority.js?test=${Date.now()}`);
const authority = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__;

test('authority payload keeps only generic local text/media/profile facts', () => {
  const payload = authority.buildBudgetPayload({
    model: 'gpt-5.6-sol',
    history: [{ text: 'hello', images: 2, attachments: 1, endpoint: '/secret' }],
    draft: { text: 'draft', images: 1 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: 950000,
      confirmedConversationTokens: 900000,
      noticeText: 'secret',
    },
  });
  assert.deepEqual(payload, {
    model: 'gpt-5.6-sol',
    history: [{ text: 'hello', images: 2, attachments: 1 }],
    draft: { text: 'draft', images: 1, attachments: 0 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: 950000,
      confirmedConversationTokens: 900000,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /endpoint|noticeText|secret/);
});

test('authority maps private numeric decisions onto the legacy compatibility snapshot', () => {
  const snapshot = authority.applyResultToSnapshot({
    conversationKey: 'conversation:1',
    model: 'gpt-5.6-sol',
    fullConversationCharacters: 1234,
  }, {
    nominalLimitTokens: 1050000,
    baseSafeLimitTokens: 924000,
    adaptiveSafeLimitTokens: 0,
    hardLimitUpperBoundTokens: 0,
    confirmedLowerBoundTokens: 0,
    safeLimitTokens: 924000,
    reserveTokens: 42000,
    historyTokens: 1000,
    draftTokens: 20,
    usedTokens: 1020,
    projectedTokens: 43020,
    percentUsed: 0.11,
    projectedPercent: 4.65,
    remainingTokens: 922980,
    warning: false,
    wouldExceed: false,
    adaptiveActive: false,
    hardLimitActive: false,
    contextWindowSource: 'model-window',
  }, { evaluatedAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(snapshot.budgetAuthority, 'private-engine');
  assert.equal(snapshot.fullConversationTokens, 1020);
  assert.equal(snapshot.safeLimitTokens, 924000);
  assert.equal(snapshot.percent, 0.11);
  assert.equal(snapshot.fullConversationCharacters, 1234);
});

test('authority media counts are bounded without implementing token weights', () => {
  assert.deepEqual(
    authority.normalizePart({ text: 'x', images: 999, attachments: -1 }),
    { text: 'x', images: 32, attachments: 0 },
  );
});
''')
Path('extension/tests/private-context-budget-shadow.test.mjs').unlink()

Path('extension/tests/private-core-channel-capability.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';

const channelModule = await import(`../private-core-channel.js?test=${Date.now()}`);
const { PrivateCoreChannel, normalizePrivateEngineCapabilities } = channelModule;

test('capability normalization whitelists only supported compiled-engine features', () => {
  const capability = normalizePrivateEngineCapabilities({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextBudgetEvaluation: true,
        contextEvaluation: true,
        privateRuleDump: true,
      },
    },
  });
  assert.equal(capability.available, true);
  assert.equal(capability.contextBudgetEvaluation, true);
  assert.equal(capability.contextEvaluation, true);
  assert.equal(Object.hasOwn(capability, 'privateRuleDump'), false);
});

test('supports requires both an executable probe and the requested feature', async () => {
  const channel = new PrivateCoreChannel();
  channel.requestRaw = async () => ({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextEvaluation: true,
        contextBudgetEvaluation: false,
      },
    },
  });
  assert.equal(await channel.supports('contextEvaluation'), true);
  assert.equal(await channel.supports('contextBudgetEvaluation'), false);
  assert.equal(await channel.supports('unknownFeature'), false);
});
''')

Path('extension/tests/private-context-authority-integration.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [manifestText, budgetText, packageText] = await Promise.all([
  readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  readFile(new URL('../context-budget.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

test('extension loads the private context budget authority instead of the old shadow', () => {
  assert.match(manifestText, /private-context-budget-authority\.js/);
  assert.doesNotMatch(manifestText, /private-context-budget-shadow\.js/);
  assert.match(packageText, /node --check private-context-budget-authority\.js/);
  assert.doesNotMatch(packageText, /node --check private-context-budget-shadow\.js/);
});

test('legacy context guard delegates exact send-time decisions to the private authority', () => {
  assert.match(budgetText, /__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__/);
  assert.match(budgetText, /authority\?\.shouldGuardSend\?\.\(\)/);
  assert.match(budgetText, /authority\.evaluateForSend\(\)/);
  assert.match(budgetText, /refreshPrivateHistory/);
  assert.match(budgetText, /privateHistoryParts/);
});
''')

# Guard against accidental raw-content persistence in the new authority module.
authority_text = Path('extension/private-context-budget-authority.js').read_text()
for forbidden in ['chrome.storage.local.set', 'runtimeLogs', '/api/v1/account/runtime-logs']:
    if forbidden in authority_text:
        raise SystemExit(f'authority module must not persist/upload raw context: {forbidden}')

# Ensure no active runtime/test reference still names the old shadow implementation.
for file in [Path('extension/manifest.json'), Path('extension/package.json')]:
    if 'private-context-budget-shadow.js' in file.read_text():
        raise SystemExit(f'old shadow reference remains in {file}')
