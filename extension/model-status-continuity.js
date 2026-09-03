(() => {
  const STORAGE_KEY = 'gptlock.trusted-model-status.v1';
  const helper = globalThis.__GPTLOCK_MODEL_STATUS_HISTORY__;
  if (!helper || typeof document === 'undefined') return;

  let state = null;
  let policy = null;
  let trusted = null;
  let writeQueue = Promise.resolve();

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
      return;
    }
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      trusted = changes[STORAGE_KEY].newValue || null;
    }
  });

  chrome.storage.local.get(STORAGE_KEY, (stored) => {
    if (!chrome.runtime.lastError) trusted = stored?.[STORAGE_KEY] || null;
    refreshState();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshState();
  });
  window.addEventListener('popstate', refreshState);
  window.addEventListener('hashchange', refreshState);

  // This module owns only trusted evidence continuity. The visible floating model
  // indicator has exactly one DOM writer: model-catalog.js. Keeping history and
  // rendering separate prevents periodic state refreshes from racing historical
  // labels such as "最近请求" back to "等待请求".
  void state;
  void policy;
})();
