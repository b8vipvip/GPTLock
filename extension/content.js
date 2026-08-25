(() => {
  const MODEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[data-testid*="model-switcher"]',
  ];
  const REASONING_SELECTORS = [
    '[data-testid*="reasoning"] button',
    'button[data-testid*="reasoning"]',
  ];

  let reportTimer = null;
  let previousFingerprint = '';

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

  async function report() {
    const observation = collectObservation();
    const fingerprint = JSON.stringify([observation.model, observation.reasoning]);
    if (fingerprint === previousFingerprint) return;
    previousFingerprint = fingerprint;
    try {
      await chrome.runtime.sendMessage({ type: 'GPTLOCK_PAGE_OBSERVATION', observation });
    } catch {
      // The service worker or native host may be unavailable during browser startup.
    }
  }

  function scheduleReport() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => void report(), 1200);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'GPTLOCK_COLLECT_PAGE_STATE') return false;
    sendResponse({ ok: true, observation: collectObservation() });
    return false;
  });

  new MutationObserver(scheduleReport).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleReport();
})();
