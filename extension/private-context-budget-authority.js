(() => {
  const KEY = '__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__';
  if (globalThis[KEY]) return;

  const MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_BUDGET';
  const REFRESH_MS = 30_000;
  const MIN_BACKGROUND_REFRESH_MS = 10_000;
  const STALE_REFRESH_DELAY_MS = 1_500;
  const ERROR_BACKOFF_MS = 5 * 60 * 1000;
  const TRANSIENT_ERROR_BACKOFF_MS = 10_000;
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
      remainingPercent: Number.isFinite(Number(result.remainingPercent))
        ? Math.min(100, Math.max(0, Number(result.remainingPercent)))
        : null,
      remainingTokens: Number(result.remainingTokens) || 0,
      warning: Boolean(result.warning),
      wouldExceed: Boolean(result.wouldExceed),
      adaptiveActive: Boolean(result.adaptiveActive),
      hardLimitActive: Boolean(result.hardLimitActive),
      contextWindowSource: String(result.contextWindowSource || base.contextWindowSource || 'private-engine'),
      fullConversationTokens: Number(result.usedTokens) || 0,
      budgetAuthority: 'private-engine',
      budgetAvailable: true,
      privateBudgetCoverage: meta.coverage || 'conversation-tree',
      privateBudgetEvaluatedAt: meta.evaluatedAt || new Date().toISOString(),
      privateBudgetStale: Boolean(meta.stale),
      privateBudgetError: meta.error || null,
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
      if (!state?.available || !state.privateResult) return snapshot;
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

  function sourceIsFresh(source, maxAgeMs = MAX_SOURCE_AGE_MS) {
    const measuredAt = Date.parse(source?.measuredAt || '');
    return Number.isFinite(measuredAt) && Date.now() - measuredAt <= maxAgeMs;
  }

  async function evaluationSource(refreshHistory) {
    const legacy = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    if (!legacy) return null;
    const source = refreshHistory && typeof legacy.refreshPrivateHistory === 'function'
      ? await legacy.refreshPrivateHistory()
      : legacy.privateHistorySnapshot?.();
    const maxAgeMs = refreshHistory ? 5_000 : MAX_SOURCE_AGE_MS;
    if (!source || !sourceIsFresh(source, maxAgeMs) || !Array.isArray(source.history) || !source.history.length) return null;
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

  function retryDelayFor(code) {
    return /(?:unavailable|unsupported|disconnect|timed?_?out|timeout|busy)/i.test(String(code || ''))
      ? TRANSIENT_ERROR_BACKOFF_MS
      : ERROR_BACKOFF_MS;
  }

  function failure(error, preserveAvailability = false) {
    const code = String(error || 'private_context_budget_unavailable').slice(0, 80);
    const previous = api.state;
    if (preserveAvailability && previous?.available && previous?.privateResult) {
      api.state = {
        ...previous,
        stale: true,
        error: code,
        retryAfter: 0,
        reason: 'source-refresh-pending',
      };
      return { ok: false, error: code, preserved: true };
    }
    api.state = {
      available: false,
      stale: true,
      error: code,
      retryAfter: preserveAvailability ? 0 : Date.now() + retryDelayFor(code),
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

    inFlight = true;
    lastAttemptAt = now;
    try {
      const input = await evaluationSource(refreshHistory);
      if (!input) return failure('full_history_unavailable', true);
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
