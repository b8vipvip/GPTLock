(() => {
  const KEY = '__GPTLOCK_CHAT_LENGTH_REMAINING_INDICATOR__';
  if (globalThis[KEY]) return;

  const REFRESH_MS = 750;

  function normalizePercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.min(100, number);
  }

  function formatPercent(value) {
    const percent = normalizePercent(value);
    if (percent === null) return null;
    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
  }

  function sameScope(snapshot, authority) {
    if (!snapshot || !authority) return false;
    return String(snapshot.conversationKey || '') === String(authority.conversationKey || '')
      && String(snapshot.model || '') === String(authority.model || '');
  }

  function selectDisplayState({ snapshot = null, authority = null } = {}) {
    if (snapshot?.hardLimitVisible) {
      return { status: 'ready', percent: 0, source: 'chatgpt-visible-hard-limit', stale: false };
    }

    const snapshotPercent = normalizePercent(snapshot?.remainingPercent);
    if (snapshot?.budgetAuthority === 'private-engine' && snapshotPercent !== null) {
      return {
        status: 'ready',
        percent: snapshotPercent,
        source: 'private-budget',
        stale: Boolean(snapshot.privateBudgetStale),
      };
    }

    const authorityPercent = normalizePercent(authority?.privateResult?.remainingPercent);
    if (authority?.available && authorityPercent !== null && sameScope(snapshot, authority)) {
      return {
        status: 'ready',
        percent: authorityPercent,
        source: 'private-budget',
        stale: Boolean(authority.stale),
      };
    }

    const error = String(authority?.error || '').trim();
    const unavailable = Boolean(error && error !== 'full_history_unavailable');
    return {
      status: unavailable ? 'unavailable' : 'pending',
      percent: null,
      source: unavailable ? 'private-budget-unavailable' : 'pending',
      stale: false,
      error,
    };
  }

  const api = Object.freeze({ normalizePercent, formatPercent, sameScope, selectDisplayState });
  globalThis[KEY] = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let rootObserver = null;
  let observedRoot = null;
  let refreshQueued = false;

  function detailText(state) {
    if (state.source === 'chatgpt-visible-hard-limit') {
      return '聊天长度剩余：0%\nChatGPT 已明确提示当前对话达到长度上限，因此当前聊天剩余长度直接记为 0%。';
    }
    if (state.status === 'ready') {
      const suffix = state.stale ? '\n当前显示最近一次有效结果，后台正在刷新。' : '';
      return `聊天长度剩余：${formatPercent(state.percent)}\n根据当前聊天状态计算；检测到 ChatGPT 真实长度上限提示时会直接显示 0%。${suffix}`;
    }
    if (state.status === 'unavailable') {
      return '聊天长度剩余：暂不可用\n当前本地计算暂不可用；GPTLock 会自动重试，且不会因此阻止正常聊天。';
    }
    return '聊天长度剩余：计算中\n正在读取当前聊天状态并等待本地计算结果。';
  }

  function observeRoot(root) {
    if (!root || observedRoot === root) return;
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(scheduleRefresh);
    rootObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  function ensureStyle(root) {
    if (root.getElementById('gptlock-chat-length-remaining-style')) return;
    const style = document.createElement('style');
    style.id = 'gptlock-chat-length-remaining-style';
    style.textContent = `
      [data-source="context"]{grid-template-columns:84px minmax(0,1fr)!important}
      [data-source="context"][data-status="danger"] .model-value{color:#fecaca}
      [data-source="context"][data-status="warning"] .model-value{color:#fde68a}
      [data-source="context"][data-status="safe"] .model-value{color:#dcfce7}
      [data-source="context"][data-status="waiting"] .model-value{opacity:.68;font-weight:650}
    `;
    root.append(style);
  }

  function render() {
    refreshQueued = false;
    const snapshot = globalThis.__GPTLOCK_CONTEXT_BUDGET__?.snapshot?.() || null;
    const authority = globalThis.__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__?.state || null;
    const state = selectDisplayState({ snapshot, authority });

    const host = document.getElementById('gptlock-model-indicator-host');
    const root = host?.shadowRoot;
    const button = root?.querySelector('button');
    if (!root || !button) return;
    observeRoot(root);
    ensureStyle(root);

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
    if (key && key.textContent !== '聊天长度剩余') key.textContent = '聊天长度剩余';

    let text = '计算中';
    if (state.status === 'ready') text = formatPercent(state.percent) || '计算中';
    else if (state.status === 'unavailable') text = '暂不可用';
    if (value && value.textContent !== text) value.textContent = text;

    const status = state.status === 'ready'
      ? state.percent <= 0 ? 'danger' : state.percent <= 20 ? 'warning' : 'safe'
      : 'waiting';
    if (row.dataset.status !== status) row.dataset.status = status;
    if (row.dataset.remainingSource !== state.source) row.dataset.remainingSource = state.source;

    const detail = detailText(state);
    if (row.title !== detail) row.title = detail;
    if (row.getAttribute('aria-label') !== detail) row.setAttribute('aria-label', detail);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(render);
  }

  window.addEventListener('gptlock:context-budget', scheduleRefresh);
  window.addEventListener('gptlock:private-context-budget-authority', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.setInterval(render, REFRESH_MS);
  render();
})();
