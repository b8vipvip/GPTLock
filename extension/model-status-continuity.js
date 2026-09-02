(() => {
  const STORAGE_KEY = 'gptlock.trusted-model-status.v1';
  const helper = globalThis.__GPTLOCK_MODEL_STATUS_HISTORY__;
  if (!helper || typeof document === 'undefined') return;

  let state = null;
  let policy = null;
  let trusted = null;
  let refreshQueued = false;
  let writeQueue = Promise.resolve();

  function modelLabel(value) {
    const model = helper.normalizeModelId(value);
    if (!model) return '未识别';
    if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
    if (model === 'gpt-5.5') return 'GPT-5.5';
    if (!model.startsWith('gpt-')) return model;
    return model.split('-').map((part, index) => {
      if (index === 0) return 'GPT';
      if (/^\d+(?:\.\d+)*$/.test(part)) return part;
      if (part === 'sol') return 'Sol';
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }

  function persistTrusted(next) {
    if (!next || JSON.stringify(next) === JSON.stringify(trusted)) return;
    trusted = next;
    writeQueue = writeQueue
      .then(() => chrome.storage.local.set({ [STORAGE_KEY]: trusted }))
      .catch(() => {});
  }

  function absorbEvidence(nextState) {
    if (!nextState) return;
    persistTrusted(helper.mergeTrustedEvidence(trusted, nextState));
  }

  function consume(nextState, nextPolicy = null) {
    if (nextState) state = nextState;
    if (nextPolicy) policy = nextPolicy;
    absorbEvidence(nextState);
    scheduleRender();
  }

  function ensureStyle(root) {
    if (root.getElementById('gptlock-model-status-continuity-style')) return;
    const style = document.createElement('style');
    style.id = 'gptlock-model-status-continuity-style';
    style.textContent = `
      .model-row[data-status="request-history"] .model-value{color:#dbeafe;opacity:1;font-weight:800}
      .model-row[data-status="confirmed-history"] .model-value{color:#dcfce7;opacity:1;font-weight:800}
    `;
    root.append(style);
  }

  function setRow(button, source, value, status, historyKind = '') {
    const row = button.querySelector(`[data-source="${source}"]`);
    if (!row) return;
    if (row.dataset.status !== status) row.dataset.status = status;
    if (historyKind) {
      if (row.dataset.history !== historyKind) row.dataset.history = historyKind;
    } else if (row.hasAttribute('data-history')) {
      row.removeAttribute('data-history');
    }
    const target = row.querySelector('.model-value');
    if (target && target.textContent !== value) target.textContent = value;
  }

  function render() {
    refreshQueued = false;
    const host = document.getElementById('gptlock-model-indicator-host');
    const root = host?.shadowRoot;
    const button = root?.querySelector('button');
    if (!root || !button) return;
    ensureStyle(root);

    const selected = helper.selectStatus({ state, history: trusted, policy });
    const request = selected.request;
    const response = selected.response;

    if (request.id) {
      setRow(
        button,
        'request',
        request.historical ? `${modelLabel(request.id)} · 最近请求` : modelLabel(request.id),
        request.historical ? 'request-history' : 'request',
        request.historical ? 'trusted' : '',
      );
    } else {
      setRow(button, 'request', '等待请求', 'waiting');
    }

    if (response.id) {
      const label = modelLabel(response.id);
      const status = response.mismatch
        ? 'mismatch'
        : response.historical
          ? 'confirmed-history'
          : response.confirmed ? 'confirmed' : 'response';
      setRow(button, 'response', label, status, response.historical ? 'trusted' : '');
    } else {
      setRow(button, 'response', request.current ? '等待当前响应' : '等待响应', 'waiting');
    }

    const tone = response.mismatch
      ? 'mismatch'
      : response.confirmed
        ? 'confirmed'
        : request.id
          ? 'request'
          : 'unknown';
    if (button.dataset.tone !== tone) button.dataset.tone = tone;

    const requestDetail = request.id
      ? `${modelLabel(request.id)} (${request.id})${request.historical ? ' · 最近一次可信请求，当前聊天尚未发送' : ' · 当前聊天请求'}`
      : '等待当前聊天首次请求';
    const responseDetail = response.id
      ? `${modelLabel(response.id)} (${response.id})${response.historical ? ' · 最近一次网络响应已确认，当前聊天尚未产生响应' : response.confirmed ? ' · 当前聊天网络响应已确认' : ''}`
      : request.current ? '等待当前聊天响应' : '等待当前聊天首次响应';
    const pageRow = button.querySelector('[data-source="page"]');
    const pageValue = pageRow?.querySelector('.model-value')?.textContent || '未识别';
    const detail = [
      `页面模型：${pageValue}`,
      `请求模型：${requestDetail}`,
      `响应模型：${responseDetail}`,
    ].join('\n');
    if (button.title !== detail) button.title = detail;
  }

  function scheduleRender() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.setTimeout(render, 0);
  }

  function refreshState() {
    chrome.runtime.sendMessage({ type: 'GPTLOCK_GET_STATE' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) return;
      consume(response.data?.tabState, response.data?.policy);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GPTLOCK_GUARD_STATE') consume(message.state, message.policy);
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.policy?.newValue) {
      policy = changes.policy.newValue;
      scheduleRender();
      return;
    }
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      trusted = changes[STORAGE_KEY].newValue || null;
      scheduleRender();
    }
  });

  chrome.storage.local.get(STORAGE_KEY, (stored) => {
    if (!chrome.runtime.lastError) trusted = stored?.[STORAGE_KEY] || null;
    refreshState();
    scheduleRender();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshState();
  });
  window.addEventListener('popstate', refreshState);
  window.addEventListener('hashchange', refreshState);

  // Render only when model evidence or navigation state actually changes. The
  // base model indicator already has its own 1.2 s fallback refresh; a second
  // 750 ms DOM writer made the two layers alternate visible labels indefinitely.
})();
