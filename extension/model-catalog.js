(() => {
  const STORAGE_KEY = 'discoveredModels';
  const MAX_DISCOVERED_MODELS = 64;
  const STATE_REFRESH_MS = 1200;
  const PAGE_REFRESH_DELAY_MS = 120;
  const INDICATOR_GAP_PX = 8;
  const VIEWPORT_MARGIN_PX = 12;
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });
  const PAGE_MODEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[data-testid*="model-switcher"]',
    'button[aria-label*="model" i][aria-haspopup="menu"]',
    'button[aria-label*="模型"][aria-haspopup="menu"]',
  ];

  let indicator = null;
  let lastState = null;
  let localPageObservation = null;
  let writeQueue = Promise.resolve();
  let stateRefreshInFlight = false;
  let pageRefreshTimer = null;
  let positionFrame = null;
  let anchorResizeObserver = null;

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    return MODEL_ALIASES[model] ?? model;
  }

  function normalizeDisplayedModel(text) {
    if (!text) return null;
    const compact = String(text).trim().toLowerCase().replace(/\s+/g, '-');
    const explicit = compact.match(/gpt-?(\d+(?:\.\d+)*)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?/);
    if (explicit) {
      const suffix = explicit[2] ? `-${explicit[2]}` : '';
      return normalizeModelId(`gpt-${explicit[1]}${suffix}`);
    }
    const compactSol = compact.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)*)-sol(?:-wm)?(?:-|$)/);
    return compactSol ? normalizeModelId(`gpt-${compactSol[1]}-sol`) : null;
  }

  function modelLabel(value) {
    const model = normalizeModelId(value);
    if (!model) return '未识别 / Unknown';
    if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
    if (model === 'gpt-5.5') return 'GPT-5.5';
    if (model.startsWith('gpt-')) {
      return model
        .split('-')
        .map((part, index) => {
          if (index === 0) return 'GPT';
          if (/^\d+(?:\.\d+)*$/.test(part)) return part;
          if (part === 'sol') return 'Sol';
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(' ');
    }
    return model;
  }

  function elementTexts(element) {
    return [
      element?.textContent?.trim(),
      element?.getAttribute?.('aria-label')?.trim(),
      element?.getAttribute?.('title')?.trim(),
    ].filter(Boolean);
  }

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden');
  }

  function detectPageModel() {
    for (const selector of PAGE_MODEL_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        for (const text of elementTexts(element)) {
          const model = normalizeDisplayedModel(text);
          if (model) return model;
        }
      }
    }

    for (const element of document.querySelectorAll('button,[role="button"]')) {
      if (!visible(element)) continue;
      for (const text of elementTexts(element)) {
        const model = normalizeDisplayedModel(text);
        if (model) return model;
      }
    }
    return null;
  }

  function timestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function effectivePageObservation(state) {
    const remote = state?.pageObservation;
    if (!localPageObservation) return remote ?? null;
    if (!remote || timestamp(localPageObservation.capturedAt) >= timestamp(remote.capturedAt)) return localPageObservation;
    return remote;
  }

  function modelCandidates(state) {
    const values = [];
    const add = (value) => {
      const model = normalizeModelId(value);
      if (model && !values.includes(model)) values.push(model);
    };
    add(state?.lastVerification?.model);
    add(state?.lastRequest?.model);
    add(effectivePageObservation(state)?.model);
    return values;
  }

  function responseAppliesToLatestRequest(state) {
    const requestAt = timestamp(state?.lastRequest?.capturedAt);
    const verificationAt = timestamp(state?.lastVerification?.verifiedAt);
    if (!requestAt) return true;
    return Boolean(verificationAt && verificationAt >= requestAt - 1000);
  }

  function currentModel(state) {
    const candidates = [];
    const verification = state?.lastVerification;
    const verifiedModel = normalizeModelId(verification?.model);
    if (verifiedModel && responseAppliesToLatestRequest(state)) {
      candidates.push({
        id: verifiedModel,
        label: modelLabel(verifiedModel),
        source: 'response',
        capturedAt: timestamp(verification?.verifiedAt),
        sourcePriority: 3,
        confirmed: verification?.evidenceSource === 'network_response_metadata'
          && !verification?.reasons?.includes?.('model_missing'),
        mismatch: verification?.reasons?.includes?.('model_not_allowed') || verification?.verdict === 'mismatch',
      });
    }

    const requestModel = normalizeModelId(state?.lastRequest?.model);
    if (requestModel) {
      candidates.push({
        id: requestModel,
        label: modelLabel(requestModel),
        source: 'request',
        capturedAt: timestamp(state?.lastRequest?.capturedAt),
        sourcePriority: 2,
        confirmed: false,
        mismatch: false,
      });
    }

    const pageObservation = effectivePageObservation(state);
    const pageModel = normalizeModelId(pageObservation?.model);
    if (pageModel) {
      candidates.push({
        id: pageModel,
        label: modelLabel(pageModel),
        source: 'page',
        capturedAt: timestamp(pageObservation?.capturedAt),
        sourcePriority: 1,
        confirmed: false,
        mismatch: false,
      });
    }

    candidates.sort((left, right) => (
      right.capturedAt - left.capturedAt || right.sourcePriority - left.sourcePriority
    ));
    return candidates[0] ?? null;
  }

  function rememberModels(models) {
    if (!models.length) return;
    writeQueue = writeQueue.then(async () => {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      const existing = Array.isArray(stored[STORAGE_KEY])
        ? stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean)
        : [];
      const next = [...new Set([...existing, ...models.map(normalizeModelId).filter(Boolean)])]
        .slice(-MAX_DISCOVERED_MODELS);
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        await chrome.storage.sync.set({ [STORAGE_KEY]: next });
      }
    }).catch(() => {});
  }

  function statusAnchorRect() {
    const statusHost = document.getElementById('gptlock-indicator-host');
    const statusButton = statusHost?.shadowRoot?.querySelector?.('button');
    const target = statusButton || statusHost;
    const rect = target?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function positionIndicator() {
    positionFrame = null;
    const host = indicator?.isConnected ? indicator : ensureIndicator();
    const anchor = statusAnchorRect();
    if (!anchor) {
      host.style.right = `${VIEWPORT_MARGIN_PX}px`;
      host.style.bottom = '52px';
      return;
    }
    const right = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - anchor.right);
    const bottom = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - anchor.top + INDICATOR_GAP_PX);
    host.style.right = `${Math.round(right)}px`;
    host.style.bottom = `${Math.round(bottom)}px`;
  }

  function schedulePosition() {
    if (positionFrame !== null) return;
    positionFrame = window.requestAnimationFrame(positionIndicator);
  }

  function observeStatusAnchor() {
    anchorResizeObserver?.disconnect();
    anchorResizeObserver = null;
    if (typeof ResizeObserver !== 'function') return;
    const statusHost = document.getElementById('gptlock-indicator-host');
    const target = statusHost?.shadowRoot?.querySelector?.('button') || statusHost;
    if (!target) return;
    anchorResizeObserver = new ResizeObserver(schedulePosition);
    anchorResizeObserver.observe(target);
  }

  function ensureIndicator() {
    if (indicator?.isConnected) return indicator;
    const existing = document.getElementById('gptlock-model-indicator-host');
    if (existing?.shadowRoot) {
      indicator = existing;
      schedulePosition();
      return existing;
    }
    existing?.remove();

    const host = document.createElement('div');
    host.id = 'gptlock-model-indicator-host';
    host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:52px;z-index:2147483647;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        button{display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:7px 11px;
          color:#fff;background:rgba(15,23,42,.68);-webkit-backdrop-filter:blur(10px) saturate(130%);backdrop-filter:blur(10px) saturate(130%);
          font:700 11px/1.2 system-ui,sans-serif;box-shadow:0 5px 18px rgba(15,23,42,.18);cursor:pointer;white-space:nowrap}
        button::before{content:'';width:6px;height:6px;border-radius:50%;background:rgba(226,232,240,.9);box-shadow:0 0 0 2px rgba(255,255,255,.12)}
        button[data-tone="confirmed"]{background:rgba(21,128,61,.72);border-color:rgba(187,247,208,.48)}
        button[data-tone="confirmed"]::before{background:#bbf7d0}
        button[data-tone="request"]{background:rgba(37,99,235,.72);border-color:rgba(191,219,254,.48)}
        button[data-tone="request"]::before{background:#bfdbfe}
        button[data-tone="mismatch"]{background:rgba(185,28,28,.74);border-color:rgba(254,202,202,.5)}
        button[data-tone="mismatch"]::before{background:#fecaca}
        button:focus{outline:3px solid rgba(191,219,254,.8);outline-offset:2px}
      </style>
      <button type="button" data-tone="unknown" title="GPTLock 当前模型 / Current model">当前模型 · 未识别</button>`;
    root.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'GPTLOCK_OPEN_OPTIONS' }, () => void chrome.runtime.lastError);
    });
    document.documentElement.append(host);
    indicator = host;
    observeStatusAnchor();
    schedulePosition();
    return host;
  }

  function render(state) {
    lastState = state ?? lastState;
    const host = ensureIndicator();
    const button = host.shadowRoot.querySelector('button');
    const model = currentModel(lastState);
    if (!model) {
      button.textContent = '当前模型 · 未识别';
      button.dataset.tone = 'unknown';
      button.title = '当前页面尚未取得可靠模型名称。\nCurrent page has not exposed a reliable model name yet.';
      schedulePosition();
      return;
    }

    if (model.source === 'response') {
      button.textContent = `当前模型 · ${model.label}`;
      button.dataset.tone = model.mismatch ? 'mismatch' : model.confirmed ? 'confirmed' : 'request';
      button.title = model.mismatch
        ? `响应确认模型：${model.label} (${model.id})\n该模型与当前锁定策略不一致。`
        : `响应模型：${model.label} (${model.id})\n${model.confirmed ? '已由网络响应元数据确认。' : '响应中识别到模型，但确认信息尚未完整。'}`;
      schedulePosition();
      return;
    }

    if (model.source === 'request') {
      button.textContent = `请求模型 · ${model.label}`;
      button.dataset.tone = 'request';
      button.title = `正式请求模型：${model.label} (${model.id})\n这是发出的请求模型，仍等待响应元数据确认实际响应模型。`;
      schedulePosition();
      return;
    }

    button.textContent = `页面模型 · ${model.label}`;
    button.dataset.tone = 'unknown';
    button.title = `页面选择：${model.label} (${model.id})\n页面选择变化会实时更新；正式请求后以更新的请求/响应证据为准。`;
    schedulePosition();
  }

  function consumeState(state) {
    if (!state) return;
    lastState = state;
    rememberModels(modelCandidates(state));
    render(state);
  }

  function refreshPageModel() {
    pageRefreshTimer = null;
    const model = detectPageModel();
    const previousModel = normalizeModelId(localPageObservation?.model);
    if (model !== previousModel) {
      localPageObservation = model ? {
        model,
        evidenceSource: 'page_dom_live',
        capturedAt: new Date().toISOString(),
      } : null;
      if (model) rememberModels([model]);
      render(lastState);
    }
    observeStatusAnchor();
    schedulePosition();
  }

  function schedulePageRefresh() {
    if (pageRefreshTimer !== null) return;
    pageRefreshTimer = window.setTimeout(refreshPageModel, PAGE_REFRESH_DELAY_MS);
  }

  function refreshState() {
    if (stateRefreshInFlight) return;
    stateRefreshInFlight = true;
    chrome.runtime.sendMessage({ type: 'GPTLOCK_GET_STATE' }, (response) => {
      stateRefreshInFlight = false;
      if (chrome.runtime.lastError) return;
      if (response?.ok) consumeState(response.data?.tabState);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GPTLOCK_GUARD_STATE') consumeState(message.state);
    return false;
  });

  const pageObserver = new MutationObserver(schedulePageRefresh);
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'data-testid'],
  });

  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshState();
      schedulePageRefresh();
    }
  });

  ensureIndicator();
  refreshPageModel();
  refreshState();
  window.setInterval(() => {
    if (!document.hidden) refreshState();
  }, STATE_REFRESH_MS);
})();
