(() => {
  const MODEL_CONTEXT_WINDOWS = Object.freeze([
    { pattern: /^gpt-5\.6(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.5(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.4-(?:mini|nano)(?:-|$)/, tokens: 400_000, source: 'openai-api-model-window' },
    { pattern: /^gpt-5\.4(?:-|$)/, tokens: 1_050_000, source: 'openai-api-model-window' },
  ]);
  const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
  const SAFETY_BUDGET_RATIO = 0.88;
  const WARNING_PERCENT = 80;
  const MAX_DISPLAY_PERCENT = 999;
  const MESSAGE_OVERHEAD_TOKENS = 14;
  const IMAGE_TOKEN_ESTIMATE = 1_200;
  const ATTACHMENT_TOKEN_ESTIMATE = 4_000;
  const REFRESH_DEBOUNCE_MS = 220;
  const PERIODIC_REFRESH_MS = 1_500;
  const SEND_DEDUPE_MS = 750;
  const BYPASS_WINDOW_MS = 8_000;
  const AUTO_PROBE_PREFIX = 'GPTLock 自动验证';
  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    'textarea[data-testid*="prompt"]',
    '[contenteditable="true"][data-testid*="composer"]',
    '.ProseMirror[contenteditable="true"]',
  ];
  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-submit-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label="发送提示"]',
    'button[aria-label="发送消息"]',
  ];

  let lastSnapshot = null;
  let lastKnownModel = null;
  let refreshTimer = null;
  let sendAllowedAt = 0;
  let bypassUntil = 0;
  let warningHost = null;

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
    return {
      model,
      tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
      source: 'conservative-fallback',
    };
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

  function reserveTokensForWindow(contextLimitTokens) {
    return Math.min(64_000, Math.max(8_192, Math.round(contextLimitTokens * 0.04)));
  }

  function computeBudget({
    historyTokens = 0,
    draftTokens = 0,
    contextLimitTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
  } = {}) {
    const nominalLimit = Math.max(16_000, Number(contextLimitTokens) || DEFAULT_CONTEXT_WINDOW_TOKENS);
    const safeLimitTokens = Math.floor(nominalLimit * SAFETY_BUDGET_RATIO);
    const reserveTokens = reserveTokensForWindow(nominalLimit);
    const usedTokens = Math.max(0, Math.ceil(historyTokens + draftTokens));
    const projectedTokens = usedTokens + reserveTokens;
    const percent = Math.min(MAX_DISPLAY_PERCENT, (usedTokens / safeLimitTokens) * 100);
    const projectedPercent = Math.min(MAX_DISPLAY_PERCENT, (projectedTokens / safeLimitTokens) * 100);
    const remainingTokens = Math.max(0, safeLimitTokens - usedTokens);
    return {
      nominalLimitTokens: nominalLimit,
      safeLimitTokens,
      reserveTokens,
      historyTokens: Math.max(0, Math.ceil(historyTokens)),
      draftTokens: Math.max(0, Math.ceil(draftTokens)),
      usedTokens,
      projectedTokens,
      percent,
      projectedPercent,
      remainingTokens,
      warning: percent >= WARNING_PERCENT,
      wouldExceed: projectedTokens >= safeLimitTokens,
    };
  }

  const api = {
    contextWindowForModel,
    estimateTextTokens,
    computeBudget,
    snapshot: () => lastSnapshot,
  };
  globalThis.__GPTLOCK_CONTEXT_BUDGET__ = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden');
  }

  function findComposer() {
    return COMPOSER_SELECTORS
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element)) || null;
  }

  function composerText(composer = findComposer()) {
    if (!composer) return '';
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return composer.value || '';
    return composer.innerText || composer.textContent || '';
  }

  function attachmentCount(root) {
    if (!root?.querySelectorAll) return 0;
    const fileLike = root.querySelectorAll('[data-testid*="file" i],[data-testid*="attachment" i],a[download]');
    return Math.min(16, fileLike.length);
  }

  function imageCount(root) {
    if (!root?.querySelectorAll) return 0;
    return Math.min(16, root.querySelectorAll('img').length);
  }

  function elementTokenEstimate(element) {
    const text = element?.innerText || element?.textContent || '';
    return estimateTextTokens(text)
      + (imageCount(element) * IMAGE_TOKEN_ESTIMATE)
      + (attachmentCount(element) * ATTACHMENT_TOKEN_ESTIMATE)
      + MESSAGE_OVERHEAD_TOKENS;
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

  function detectModel() {
    const validated = globalThis.__GPTLOCK_PAGE_MODEL_EVIDENCE__?.collect?.();
    const pageModel = normalizeModelId(validated?.model);
    return normalizeModelId(lastKnownModel) || pageModel || null;
  }

  function formatCompactTokens(tokens) {
    const value = Math.max(0, Number(tokens) || 0);
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(Math.round(value));
  }

  function snapshotNow() {
    const messages = conversationElements();
    const historyTokens = messages.reduce((total, element) => total + elementTokenEstimate(element), 0);
    const composer = findComposer();
    const draft = composerText(composer);
    const composerRoot = composer?.closest('form') || composer?.parentElement;
    const draftTokens = estimateTextTokens(draft)
      + (imageCount(composerRoot) * IMAGE_TOKEN_ESTIMATE)
      + (attachmentCount(composerRoot) * ATTACHMENT_TOKEN_ESTIMATE)
      + (draft.trim() ? MESSAGE_OVERHEAD_TOKENS : 0);
    const model = detectModel();
    const windowProfile = contextWindowForModel(model);
    const budget = computeBudget({ historyTokens, draftTokens, contextLimitTokens: windowProfile.tokens });
    return {
      ...budget,
      model: windowProfile.model,
      contextWindowSource: windowProfile.source,
      messageCount: messages.length,
      measuredAt: new Date().toISOString(),
      estimateOnly: true,
    };
  }

  function indicatorDetail(snapshot) {
    const source = snapshot.contextWindowSource === 'openai-api-model-window'
      ? '公开模型窗口'
      : '保守回退窗口';
    return [
      `上下文额度：${snapshot.percent.toFixed(1)}%（本地估算）`,
      `已估算：${formatCompactTokens(snapshot.usedTokens)} tokens`,
      `安全预算：${formatCompactTokens(snapshot.safeLimitTokens)} / 公开窗口 ${formatCompactTokens(snapshot.nominalLimitTokens)}`,
      `预留回复：${formatCompactTokens(snapshot.reserveTokens)}`,
      `剩余安全预算：约 ${formatCompactTokens(snapshot.remainingTokens)}`,
      `模型：${snapshot.model || '未识别'} · ${source}`,
      '说明：ChatGPT 隐藏系统提示、工具上下文、服务端压缩/裁剪及精确 tokenizer 不对扩展完整开放，因此此值不是官方实时计数。',
    ].join('\n');
  }

  function mountIndicatorRow(snapshot) {
    const host = document.getElementById('gptlock-model-indicator-host');
    const root = host?.shadowRoot;
    const button = root?.querySelector('button');
    if (!button) return;

    if (!root.getElementById('gptlock-context-budget-style')) {
      const style = document.createElement('style');
      style.id = 'gptlock-context-budget-style';
      style.textContent = `
        .model-row[data-source="context"][data-status="safe"] .model-value{color:#dbeafe}
        .model-row[data-source="context"][data-status="warning"] .model-value{color:#fde68a}
        .model-row[data-source="context"][data-status="danger"] .model-value{color:#fecaca;font-weight:850}`;
      root.append(style);
    }

    let row = root.querySelector('[data-source="context"]');
    if (!row) {
      row = document.createElement('span');
      row.className = 'model-row';
      row.dataset.source = 'context';
      row.innerHTML = '<span class="model-key">上下文</span><span class="model-value">估算中</span>';
      button.append(row);
    }
    row.dataset.status = snapshot.wouldExceed ? 'danger' : snapshot.warning ? 'warning' : 'safe';
    const value = row.querySelector('.model-value');
    if (value) value.textContent = `${snapshot.percent.toFixed(snapshot.percent < 10 ? 1 : 0)}% · 约${formatCompactTokens(snapshot.remainingTokens)}余`;
    row.title = indicatorDetail(snapshot);
    row.setAttribute('aria-label', indicatorDetail(snapshot));
  }

  function publishSnapshot(next) {
    const previousFingerprint = lastSnapshot
      ? `${Math.round(lastSnapshot.percent * 10)}:${lastSnapshot.model}:${lastSnapshot.messageCount}:${lastSnapshot.wouldExceed}`
      : '';
    lastSnapshot = next;
    mountIndicatorRow(next);
    const fingerprint = `${Math.round(next.percent * 10)}:${next.model}:${next.messageCount}:${next.wouldExceed}`;
    if (fingerprint !== previousFingerprint) {
      window.dispatchEvent(new CustomEvent('gptlock:context-budget', { detail: next }));
    }
  }

  function recompute() {
    refreshTimer = null;
    try {
      publishSnapshot(snapshotNow());
    } catch {
      // ChatGPT DOM can be replaced during navigation; the periodic refresh self-heals.
    }
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(recompute, REFRESH_DEBOUNCE_MS);
  }

  api.refresh = () => {
    recompute();
    return lastSnapshot;
  };

  function matchesAny(element, selectors) {
    return selectors.some((selector) => element?.closest?.(selector));
  }

  function isPotentialSend(event) {
    if (event.type === 'click') return matchesAny(event.target, SEND_SELECTORS);
    if (event.type === 'keydown') {
      return event.key === 'Enter'
        && !event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.isComposing
        && matchesAny(event.target, COMPOSER_SELECTORS);
    }
    if (event.type === 'submit') return Boolean(event.target?.querySelector?.(COMPOSER_SELECTORS.join(',')));
    return false;
  }

  function closeWarning() {
    warningHost?.remove();
    warningHost = null;
  }

  function findSendButton() {
    return SEND_SELECTORS
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true') || null;
  }

  function sendAfterExplicitBypass() {
    bypassUntil = Date.now() + BYPASS_WINDOW_MS;
    closeWarning();
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
    closeWarning();
    const host = document.createElement('div');
    host.id = 'gptlock-context-warning-host';
    host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:2147483647;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{box-sizing:border-box;width:min(620px,calc(100vw - 32px));padding:14px 16px;border:1px solid #f59e0b;border-radius:14px;
          color:#78350f;background:#fffbeb;box-shadow:0 14px 40px rgba(120,53,15,.2);font:600 13px/1.5 system-ui,sans-serif}
        strong{display:block;margin-bottom:4px;color:#92400e;font-size:14px}.detail{font-weight:550}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
        button{border:0;border-radius:9px;padding:8px 11px;font:700 12px/1 system-ui,sans-serif;cursor:pointer}.cancel{background:#fef3c7;color:#78350f}.send{background:#b45309;color:#fff}
      </style>
      <div class="card" role="alertdialog" aria-live="assertive">
        <strong>GPTLock 上下文预警：本次发送已拦截</strong>
        <div class="detail"></div>
        <div class="actions"><button class="cancel" type="button">取消</button><button class="send" type="button">仍然发送一次</button></div>
      </div>`;
    root.querySelector('.detail').textContent = `当前约 ${snapshot.percent.toFixed(1)}%，加入这条提示并预留回复后预计 ${snapshot.projectedPercent.toFixed(1)}%，将越过 GPTLock 的安全上下文预算。建议先新建聊天、压缩历史或减少大段内容。该计数为本地估算，不是 ChatGPT 官方实时 token 计数。`;
    root.querySelector('.cancel').addEventListener('click', closeWarning);
    root.querySelector('.send').addEventListener('click', sendAfterExplicitBypass);
    document.documentElement.append(host);
    warningHost = host;
  }

  function handlePotentialSend(event) {
    if (!isPotentialSend(event)) return true;
    const now = Date.now();
    if (event.type === 'submit' && now - sendAllowedAt < SEND_DEDUPE_MS) return true;

    const draft = composerText().trim();
    if (draft.startsWith(AUTO_PROBE_PREFIX)) {
      sendAllowedAt = now;
      return true;
    }
    if (bypassUntil > now) {
      bypassUntil = 0;
      sendAllowedAt = now;
      return true;
    }

    recompute();
    const snapshot = lastSnapshot;
    if (!snapshot?.wouldExceed) {
      sendAllowedAt = now;
      return true;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showContextWarning(snapshot);
    return false;
  }

  document.addEventListener('click', handlePotentialSend, true);
  document.addEventListener('keydown', handlePotentialSend, true);
  document.addEventListener('submit', handlePotentialSend, true);
  document.addEventListener('input', scheduleRefresh, true);

  chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'GPTLOCK_GUARD_STATE') return false;
    const state = message.state;
    lastKnownModel = normalizeModelId(
      state?.lastVerification?.model
      || state?.lastRequest?.model
      || state?.pageObservation?.model
      || lastKnownModel,
    );
    scheduleRefresh();
    return false;
  });

  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('resize', scheduleRefresh);
  window.setInterval(recompute, PERIODIC_REFRESH_MS);
  recompute();
})();
