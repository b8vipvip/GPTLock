(() => {
  const KEY = '__GPTLOCK_CONTEXT_REMAINING__';
  if (globalThis[KEY]) return;

  const HARD_LIMIT_ACTION_PATTERN = /开始新(?:对话|聊天)|新建(?:对话|聊天)|start (?:a )?new chat|new chat/i;
  const REFRESH_MS = 750;

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
  }

  function remainingForMetric(currentValue, observedLimit) {
    const current = Math.max(0, Number(currentValue) || 0);
    const limit = Math.max(0, Number(observedLimit) || 0);
    if (limit <= 0) return null;
    return clampPercent((1 - (current / limit)) * 100);
  }

  function calculateRemainingPercent({ snapshot = null, profile = null, hardLimitVisible = false } = {}) {
    if (hardLimitVisible || snapshot?.hardLimitVisible) {
      return { percent: 0, source: 'chatgpt-visible-hard-limit', metricCount: 0 };
    }

    const observedCount = Math.max(0, Number(profile?.hardLimitObservedCount) || 0);
    if (observedCount > 0) {
      const learnedCandidates = [
        remainingForMetric(snapshot?.cumulativeConversationTokens, profile?.hardLimitObservedTokens),
        remainingForMetric(snapshot?.cumulativeConversationCharacters, profile?.hardLimitObservedCharacters),
        remainingForMetric(snapshot?.cumulativeMessageCount, profile?.hardLimitObservedMessages),
      ].filter((value) => value !== null);
      if (learnedCandidates.length) {
        return {
          // ChatGPT does not publish which product-side quantity trips the thread limit.
          // Use the most conservative empirical ratio instead of pretending the API
          // model context window is the web conversation-length limit.
          percent: Math.min(...learnedCandidates),
          source: 'learned-chatgpt-thread-boundary',
          metricCount: learnedCandidates.length,
        };
      }
    }

    const safeLimit = Math.max(0, Number(snapshot?.safeLimitTokens) || 0);
    const remaining = Math.max(0, Number(snapshot?.remainingTokens) || 0);
    if (safeLimit > 0) {
      return {
        percent: clampPercent((remaining / safeLimit) * 100),
        source: 'local-operational-budget',
        metricCount: 1,
      };
    }
    return { percent: 0, source: 'unknown', metricCount: 0 };
  }

  function formatRemainingPercent(value) {
    const percent = clampPercent(value);
    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
  }

  const api = Object.freeze({
    clampPercent,
    remainingForMetric,
    calculateRemainingPercent,
    formatRemainingPercent,
  });
  globalThis[KEY] = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let rootObserver = null;
  let observedRoot = null;
  let refreshQueued = false;

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function elementText(element) {
    return String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hasVisibleConversationHardLimit() {
    const classifier = globalThis.__GPTLOCK_CONTEXT_BUDGET__?.classifyConversationLengthLimitText;
    if (typeof classifier !== 'function') return false;
    const candidates = [...document.querySelectorAll('p,[role="alert"],[role="status"]')].filter(visible);
    for (const element of candidates) {
      if (element.closest('#gptlock-context-warning-host,#gptlock-context-learning-toast,#gptlock-context-hard-limit-toast')) continue;
      if (!classifier(elementText(element))) continue;

      const semanticNotice = ['alert', 'status'].includes(String(element.getAttribute('role') || '').toLowerCase());
      let hasNewChatAction = false;
      let container = element;
      for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
        hasNewChatAction = [...(container.querySelectorAll?.('button,a') || [])]
          .some((candidate) => visible(candidate) && HARD_LIMIT_ACTION_PATTERN.test(elementText(candidate)));
        if (hasNewChatAction) break;
      }
      const insideConversationTurn = Boolean(element.closest('[data-message-author-role],article[data-testid^="conversation-turn-"]'));
      if (semanticNotice || hasNewChatAction || !insideConversationTurn) return true;
    }
    return false;
  }

  function detailText(result) {
    if (result.source === 'chatgpt-visible-hard-limit') {
      return '聊天长度剩余：0%\nChatGPT 已明确提示当前对话达到长度上限，因此当前聊天剩余长度直接记为 0%，不再受本地 token 估算影响。';
    }
    if (result.source === 'learned-chatgpt-thread-boundary') {
      return `聊天长度剩余：${formatRemainingPercent(result.percent)}\n基于该账户/模型此前真实“对话长度上限”样本，按累计聊天规模的实测比例保守估算；不是 ChatGPT 官方实时计数。`;
    }
    if (result.source === 'local-operational-budget') {
      return `聊天长度剩余：${formatRemainingPercent(result.percent)}\n当前账户/模型尚无可复用的真实“对话长度上限”样本，暂按 GPTLock 本地安全预算估算；不是 ChatGPT 官方实时计数。`;
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

  function render() {
    refreshQueued = false;
    const budgetApi = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    const snapshot = budgetApi?.snapshot?.();
    if (!snapshot) return;

    const hardLimitVisible = hasVisibleConversationHardLimit();
    const profile = budgetApi?.learningProfile?.() || null;
    const result = calculateRemainingPercent({ snapshot, profile, hardLimitVisible });

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
    if (row.dataset.status !== nextStatus) row.dataset.status = nextStatus;
    row.dataset.remainingSource = result.source;

    const detail = detailText(result);
    if (row.title !== detail) row.title = detail;
    if (row.getAttribute('aria-label') !== detail) row.setAttribute('aria-label', detail);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(render);
  }

  window.addEventListener('gptlock:context-budget', scheduleRefresh);
  window.addEventListener('gptlock:context-hard-limit-learned', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.setInterval(render, REFRESH_MS);
  render();
})();
