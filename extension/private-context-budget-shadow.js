(() => {
  const KEY = '__GPTLOCK_PRIVATE_CONTEXT_BUDGET_SHADOW__';
  if (globalThis[KEY]) return;

  const MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_BUDGET';
  const REFRESH_MS = 30_000;
  const ERROR_BACKOFF_MS = 5 * 60 * 1000;
  const MAX_PARTS = 20_000;
  const MAX_MEDIA_PER_PART = 32;

  function boundedCount(value, max = MAX_MEDIA_PER_PART) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(max, Math.floor(number));
  }

  function normalizePart(value = {}) {
    return {
      text: typeof value?.text === 'string' ? value.text : '',
      images: boundedCount(value?.images),
      attachments: boundedCount(value?.attachments),
    };
  }

  function buildBudgetPayload({ model = null, history = [], draft = {}, profile = null } = {}) {
    const normalizedHistory = Array.isArray(history)
      ? history.slice(0, MAX_PARTS).map(normalizePart)
      : [];
    return {
      model: typeof model === 'string' ? model.slice(0, 128) : null,
      history: normalizedHistory,
      draft: normalizePart(draft),
      profile: {
        adaptiveSafeLimitTokens: Number(profile?.adaptiveSafeLimitTokens) || 0,
        hardLimitUpperBoundTokens: Number(profile?.hardLimitUpperBoundTokens) || 0,
        confirmedConversationTokens: Number(profile?.confirmedConversationTokens) || 0,
      },
    };
  }

  function compareWithLegacy(privateResult, legacySnapshot) {
    if (!privateResult || !legacySnapshot) return null;
    const comparable = legacySnapshot.historyMeasurementSource === 'dom-fallback';
    return {
      comparable,
      wouldExceedMatches: Boolean(privateResult.wouldExceed) === Boolean(legacySnapshot.wouldExceed),
      safeLimitDelta: Number(privateResult.safeLimitTokens || 0) - Number(legacySnapshot.safeLimitTokens || 0),
      usedTokensDelta: Number(privateResult.usedTokens || 0) - Number(legacySnapshot.usedTokens || 0),
      remainingTokensDelta: Number(privateResult.remainingTokens || 0) - Number(legacySnapshot.remainingTokens || 0),
    };
  }

  const api = {
    normalizePart,
    buildBudgetPayload,
    compareWithLegacy,
    state: null,
  };
  globalThis[KEY] = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let inFlight = false;
  let backoffUntil = 0;

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function textOf(element) {
    return element?.innerText || element?.textContent || '';
  }

  function mediaCounts(root) {
    if (!root?.querySelectorAll) return { images: 0, attachments: 0 };
    const images = root.querySelectorAll('img').length;
    const attachments = root.querySelectorAll('[data-testid*="file" i],[data-testid*="attachment" i],a[download]').length;
    return {
      images: boundedCount(images),
      attachments: boundedCount(attachments),
    };
  }

  function currentHistoryParts() {
    const roleElements = [...document.querySelectorAll('[data-message-author-role]')];
    const seen = new Set();
    const parts = [];
    for (const element of roleElements) {
      const turn = element.closest('article[data-testid^="conversation-turn-"]') || element;
      if (seen.has(turn)) continue;
      seen.add(turn);
      const media = mediaCounts(turn);
      parts.push(normalizePart({ text: textOf(turn), ...media }));
      if (parts.length >= MAX_PARTS) break;
    }
    if (parts.length) return parts;
    for (const turn of document.querySelectorAll('article[data-testid^="conversation-turn-"]')) {
      const media = mediaCounts(turn);
      parts.push(normalizePart({ text: textOf(turn), ...media }));
      if (parts.length >= MAX_PARTS) break;
    }
    return parts;
  }

  function currentDraftPart() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-testid*="prompt"]',
      '[contenteditable="true"][data-testid*="composer"]',
      '.ProseMirror[contenteditable="true"]',
    ];
    const composer = selectors
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element)) || null;
    if (!composer) return normalizePart();
    const root = composer.closest('form') || composer.parentElement || composer;
    const media = mediaCounts(root);
    const text = 'value' in composer ? composer.value || '' : textOf(composer);
    return normalizePart({ text, ...media });
  }

  async function refresh() {
    if (inFlight || Date.now() < backoffUntil || document.visibilityState === 'hidden') return;
    const legacy = globalThis.__GPTLOCK_CONTEXT_BUDGET__;
    const snapshot = legacy?.snapshot?.();
    if (!snapshot) return;
    const payload = buildBudgetPayload({
      model: snapshot.model,
      history: currentHistoryParts(),
      draft: currentDraftPart(),
      profile: legacy?.learningProfile?.() || null,
    });

    inFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload });
      if (!response?.ok || !response.data) {
        backoffUntil = Date.now() + ERROR_BACKOFF_MS;
        return;
      }
      const comparison = compareWithLegacy(response.data, snapshot);
      api.state = {
        evaluatedAt: new Date().toISOString(),
        privateResult: response.data,
        legacy: {
          historyMeasurementSource: snapshot.historyMeasurementSource || null,
          safeLimitTokens: Number(snapshot.safeLimitTokens) || 0,
          usedTokens: Number(snapshot.usedTokens) || 0,
          remainingTokens: Number(snapshot.remainingTokens) || 0,
          wouldExceed: Boolean(snapshot.wouldExceed),
        },
        comparison,
      };
      window.dispatchEvent(new CustomEvent('gptlock:private-context-budget-shadow', { detail: api.state }));
    } catch {
      backoffUntil = Date.now() + ERROR_BACKOFF_MS;
    } finally {
      inFlight = false;
    }
  }

  window.addEventListener('gptlock:context-budget', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  window.setInterval(() => void refresh(), REFRESH_MS);
  window.setTimeout(() => void refresh(), 1_500);
})();
