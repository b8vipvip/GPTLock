(() => {
  const STORAGE_KEY = 'discoveredModels';
  const MAX_DISCOVERED_MODELS = 64;
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });

  let indicator = null;
  let lastState = null;
  let writeQueue = Promise.resolve();

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    return MODEL_ALIASES[model] ?? model;
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

  function modelCandidates(state) {
    const values = [];
    const add = (value) => {
      const model = normalizeModelId(value);
      if (model && !values.includes(model)) values.push(model);
    };
    add(state?.lastVerification?.model);
    add(state?.lastRequest?.model);
    add(state?.pageObservation?.model);
    return values;
  }

  function currentModel(state) {
    const verification = state?.lastVerification;
    const verifiedModel = normalizeModelId(verification?.model);
    if (verifiedModel) {
      const confirmed = verification?.evidenceSource === 'network_response_metadata'
        && !verification?.reasons?.includes?.('model_missing');
      return {
        id: verifiedModel,
        label: modelLabel(verifiedModel),
        source: 'response',
        confirmed,
        mismatch: verification?.reasons?.includes?.('model_not_allowed') || verification?.verdict === 'mismatch',
      };
    }

    const requestModel = normalizeModelId(state?.lastRequest?.model);
    if (requestModel) {
      return {
        id: requestModel,
        label: modelLabel(requestModel),
        source: 'request',
        confirmed: false,
        mismatch: false,
      };
    }

    const pageModel = normalizeModelId(state?.pageObservation?.model);
    if (pageModel) {
      return {
        id: pageModel,
        label: modelLabel(pageModel),
        source: 'page',
        confirmed: false,
        mismatch: false,
      };
    }
    return null;
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

  function ensureIndicator() {
    if (indicator?.isConnected) return indicator;
    const host = document.createElement('div');
    host.id = 'gptlock-model-indicator-host';
    host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:50px;z-index:2147483646';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        button{border:1px solid rgba(15,23,42,.14);border-radius:999px;padding:6px 10px;color:#334155;background:#fff;
          font:700 11px/1.2 system-ui,sans-serif;box-shadow:0 4px 14px rgba(15,23,42,.12);cursor:pointer;white-space:nowrap}
        button[data-tone="confirmed"]{color:#166534;border-color:#bbf7d0;background:#f0fdf4}
        button[data-tone="request"]{color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}
        button[data-tone="mismatch"]{color:#991b1b;border-color:#fecaca;background:#fff7f7}
        button:focus{outline:3px solid #bfdbfe}
      </style>
      <button type="button" data-tone="unknown" title="GPTLock 当前模型 / Current model">当前模型 · 未识别</button>`;
    root.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'GPTLOCK_OPEN_OPTIONS' }, () => void chrome.runtime.lastError);
    });
    document.documentElement.append(host);
    indicator = host;
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
      return;
    }

    if (model.source === 'response') {
      button.textContent = `当前模型 · ${model.label}`;
      button.dataset.tone = model.mismatch ? 'mismatch' : model.confirmed ? 'confirmed' : 'request';
      button.title = model.mismatch
        ? `响应确认模型：${model.label} (${model.id})\n该模型与当前锁定策略不一致。`
        : `响应模型：${model.label} (${model.id})\n${model.confirmed ? '已由网络响应元数据确认。' : '响应中识别到模型，但确认信息尚未完整。'}`;
      return;
    }

    if (model.source === 'request') {
      button.textContent = `请求模型 · ${model.label}`;
      button.dataset.tone = 'request';
      button.title = `正式请求模型：${model.label} (${model.id})\n这是发出的请求模型，仍等待响应元数据确认实际响应模型。`;
      return;
    }

    button.textContent = `页面模型 · ${model.label}`;
    button.dataset.tone = 'unknown';
    button.title = `页面选择：${model.label} (${model.id})\n这是页面 DOM 识别结果，不替代网络层锁定与响应确认。`;
  }

  function consumeState(state) {
    if (!state) return;
    rememberModels(modelCandidates(state));
    render(state);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GPTLOCK_GUARD_STATE') consumeState(message.state);
    return false;
  });

  ensureIndicator();
  chrome.runtime.sendMessage({ type: 'GPTLOCK_GET_STATE' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.ok) consumeState(response.data?.tabState);
  });
})();
