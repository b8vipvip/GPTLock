(() => {
  const KEY = '__GPTLOCK_CHAT_LENGTH_REMAINING_INDICATOR__';
  if (globalThis[KEY]) return;

  // Chat-length remaining is a public UI/estimation feature. Keep the verified
  // v0.5.27 estimator here instead of coupling the indicator to the private
  // send-budget authority.
  const MODEL_CONTEXT_WINDOWS = Object.freeze([
    { pattern: /^gpt-5\.6(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.5(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.4-(?:mini|nano)(?:-|$)/, tokens: 400_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.4(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
  ]);
  const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
  const SAFETY_BUDGET_RATIO = 0.88;
  const MESSAGE_OVERHEAD_TOKENS = 14;
  const IMAGE_TOKEN_ESTIMATE = 1_200;
  const ATTACHMENT_TOKEN_ESTIMATE = 4_000;
  const MAX_ADAPTIVE_LIMIT_TOKENS = 16_000_000;
  const REFRESH_MS = 750;
  const HARD_LIMIT_ACTION_PATTERN = /开始新(?:对话|聊天)|新建(?:对话|聊天)|start (?:a )?new chat|new chat/i;
  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    'textarea[data-testid*="prompt"]',
    '[contenteditable="true"][data-testid*="composer"]',
    '.ProseMirror[contenteditable="true"]',
  ];

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
  }

  function formatPercent(value) {
    const percent = clampPercent(value);
    if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
  }

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!model) return null;
    if (model === 'gpt-5.6-sol-wm' || model === 'gpt-5-6') return 'gpt-5.6-sol';
    return /^[a-z0-9._:-]{1,128}$/.test(model) ? model : null;
  }

  function contextWindowForModel(value) {
    const model = normalizeModelId(value);
    if (model) {
      const matched = MODEL_CONTEXT_WINDOWS.find(({ pattern }) => pattern.test(model));
      if (matched) return { model, tokens: matched.tokens, source: matched.source };
    }
    return { model, tokens: DEFAULT_CONTEXT_WINDOW_TOKENS, source: 'conservative-fallback' };
  }

  function estimateTextTokens(value) {
    const text = String(value ?? '');
    if (!text) return 0;
    let cjk = 0;
    let ascii = 0;
    let emoji = 0;
    let other = 0;
    let lineBreaks = 0;

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (char === '\n') lineBreaks += 1;
      if (
        (code >= 0x3400 && code <= 0x9fff)
        || (code >= 0x3040 && code <= 0x30ff)
        || (code >= 0xac00 && code <= 0xd7af)
      ) {
        cjk += 1;
      } else if (
        (code >= 0x1f000 && code <= 0x1faff)
        || (code >= 0x2600 && code <= 0x27bf)
      ) {
        emoji += 1;
      } else if (code <= 0x7f) {
        ascii += 1;
      } else if (!/\s/u.test(char)) {
        other += 1;
      }
    }

    return Math.max(1, Math.ceil(
      (cjk * 1.12)
      + (ascii / 3.65)
      + (emoji * 2.2)
      + (other * 1.35)
      + (lineBreaks * 0.18)
    ));
  }

  function boundedCount(value, max = 32) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(max, Math.floor(number));
  }

  function estimatePartTokens(part = {}) {
    const text = typeof part?.text === 'string' ? part.text : '';
    const images = boundedCount(part?.images);
    const attachments = boundedCount(part?.attachments);
    if (!text && images === 0 && attachments === 0) return 0;
    return estimateTextTokens(text)
      + (images * IMAGE_TOKEN_ESTIMATE)
      + (attachments * ATTACHMENT_TOKEN_ESTIMATE)
      + MESSAGE_OVERHEAD_TOKENS;
  }

  function clampAdaptiveLimit(value) {
    return Math.min(MAX_ADAPTIVE_LIMIT_TOKENS, Math.max(0, Math.ceil(Number(value) || 0)));
  }

  function reserveTokensForWindow(contextLimitTokens) {
    return Math.min(64_000, Math.max(8_192, Math.round(contextLimitTokens * 0.04)));
  }

  function computeLocalBudget({
    historyTokens = 0,
    draftTokens = 0,
    contextLimitTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
    adaptiveSafeLimitTokens = 0,
    hardLimitUpperBoundTokens = 0,
    confirmedLowerBoundTokens = 0,
  } = {}) {
    const nominalLimit = Math.max(16_000, Number(contextLimitTokens) || DEFAULT_CONTEXT_WINDOW_TOKENS);
    const baseSafeLimitTokens = Math.floor(nominalLimit * SAFETY_BUDGET_RATIO);
    const learnedSafeLimitTokens = clampAdaptiveLimit(adaptiveSafeLimitTokens);
    const confirmedLower = clampAdaptiveLimit(confirmedLowerBoundTokens);
    const learnedHardUpper = clampAdaptiveLimit(hardLimitUpperBoundTokens);
    const hardLimitUsable = learnedHardUpper > confirmedLower;
    const unconstrainedSafeLimitTokens = Math.max(baseSafeLimitTokens, learnedSafeLimitTokens);
    const safeLimitTokens = hardLimitUsable
      ? Math.max(16_000, confirmedLower, Math.min(unconstrainedSafeLimitTokens, learnedHardUpper))
      : unconstrainedSafeLimitTokens;
    const reserveBasis = hardLimitUsable ? safeLimitTokens : Math.max(nominalLimit, safeLimitTokens);
    const reserveTokens = reserveTokensForWindow(reserveBasis);
    const usedTokens = Math.max(0, Math.ceil(Number(historyTokens) || 0) + Math.ceil(Number(draftTokens) || 0));
    const remainingTokens = Math.max(0, safeLimitTokens - usedTokens);
    return {
      nominalLimitTokens: nominalLimit,
      baseSafeLimitTokens,
      safeLimitTokens,
      reserveTokens,
      historyTokens: Math.max(0, Math.ceil(Number(historyTokens) || 0)),
      draftTokens: Math.max(0, Math.ceil(Number(draftTokens) || 0)),
      usedTokens,
      remainingTokens,
      remainingPercent: safeLimitTokens > 0 ? clampPercent((remainingTokens / safeLimitTokens) * 100) : 0,
    };
  }

  function remainingForMetric(currentValue, observedLimit) {
    const current = Math.max(0, Number(currentValue) || 0);
    const limit = Math.max(0, Number(observedLimit) || 0);
    if (limit <= 0) return null;
    return clampPercent((1 - (current / limit)) * 100);
  }

  function calculateRemainingPercent({ snapshot = null, profile = null, hardLimitVisible = false, localBudget = null } = {}) {
    if (hardLimitVisible || snapshot?.hardLimitVisible) {
      return { percent: 0, source: 'chatgpt-visible-hard-limit', metricCount: 0 };
    }

    const observedCount = Math.max(0, Number(profile?.hardLimitObservedCount) || 0);
    if (observedCount > 0) {
      const currentTokens = Math.max(
        Number(localBudget?.cumulativeTokens) || 0,
        Number(snapshot?.cumulativeConversationTokens) || 0,
      );
      const currentCharacters = Math.max(
        Number(localBudget?.cumulativeCharacters) || 0,
        Number(snapshot?.cumulativeConversationCharacters) || 0,
      );
      const currentMessages = Math.max(
        Number(localBudget?.cumulativeMessages) || 0,
        Number(snapshot?.cumulativeMessageCount) || 0,
      );
      const learnedCandidates = [
        remainingForMetric(currentTokens, profile?.hardLimitObservedTokens),
        remainingForMetric(currentCharacters, profile?.hardLimitObservedCharacters),
        remainingForMetric(currentMessages, profile?.hardLimitObservedMessages),
      ].filter((value) => value !== null);
      if (learnedCandidates.length) {
        return {
          percent: Math.min(...learnedCandidates),
          source: 'learned-chatgpt-thread-boundary',
          metricCount: learnedCandidates.length,
        };
      }
    }

    if (localBudget?.safeLimitTokens > 0) {
      return {
        percent: clampPercent((localBudget.remainingTokens / localBudget.safeLimitTokens) * 100),
        source: 'local-operational-budget',
        metricCount: 1,
      };
    }

    return { percent: 0, source: 'unknown', metricCount: 0 };
  }

  const api = Object.freeze({
    clampPercent,
    formatPercent,
    normalizeModelId,
    contextWindowForModel,
    estimateTextTokens,
    estimatePartTokens,
    computeLocalBudget,
    remainingForMetric,
    calculateRemainingPercent,
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
    return String(element?.innerText || element?.textContent || '');
  }

  function mediaCounts(root, max = 16) {
    if (!root?.querySelectorAll) return { images: 0, attachments: 0 };
    return {
      images: boundedCount(root.querySelectorAll('img').length, max),
      attachments: boundedCount(root.querySelectorAll('[data-testid*="file" i],[data-testid*="attachment" i],a[download]').length, max),
    };
  }

  function findComposer() {
    return COMPOSER_SELECTORS
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element)) || null;
  }

  function composerText(composer = findComposer()) {
    if (!composer) return '';
    if ('value' in composer && typeof composer.value === 'string') return composer.value;
    return elementText(composer);
  }

  function conversationElements() {
    const composer = findComposer();
    const roleElements = [...document.querySelectorAll('[data-message-author-role]')]
      .filter((element) => !composer || !element.contains(composer));
    if (roleElements.length) {
      const unique = [];
      const seen = new Set();
      for (const element of roleElements) {
        const turn = element.closest('article[data-testid^="conversation-turn-"]');
        const key = turn || element;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(turn || element);
      }
      return unique;
    }
    return [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')]
      .filter((element) => !composer || !element.contains(composer));
  }

  function domHistoryMeasurement() {
    let tokens = 0;
    let characters = 0;
    let messages = 0;
    for (const element of conversationElements()) {
      const text = elementText(element);
      const media = mediaCounts(element);
      if (!text && media.images === 0 && media.attachments === 0) continue;
      tokens += estimatePartTokens({ text, ...media });
      characters += text.length;
      messages += 1;
    }
    return { tokens, characters, messages, source: 'dom-fallback' };
  }

  function fullHistoryMeasurement(budgetApi) {
    const source = budgetApi?.privateHistorySnapshot?.();
    if (!source || !Array.isArray(source.history) || !source.history.length) return null;
    let tokens = 0;
    let characters = 0;
    let messages = 0;
    for (const part of source.history) {
      const text = typeof part?.text === 'string' ? part.text : '';
      const images = boundedCount(part?.images);
      const attachments = boundedCount(part?.attachments);
      if (!text && images === 0 && attachments === 0) continue;
      tokens += estimatePartTokens({ text, images, attachments });
      characters += text.length;
      messages += 1;
    }
    if (!messages) return null;
    return { tokens, characters, messages, source: 'conversation-tree' };
  }

  function currentLocalBudget(snapshot, profile, budgetApi) {
    const measured = fullHistoryMeasurement(budgetApi) || domHistoryMeasurement();
    const composer = findComposer();
    const draft = composerText(composer);
    const composerRoot = composer?.closest('form') || composer?.parentElement || composer;
    const draftMedia = mediaCounts(composerRoot);
    const draftTokens = draft.trim() || draftMedia.images || draftMedia.attachments
      ? estimatePartTokens({ text: draft, ...draftMedia })
      : 0;
    const windowProfile = contextWindowForModel(snapshot?.model);
    const budget = computeLocalBudget({
      historyTokens: measured.tokens,
      draftTokens,
      contextLimitTokens: windowProfile.tokens,
      adaptiveSafeLimitTokens: profile?.adaptiveSafeLimitTokens,
      hardLimitUpperBoundTokens: profile?.hardLimitUpperBoundTokens,
      confirmedLowerBoundTokens: profile?.confirmedConversationTokens,
    });
    return {
      ...budget,
      model: windowProfile.model,
      contextWindowSource: windowProfile.source,
      measurementSource: measured.source,
      cumulativeTokens: Math.max(measured.tokens, Number(snapshot?.cumulativeConversationTokens) || 0),
      cumulativeCharacters: Math.max(measured.characters, Number(snapshot?.cumulativeConversationCharacters) || 0),
      cumulativeMessages: Math.max(measured.messages, Number(snapshot?.cumulativeMessageCount) || 0),
    };
  }

  function hasVisibleConversationHardLimit(budgetApi) {
    const classifier = budgetApi?.classifyConversationLengthLimitText;
    if (typeof classifier !== 'function') return false;
    const candidates = [...document.querySelectorAll('p,[role="alert"],[role="status"]')].filter(visible);
    for (const element of candidates) {
      if (element.closest('#gptlock-context-warning-host,#gptlock-context-learning-toast,#gptlock-context-hard-limit-toast')) continue;
      if (!classifier(elementText(element).replace(/\s+/g, ' ').trim())) continue;
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

  function detailText(result, localBudget) {
    if (result.source === 'chatgpt-visible-hard-limit') {
      return '聊天长度剩余：0%\nChatGPT 已明确提示当前对话达到长度上限，因此当前聊天剩余长度直接记为 0%。';
    }
    if (result.source === 'learned-chatgpt-thread-boundary') {
      return `聊天长度剩余：${formatPercent(result.percent)}\n沿用已验证逻辑：基于该账户/模型此前真实“对话长度上限”样本，按累计 token/字符/消息规模取最保守剩余比例。`;
    }
    if (result.source === 'local-operational-budget') {
      const source = localBudget?.measurementSource === 'conversation-tree' ? '完整活动分支' : '页面消息';
      return `聊天长度剩余：${formatPercent(result.percent)}\n沿用已验证的本地上下文估算逻辑；当前按${source}和模型安全预算计算，不依赖私有核心返回 remainingPercent。`;
    }
    return '聊天长度剩余：未知\n当前页面尚没有足够聊天内容用于估算。';
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
    `;
    root.append(style);
  }

  function render() {
    refreshQueued = false;
    const budgetApi = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    const snapshot = budgetApi?.snapshot?.() || null;
    if (!snapshot) return;
    const profile = budgetApi?.learningProfile?.() || null;
    const localBudget = currentLocalBudget(snapshot, profile, budgetApi);
    const hardLimitVisible = hasVisibleConversationHardLimit(budgetApi);
    const result = calculateRemainingPercent({ snapshot, profile, hardLimitVisible, localBudget });

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
    const text = formatPercent(result.percent);
    if (value && value.textContent !== text) value.textContent = text;

    const status = result.percent <= 0 ? 'danger' : result.percent <= 20 ? 'warning' : 'safe';
    if (row.dataset.status !== status) row.dataset.status = status;
    if (row.dataset.remainingSource !== result.source) row.dataset.remainingSource = result.source;
    if (row.dataset.measurementSource !== localBudget.measurementSource) row.dataset.measurementSource = localBudget.measurementSource;

    const detail = detailText(result, localBudget);
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
