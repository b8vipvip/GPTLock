(() => {
  const KEY = '__GPTLOCK_PRIVATE_CONTEXT_REMAINING__';
  if (globalThis[KEY]) return;

  const MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_EVALUATE';
  const REFRESH_MS = 750;
  const PRIVATE_RESULT_MAX_AGE_MS = 5_000;

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
  }

  function boundedMetric(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number));
  }

  function buildPrivateContextPayload(snapshot = null, profile = null) {
    return {
      snapshot: {
        hardLimitVisible: Boolean(snapshot?.hardLimitVisible),
        cumulativeTokens: boundedMetric(snapshot?.cumulativeConversationTokens),
        cumulativeCharacters: boundedMetric(snapshot?.cumulativeConversationCharacters),
        cumulativeMessages: boundedMetric(snapshot?.cumulativeMessageCount),
        fallbackSafeLimitTokens: boundedMetric(snapshot?.safeLimitTokens),
        fallbackRemainingTokens: boundedMetric(snapshot?.remainingTokens),
      },
      profile: {
        hardLimitObservedTokens: boundedMetric(profile?.hardLimitObservedTokens),
        hardLimitObservedCharacters: boundedMetric(profile?.hardLimitObservedCharacters),
        hardLimitObservedMessages: boundedMetric(profile?.hardLimitObservedMessages),
      },
    };
  }

  function payloadFingerprint(payload) {
    const snapshot = payload?.snapshot || {};
    const profile = payload?.profile || {};
    return [
      snapshot.hardLimitVisible ? 1 : 0,
      snapshot.cumulativeTokens ?? '',
      snapshot.cumulativeCharacters ?? '',
      snapshot.cumulativeMessages ?? '',
      snapshot.fallbackSafeLimitTokens ?? '',
      snapshot.fallbackRemainingTokens ?? '',
      profile.hardLimitObservedTokens ?? '',
      profile.hardLimitObservedCharacters ?? '',
      profile.hardLimitObservedMessages ?? '',
    ].join(':');
  }

  function normalizePrivateResult(value) {
    const percent = Number(value?.percent);
    const source = String(value?.source ?? '').trim();
    if (!Number.isFinite(percent) || !source || source.length > 96) return null;
    return { percent: clampPercent(percent), source, privateEngine: true };
  }

  function fallbackRemaining(snapshot = null) {
    if (snapshot?.hardLimitVisible) {
      return { percent: 0, source: 'visible-boundary-fallback', privateEngine: false };
    }
    const safeLimit = Math.max(0, Number(snapshot?.safeLimitTokens) || 0);
    const remaining = Math.max(0, Number(snapshot?.remainingTokens) || 0);
    if (safeLimit > 0) {
      return {
        percent: clampPercent((remaining * 100) / safeLimit),
        source: 'local-budget-fallback',
        privateEngine: false,
      };
    }
    return { percent: 0, source: 'unknown', privateEngine: false };
  }

  function formatRemainingPercent(value) {
    const percent = clampPercent(value);
    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
  }

  const api = Object.freeze({
    clampPercent,
    buildPrivateContextPayload,
    payloadFingerprint,
    normalizePrivateResult,
    fallbackRemaining,
    formatRemainingPercent,
  });
  globalThis[KEY] = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let latestPrivate = null;
  let pendingFingerprint = null;
  let refreshQueued = false;
  let rootObserver = null;
  let observedRoot = null;

  function detailText(result) {
    if (result.percent <= 0 && result.source === 'visible-boundary-fallback') {
      return '聊天长度剩余：0%\nChatGPT 已明确显示当前对话达到长度上限。';
    }
    if (result.privateEngine) {
      return `聊天长度剩余：${formatRemainingPercent(result.percent)}\n由本机 GPTLock 核心结合当前聊天状态与本地历史样本计算；不是 ChatGPT 官方实时计数。`;
    }
    if (result.source === 'local-budget-fallback') {
      return `聊天长度剩余：${formatRemainingPercent(result.percent)}\n本机核心暂不可用，临时按当前 GPTLock 本地发送预算显示。`;
    }
    return '聊天长度剩余：未知\nGPTLock 暂时没有足够数据计算当前聊天长度。';
  }

  function observeIndicatorRoot(root) {
    if (!root || observedRoot === root) return;
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(scheduleRefresh);
    rootObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  async function requestPrivateResult(payload, fingerprint) {
    if (pendingFingerprint === fingerprint) return;
    pendingFingerprint = fingerprint;
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload });
      if (payloadFingerprint(payload) !== fingerprint) return;
      const normalized = response?.ok ? normalizePrivateResult(response.data) : null;
      latestPrivate = normalized
        ? { fingerprint, result: normalized, receivedAt: Date.now() }
        : null;
    } catch {
      latestPrivate = null;
    } finally {
      if (pendingFingerprint === fingerprint) pendingFingerprint = null;
      scheduleRefresh();
    }
  }

  function resultFor(snapshot, profile) {
    const fallback = fallbackRemaining(snapshot);
    if (fallback.source === 'visible-boundary-fallback') return fallback;

    const payload = buildPrivateContextPayload(snapshot, profile);
    const fingerprint = payloadFingerprint(payload);
    const cached = latestPrivate;
    if (
      cached
      && cached.fingerprint === fingerprint
      && Date.now() - cached.receivedAt <= PRIVATE_RESULT_MAX_AGE_MS
    ) {
      return cached.result;
    }
    void requestPrivateResult(payload, fingerprint);
    return fallback;
  }

  function render() {
    refreshQueued = false;
    const budgetApi = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    const snapshot = budgetApi?.snapshot?.();
    if (!snapshot) return;
    const profile = budgetApi?.learningProfile?.() || null;
    const result = resultFor(snapshot, profile);

    const host = document.getElementById('gptlock-model-indicator-host');
    const root = host?.shadowRoot;
    const button = root?.querySelector('button');
    if (!root || !button) return;
    observeIndicatorRoot(root);

    let row = root.querySelector('[data-source="context"]');
    if (!row) {
      row = document.createElement('span');
      row.className = 'model-row';
      row.dataset.source = 'context';
      row.innerHTML = '<span class="model-key"></span><span class="model-value"></span>';
      button.append(row);
    }

    const key = row.querySelector('.model-key');
    const value = row.querySelector('.model-value');
    const formatted = formatRemainingPercent(result.percent);
    if (key && key.textContent !== '聊天长度剩余') key.textContent = '聊天长度剩余';
    if (value && value.textContent !== formatted) value.textContent = formatted;

    const nextStatus = result.percent <= 0 ? 'danger' : result.percent <= 20 ? 'warning' : 'safe';
    row.dataset.status = nextStatus;
    row.dataset.remainingSource = result.privateEngine ? 'local-core' : 'fallback';
    const detail = detailText(result);
    row.title = detail;
    row.setAttribute('aria-label', detail);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(render);
  }

  window.addEventListener('gptlock:context-budget', scheduleRefresh);
  window.addEventListener('gptlock:context-hard-limit-learned', scheduleRefresh);
  window.addEventListener('gptlock:context-limit-learned', scheduleRefresh);
  window.addEventListener('popstate', () => {
    latestPrivate = null;
    pendingFingerprint = null;
    scheduleRefresh();
  });
  window.addEventListener('hashchange', () => {
    latestPrivate = null;
    pendingFingerprint = null;
    scheduleRefresh();
  });
  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.setInterval(render, REFRESH_MS);
  render();
})();
