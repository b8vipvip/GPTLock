(() => {
  const MODEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[data-testid*="model-switcher"]',
  ];
  const REASONING_SELECTORS = [
    '[data-testid*="reasoning"] button',
    'button[data-testid*="reasoning"]',
    'button[data-testid*="thinking"]',
  ];
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

  let reportTimer = null;
  let alignTimer = null;
  let previousFingerprint = '';
  let cachedState = null;
  let cachedPolicy = null;
  let cachedSettings = null;
  let lastUrl = location.href;
  let lastAlignAttempt = '';
  let lastAlignAt = 0;
  let sendConsumedAt = 0;
  let indicator = null;

  function firstText(selectors) {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return null;
  }

  function normalizeDisplayedModel(text) {
    if (!text) return null;
    const compact = text.trim().toLowerCase().replace(/\s+/g, '-');
    const match = compact.match(/gpt-?\d+(?:\.\d+)*(?:-[a-z0-9]+)*/);
    return match?.[0] ?? null;
  }

  function normalizeDisplayedReasoning(text) {
    if (!text) return null;
    const value = text.trim().toLowerCase();
    if (/extra[\s_-]*high|xhigh|超高/.test(value)) return 'extra-high';
    if (/\bhigh\b|高级|高$/.test(value)) return 'high';
    if (/\bmedium\b|中级|中$/.test(value)) return 'medium';
    if (/\blow\b|低级|低$/.test(value)) return 'low';
    return null;
  }

  function collectObservation() {
    return {
      model: normalizeDisplayedModel(firstText(MODEL_SELECTORS)),
      reasoning: normalizeDisplayedReasoning(firstText(REASONING_SELECTORS)),
      evidenceSource: 'page_dom',
      capturedAt: new Date().toISOString(),
    };
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error || 'Extension request failed'));
        else resolve(response.data);
      });
    });
  }

  function reasonText(guard) {
    const messages = {
      waiting_for_response_metadata: '正在等待响应元数据 / Waiting for response metadata',
      page_selection_not_allowed_or_missing: '页面模型或推理强度不符合策略 / Page selection is missing or not allowed',
      first_probe_not_armed: '首次探测请求尚未授权 / First probe request is not armed',
      network_monitor_disabled: '网络验证已关闭 / Network verification is disabled',
      network_monitor_not_attached: '网络验证器未连接 / Network verifier is not attached',
      native_core_offline: '本地核心离线 / Native Core is offline',
      metadata_missing: '响应缺少可验证元数据 / Verifiable response metadata is missing',
      policy_mismatch: '响应元数据与策略不匹配 / Response metadata mismatches policy',
      verification_error: '验证发生错误 / Verification error',
    };
    return messages[guard?.reason] || guard?.reason || '状态尚未验证 / State is not verified';
  }

  function ensureIndicator() {
    if (indicator?.isConnected) return indicator;
    const host = document.createElement('div');
    host.id = 'gptlock-indicator-host';
    host.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        button{border:1px solid rgba(15,23,42,.16);border-radius:999px;padding:7px 10px;
          color:#fff;background:#64748b;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 5px 18px rgba(15,23,42,.16);cursor:pointer}
        button[data-tone="good"]{background:#15803d} button[data-tone="bad"]{background:#b91c1c}
        button[data-tone="wait"]{background:#b45309} button:focus{outline:3px solid #bfdbfe}
      </style>
      <button type="button" title="打开 GPTLock 设置 / Open GPTLock settings">GPTLock · 检查中</button>`;
    root.querySelector('button').addEventListener('click', () => {
      void sendMessage({ type: 'GPTLOCK_OPEN_OPTIONS' }).catch(() => {});
    });
    document.documentElement.append(host);
    indicator = host;
    return host;
  }

  function renderIndicator() {
    const host = ensureIndicator();
    const button = host.shadowRoot.querySelector('button');
    const guard = cachedState?.guard;
    const labels = {
      verified: ['已验证', 'good'],
      mismatch: ['不匹配', 'bad'],
      preflight_mismatch: ['选择不符', 'bad'],
      waiting: ['验证中', 'wait'],
      probe_ready: ['可探测', 'wait'],
      unverified: ['未验证', 'bad'],
      error: ['错误', 'bad'],
      monitor_offline: ['验证器离线', 'bad'],
      monitor_disabled: ['验证已关闭', 'bad'],
      core_offline: ['核心离线', 'bad'],
      initial_block: ['已阻断', 'bad'],
    };
    const [label, tone] = labels[guard?.status] || ['检查中', 'wait'];
    button.textContent = `GPTLock · ${label}`;
    button.dataset.tone = tone;
    button.title = `${reasonText(guard)}\n点击打开设置 / Click to open settings`;
  }

  function showNotice(guard) {
    const existing = document.getElementById('gptlock-notice-host');
    existing?.remove();
    const host = document.createElement('div');
    host.id = 'gptlock-notice-host';
    host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        div{max-width:min(560px,calc(100vw - 32px));padding:13px 16px;border:1px solid #fecaca;border-radius:13px;
          color:#7f1d1d;background:#fff7f7;box-shadow:0 12px 36px rgba(127,29,29,.2);font:600 13px/1.55 system-ui,sans-serif}
        strong{display:block;margin-bottom:2px;color:#991b1b;font-size:14px}
      </style>
      <div role="alert"><strong>GPTLock 已阻止发送 / Send blocked</strong><span></span></div>`;
    root.querySelector('span').textContent = reasonText(guard);
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 6500);
  }

  function updateCache(payload) {
    if (payload?.state !== undefined) cachedState = payload.state;
    if (payload?.policy) cachedPolicy = payload.policy;
    if (payload?.settings) cachedSettings = payload.settings;
    renderIndicator();
    scheduleAlign();
  }

  function locallyConsumeGuard() {
    if (!cachedState?.guard || cachedState.guard.allowKind === 'warning') return;
    cachedState = {
      ...cachedState,
      phase: 'waiting',
      guard: {
        ...cachedState.guard,
        canSend: false,
        allowKind: 'blocked',
        status: 'waiting',
        reason: 'waiting_for_response_metadata',
      },
    };
    renderIndicator();
  }

  function handlePotentialSend(event) {
    if (event.type === 'submit' && Date.now() - sendConsumedAt < 750) return true;
    const guard = cachedState?.guard;
    if (!guard?.canSend) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showNotice(guard);
      return false;
    }
    sendConsumedAt = Date.now();
    locallyConsumeGuard();
    void sendMessage({ type: 'GPTLOCK_SEND_STARTED' }).catch(() => {});
    return true;
  }

  function matchesAny(element, selectors) {
    return selectors.some((selector) => element?.closest?.(selector));
  }

  document.addEventListener('click', (event) => {
    if (matchesAny(event.target, SEND_SELECTORS)) handlePotentialSend(event);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter'
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.isComposing
      && matchesAny(event.target, COMPOSER_SELECTORS)
    ) {
      handlePotentialSend(event);
    }
  }, true);

  document.addEventListener('submit', (event) => {
    if (event.target?.querySelector?.(COMPOSER_SELECTORS.join(','))) handlePotentialSend(event);
  }, true);

  async function report() {
    const observation = collectObservation();
    const fingerprint = JSON.stringify([observation.model, observation.reasoning]);
    if (fingerprint === previousFingerprint) return;
    previousFingerprint = fingerprint;
    try {
      const state = await sendMessage({ type: 'GPTLOCK_PAGE_OBSERVATION', observation });
      updateCache({ state });
    } catch {
      // The service worker or native host may be unavailable during browser startup.
    }
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  }

  function menuCandidates() {
    return [...document.querySelectorAll([
      '[role="menu"] [role="menuitem"]',
      '[role="listbox"] [role="option"]',
      '[data-radix-menu-content] [role="menuitem"]',
    ].join(','))].filter(visible);
  }

  async function chooseExact(triggerSelectors, desired, normalize) {
    const trigger = triggerSelectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!trigger || !visible(trigger)) return false;
    trigger.click();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const candidate = menuCandidates().find((element) => normalize(element.textContent) === desired);
    if (!candidate) {
      document.body.click();
      return false;
    }
    candidate.click();
    return true;
  }

  async function alignSelection() {
    if (!cachedSettings?.autoAlignSelection || !cachedPolicy || document.querySelector('button[data-testid="stop-button"]')) return;
    const observation = collectObservation();
    const desiredModel = cachedPolicy.lockedModels?.[0];
    const preferred = cachedPolicy.allowedReasoningLevels?.includes(cachedSettings.preferredReasoning)
      ? cachedSettings.preferredReasoning
      : cachedPolicy.allowedReasoningLevels?.[0];
    const signature = JSON.stringify([location.pathname, desiredModel, preferred, observation.model, observation.reasoning]);
    if (signature === lastAlignAttempt && Date.now() - lastAlignAt < 30000) return;
    lastAlignAttempt = signature;
    lastAlignAt = Date.now();

    let changed = false;
    if (desiredModel && observation.model && observation.model !== desiredModel) {
      changed = await chooseExact(MODEL_SELECTORS, desiredModel, normalizeDisplayedModel);
    }
    if (!changed && preferred && observation.reasoning && observation.reasoning !== preferred) {
      changed = await chooseExact(REASONING_SELECTORS, preferred, normalizeDisplayedReasoning);
    }
    if (changed) window.setTimeout(() => void report(), 700);
  }

  function scheduleAlign() {
    clearTimeout(alignTimer);
    alignTimer = window.setTimeout(() => void alignSelection(), 900);
  }

  function scheduleReport() {
    clearTimeout(reportTimer);
    reportTimer = window.setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        previousFingerprint = '';
        void sendMessage({ type: 'GPTLOCK_CONTEXT_CHANGED', url: lastUrl })
          .then((state) => updateCache({ state }))
          .catch(() => {});
      }
      void report();
      scheduleAlign();
    }, 900);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GPTLOCK_COLLECT_PAGE_STATE') {
      sendResponse({ ok: true, observation: collectObservation() });
      return false;
    }
    if (message?.type === 'GPTLOCK_GUARD_STATE') {
      updateCache(message);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  new MutationObserver(scheduleReport).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  ensureIndicator();
  void sendMessage({ type: 'GPTLOCK_GET_STATE' })
    .then((state) => updateCache({ state: state.tabState, policy: state.policy, settings: state.settings }))
    .catch(() => renderIndicator());
  scheduleReport();
})();
