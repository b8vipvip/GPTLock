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
  const BYPASS_OBSERVATION_TIMEOUT_MS = 3 * 60 * 1000;
  const RESPONSE_SETTLE_MS = 1_200;
  const ACCOUNT_SCOPE_REFRESH_MS = 5 * 60 * 1000;
  const ACCOUNT_FETCH_TIMEOUT_MS = 4_000;
  const CONVERSATION_FETCH_TIMEOUT_MS = 5_000;
  const CONVERSATION_METRICS_REFRESH_MS = 5_000;
  const CONVERSATION_METRICS_MAX_AGE_MS = 30_000;
  const LEARNING_HEADROOM_RATIO = 0.06;
  const LEARNING_HEADROOM_MIN_TOKENS = 8_192;
  const LEARNING_HEADROOM_MAX_TOKENS = 128_000;
  const MAX_ADAPTIVE_LIMIT_TOKENS = 16_000_000;
  const CONTEXT_PROFILE_STORAGE_PREFIX = 'gptlock.context-profile.v1:';
  const CONTEXT_STATE_STORAGE_PREFIX = 'gptlock.context-state.v1:';
  const PENDING_BYPASS_STORAGE_PREFIX = 'gptlock.context-pending-bypass.v1:';
  const CONTEXT_CHECKPOINT_PERSIST_DEBOUNCE_MS = 800;
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
  const STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="停止回答"]',
  ];
  const ACCOUNT_ENDPOINTS = [
    '/api/auth/session',
    '/backend-api/me',
  ];
  const ERROR_TEXT_PATTERNS = [
    /something went wrong/i,
    /there was an error generating/i,
    /network error/i,
    /error generating a response/i,
    /出了点问题/,
    /生成回复时出错/,
    /网络错误/,
  ];
  const CONVERSATION_LENGTH_LIMIT_PATTERNS = [
    { locale: 'zh-CN', pattern: /你已(?:到达|达到)(?:此)?对话的长度上限[，,。.!！\s]*(?:你可以)?(?:开始|开启|新建)(?:一个)?新(?:聊天|对话).*继续(?:此)?对话/ },
    { locale: 'en', pattern: /(?:you(?:'|’)ve|you have) reached (?:the )?(?:maximum|max) (?:length|limit) (?:for|of) (?:this )?conversation[,.!\s]*(?:you can )?.*(?:start|begin) (?:a )?new chat/i },
    { locale: 'en', pattern: /this conversation (?:has )?reached (?:its )?(?:maximum|max) (?:length|limit).*(?:start|begin) (?:a )?new chat/i },
  ];
  const NEW_CHAT_ACTION_PATTERN = /开始新(?:对话|聊天)|新建(?:对话|聊天)|start (?:a )?new chat|new chat/i;

  let lastSnapshot = null;
  let lastKnownModel = null;
  let lastGuardState = null;
  let refreshTimer = null;
  let sendAllowedAt = 0;
  let bypassUntil = 0;
  let warningHost = null;
  let warningSnapshot = null;
  let pendingBypass = null;
  let currentAccountScope = null;
  let currentAccountScopeSource = null;
  let accountScopeCheckedAt = 0;
  let accountScopePromise = null;
  let activeProfile = null;
  let activeProfileKey = null;
  let profileLoadSequence = 0;
  let lastLoadedProfileModel = null;
  let conversationMetricsCache = null;
  let conversationMetricsCheckedAt = 0;
  let conversationMetricsPromise = null;
  let restoredCheckpoint = null;
  let restoredCheckpointKey = null;
  let checkpointLoadSequence = 0;
  let checkpointPersistTimer = null;
  let restoredPendingKey = null;
  let lastHardLimitNotice = null;
  let hardLimitLearningInFlight = false;
  let lastHardLimitFingerprint = null;

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

  function learningHeadroomTokens(confirmedConversationTokens) {
    const confirmed = Math.max(0, Number(confirmedConversationTokens) || 0);
    return Math.min(
      LEARNING_HEADROOM_MAX_TOKENS,
      Math.max(LEARNING_HEADROOM_MIN_TOKENS, Math.round(confirmed * LEARNING_HEADROOM_RATIO)),
    );
  }

  function clampAdaptiveLimit(value) {
    return Math.min(
      MAX_ADAPTIVE_LIMIT_TOKENS,
      Math.max(0, Math.ceil(Number(value) || 0)),
    );
  }

  function computeBudget({
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
    const reserveBasis = Math.max(nominalLimit, safeLimitTokens);
    const reserveTokens = reserveTokensForWindow(reserveBasis);
    const usedTokens = Math.max(0, Math.ceil(historyTokens + draftTokens));
    const projectedTokens = usedTokens + reserveTokens;
    const percent = Math.min(MAX_DISPLAY_PERCENT, (usedTokens / safeLimitTokens) * 100);
    const projectedPercent = Math.min(MAX_DISPLAY_PERCENT, (projectedTokens / safeLimitTokens) * 100);
    const remainingTokens = Math.max(0, safeLimitTokens - usedTokens);
    return {
      nominalLimitTokens: nominalLimit,
      baseSafeLimitTokens,
      adaptiveSafeLimitTokens: learnedSafeLimitTokens,
      hardLimitUpperBoundTokens: learnedHardUpper,
      confirmedLowerBoundTokens: confirmedLower,
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
      adaptiveActive: learnedSafeLimitTokens > baseSafeLimitTokens,
      hardLimitActive: hardLimitUsable && safeLimitTokens <= learnedHardUpper,
    };
  }

  function conversationMessageText(message) {
    const content = message?.content;
    if (!content || typeof content !== 'object') return '';
    const pieces = [];
    const append = (value) => {
      if (typeof value === 'string' && value) pieces.push(value);
    };
    if (Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (typeof part === 'string') append(part);
        else if (part && typeof part === 'object') {
          append(part.text);
          append(part.content);
          append(part.result);
          append(part.output);
        }
      }
    }
    append(content.text);
    append(content.result);
    append(content.output);
    return pieces.join('\n');
  }

  function conversationMessageMediaCounts(message) {
    const content = message?.content;
    let images = 0;
    let attachments = 0;
    if (content && typeof content === 'object' && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (!part || typeof part !== 'object') continue;
        const kind = String(part.content_type || part.type || '').toLowerCase();
        if (part.asset_pointer || kind.includes('image')) images += 1;
        else if (kind.includes('file') || kind.includes('attachment')) attachments += 1;
      }
    }
    const metadataAttachments = message?.metadata?.attachments;
    if (Array.isArray(metadataAttachments)) attachments += metadataAttachments.length;
    return {
      images: Math.min(32, images),
      attachments: Math.min(32, attachments),
    };
  }

  function activeConversationMessages(payload) {
    const mapping = payload?.mapping;
    let cursor = String(payload?.current_node || '').trim();
    if (!mapping || typeof mapping !== 'object' || !cursor) return [];
    const reversed = [];
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = mapping[cursor];
      if (!node || typeof node !== 'object') break;
      if (node.message && typeof node.message === 'object') reversed.push(node.message);
      cursor = String(node.parent || '').trim();
    }
    return reversed.reverse();
  }

  function extractConversationMetrics(payload) {
    const messages = activeConversationMessages(payload);
    if (!messages.length) return null;
    let tokens = 0;
    let characters = 0;
    let countedMessages = 0;
    for (const message of messages) {
      const text = conversationMessageText(message);
      const media = conversationMessageMediaCounts(message);
      if (!text && media.images === 0 && media.attachments === 0) continue;
      characters += text.length;
      tokens += estimateTextTokens(text)
        + (media.images * IMAGE_TOKEN_ESTIMATE)
        + (media.attachments * ATTACHMENT_TOKEN_ESTIMATE)
        + MESSAGE_OVERHEAD_TOKENS;
      countedMessages += 1;
    }
    if (!countedMessages) return null;
    return {
      tokens: Math.max(0, Math.ceil(tokens)),
      characters: Math.max(0, Math.ceil(characters)),
      messageCount: countedMessages,
      currentNode: payload?.current_node ? String(payload.current_node).slice(0, 256) : null,
    };
  }

  function profileStorageKey(accountScope, model) {
    const account = String(accountScope ?? '').trim();
    const normalizedModel = normalizeModelId(model);
    if (!account || !normalizedModel) return null;
    return `${CONTEXT_PROFILE_STORAGE_PREFIX}${account}:${normalizedModel}`;
  }

  function checkpointStorageKey(accountScope, conversationId, model) {
    const account = String(accountScope ?? '').trim();
    const conversation = String(conversationId ?? '').trim();
    const normalizedModel = normalizeModelId(model);
    if (!account || !conversation || !normalizedModel) return null;
    return `${CONTEXT_STATE_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;
  }

  function pendingBypassStorageKey(accountScope, conversationId, model) {
    const account = String(accountScope ?? '').trim();
    const conversation = String(conversationId ?? '').trim();
    const normalizedModel = normalizeModelId(model);
    if (!account || !conversation || !normalizedModel) return null;
    return `${PENDING_BYPASS_STORAGE_PREFIX}${account}:${conversation}:${normalizedModel}`;
  }

  function buildContextCheckpoint({
    previous = null,
    accountScope,
    accountScopeSource = 'unknown',
    conversationId,
    conversationKey,
    model,
    snapshot,
    currentNode = null,
    measuredAt = new Date().toISOString(),
  } = {}) {
    const normalizedModel = normalizeModelId(model);
    const account = String(accountScope ?? '').trim();
    const conversation = String(conversationId ?? '').trim();
    if (!account || !conversation || !normalizedModel || !snapshot) return null;
    const activeTokens = Math.max(0, Math.ceil(Number(snapshot.historyTokens) || 0));
    const activeCharacters = Math.max(0, Math.ceil(Number(snapshot.historyCharacters) || 0));
    const activeMessages = Math.max(0, Math.ceil(Number(snapshot.messageCount) || 0));
    const previousActiveTokens = Math.max(0, Math.ceil(Number(previous?.activeContextTokens) || 0));
    const previousActiveCharacters = Math.max(0, Math.ceil(Number(previous?.activeContextCharacters) || 0));
    const previousActiveMessages = Math.max(0, Math.ceil(Number(previous?.activeMessageCount) || 0));
    const cumulativeTokens = Math.max(
      activeTokens,
      Math.max(0, Math.ceil(Number(previous?.cumulativeTokens) || 0)) + Math.max(0, activeTokens - previousActiveTokens),
    );
    const cumulativeCharacters = Math.max(
      activeCharacters,
      Math.max(0, Math.ceil(Number(previous?.cumulativeCharacters) || 0)) + Math.max(0, activeCharacters - previousActiveCharacters),
    );
    const cumulativeMessages = Math.max(
      activeMessages,
      Math.max(0, Math.ceil(Number(previous?.cumulativeMessages) || 0)) + Math.max(0, activeMessages - previousActiveMessages),
    );
    return {
      schemaVersion: 1,
      accountScope: account,
      accountScopeSource,
      conversationId: conversation,
      conversationKey: String(conversationKey || `conversation:${conversation}`).slice(0, 256),
      model: normalizedModel,
      activeContextTokens: activeTokens,
      activeContextCharacters: activeCharacters,
      activeMessageCount: activeMessages,
      cumulativeTokens,
      cumulativeCharacters,
      cumulativeMessages,
      lastCurrentNode: currentNode ? String(currentNode).slice(0, 256) : null,
      measurementSource: String(snapshot.historyMeasurementSource || 'unknown').slice(0, 80),
      lastMeasuredAt: measuredAt,
      lastLiveSyncedAt: measuredAt,
    };
  }

  function serializePendingBypassRecord(pending) {
    if (!pending?.accountScope || !pending?.model || !pending?.conversationKey) return null;
    const startedAt = Math.max(0, Number(pending.startedAt) || 0);
    if (!startedAt) return null;
    return {
      schemaVersion: 1,
      startedAt,
      expiresAt: startedAt + BYPASS_OBSERVATION_TIMEOUT_MS,
      conversationKey: String(pending.conversationKey).slice(0, 256),
      model: normalizeModelId(pending.model),
      accountScope: String(pending.accountScope),
      accountScopeSource: String(pending.accountScopeSource || 'unknown').slice(0, 80),
      baselineAssistantCount: Math.max(0, Math.floor(Number(pending.baselineAssistantCount) || 0)),
      requestId: pending.requestId ? String(pending.requestId).slice(0, 256) : null,
      requestObserved: Boolean(pending.requestObserved),
      responseSeen: Boolean(pending.responseSeen),
      responseSuccessful: pending.responseSuccessful === true ? true : pending.responseSuccessful === false ? false : null,
      preSnapshot: pending.preSnapshot ? {
        usedTokens: Math.max(0, Math.ceil(Number(pending.preSnapshot.usedTokens) || 0)),
        fullConversationCharacters: Math.max(0, Math.ceil(Number(pending.preSnapshot.fullConversationCharacters) || 0)),
        conversationKey: String(pending.preSnapshot.conversationKey || pending.conversationKey).slice(0, 256),
        model: normalizeModelId(pending.preSnapshot.model || pending.model),
      } : null,
    };
  }

  function restorePendingBypassRecord(record, {
    now = Date.now(),
    accountScope,
    conversationKey,
    model,
  } = {}) {
    if (!record || Number(record.schemaVersion) !== 1) return null;
    if (Number(record.expiresAt) <= Number(now)) return null;
    if (String(record.accountScope || '') !== String(accountScope || '')) return null;
    if (String(record.conversationKey || '') !== String(conversationKey || '')) return null;
    if (normalizeModelId(record.model) !== normalizeModelId(model)) return null;
    if (!record.requestObserved || !record.preSnapshot?.usedTokens) return null;
    return {
      ...record,
      learningStarted: false,
      stableSignature: null,
      stableSince: 0,
    };
  }

  function nextLearnedProfile({
    previous = null,
    accountScope,
    accountScopeSource = 'unknown',
    model,
    confirmedConversationTokens,
    confirmedCharacters = 0,
    conversationKey = 'unknown',
    measuredAt = new Date().toISOString(),
    baseSafeLimitTokens = 0,
  } = {}) {
    const normalizedModel = normalizeModelId(model);
    const confirmed = clampAdaptiveLimit(confirmedConversationTokens);
    if (!accountScope || !normalizedModel || confirmed <= 0) return null;
    const previousConfirmed = clampAdaptiveLimit(previous?.confirmedConversationTokens);
    const nextConfirmed = Math.max(previousConfirmed, confirmed);
    const candidateAdaptive = clampAdaptiveLimit(nextConfirmed + learningHeadroomTokens(nextConfirmed));
    const previousAdaptive = clampAdaptiveLimit(previous?.adaptiveSafeLimitTokens);
    const adaptiveSafeLimitTokens = Math.max(
      Math.ceil(Number(baseSafeLimitTokens) || 0), previousAdaptive, candidateAdaptive,
    );
    return {
      ...(previous && typeof previous === 'object' ? previous : {}),
      schemaVersion: 1,
      accountScope,
      accountScopeSource,
      model: normalizedModel,
      confirmedConversationTokens: nextConfirmed,
      confirmedCharacters: Math.max(
        Math.max(0, Math.ceil(Number(previous?.confirmedCharacters) || 0)),
        Math.max(0, Math.ceil(Number(confirmedCharacters) || 0)),
      ),
      adaptiveSafeLimitTokens,
      successfulBypassCount: Math.max(0, Math.floor(Number(previous?.successfulBypassCount) || 0)) + 1,
      firstConfirmedAt: previous?.firstConfirmedAt || measuredAt,
      lastConfirmedAt: measuredAt,
      lastConversationKey: String(conversationKey || 'unknown').slice(0, 256),
      evidence: 'explicit-over-limit-send+formal-request+settled-assistant-turn',
    };
  }

  function classifyConversationLengthLimitText(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_000);
    if (!text) return null;
    for (const entry of CONVERSATION_LENGTH_LIMIT_PATTERNS) {
      if (entry.pattern.test(text)) return { matched: true, locale: entry.locale, text };
    }
    return null;
  }

  function nextHardLimitProfile({
    previous = null,
    accountScope,
    accountScopeSource = 'unknown',
    model,
    observedConversationTokens = 0,
    observedCharacters = 0,
    observedMessages = 0,
    conversationKey = 'unknown',
    measuredAt = new Date().toISOString(),
    measurementSource = 'unknown',
    measurementReliable = false,
    noticeText = '',
    actionText = '',
  } = {}) {
    const normalizedModel = normalizeModelId(model);
    const account = String(accountScope ?? '').trim();
    if (!account || !normalizedModel) return null;
    const observed = clampAdaptiveLimit(observedConversationTokens);
    const confirmedLower = clampAdaptiveLimit(previous?.confirmedConversationTokens);
    const previousUpper = clampAdaptiveLimit(previous?.hardLimitUpperBoundTokens);
    const usableObservation = Boolean(measurementReliable && observed > confirmedLower);
    const hardLimitUpperBoundTokens = usableObservation
      ? (previousUpper > confirmedLower ? Math.min(previousUpper, observed) : observed)
      : previousUpper;
    return {
      ...(previous && typeof previous === 'object' ? previous : {}),
      schemaVersion: 1,
      accountScope: account,
      accountScopeSource,
      model: normalizedModel,
      hardLimitObserved: true,
      hardLimitObservedCount: Math.max(0, Math.floor(Number(previous?.hardLimitObservedCount) || 0)) + 1,
      hardLimitObservedTokens: observed,
      hardLimitObservedCharacters: Math.max(0, Math.ceil(Number(observedCharacters) || 0)),
      hardLimitObservedMessages: Math.max(0, Math.ceil(Number(observedMessages) || 0)),
      hardLimitUpperBoundTokens,
      hardLimitTokenCapUsable: hardLimitUpperBoundTokens > confirmedLower,
      hardLimitConfidence: usableObservation ? 'measured-upper-bound' : 'ui-boundary-only',
      hardLimitMeasurementSource: String(measurementSource || 'unknown').slice(0, 80),
      hardLimitLastObservedAt: measuredAt,
      hardLimitLastConversationKey: String(conversationKey || 'unknown').slice(0, 256),
      hardLimitLastText: String(noticeText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      hardLimitActionText: String(actionText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      hardLimitEvidence: 'chatgpt-visible-conversation-length-limit',
    };
  }

  const api = {
    contextWindowForModel,
    estimateTextTokens,
    computeBudget,
    learningHeadroomTokens,
    profileStorageKey,
    nextLearnedProfile,
    classifyConversationLengthLimitText,
    nextHardLimitProfile,
    extractConversationMetrics,
    checkpointStorageKey,
    pendingBypassStorageKey,
    buildContextCheckpoint,
    serializePendingBypassRecord,
    restorePendingBypassRecord,
    snapshot: () => lastSnapshot,
    learningProfile: () => activeProfile,
    checkpoint: () => restoredCheckpoint,
  };
  globalThis.__GPTLOCK_CONTEXT_BUDGET__ = api;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden');
  }

  function findVisibleConversationLengthLimit() {
    const candidates = [...document.querySelectorAll('p,[role="alert"],[role="status"]')].filter(visible);
    for (const element of candidates) {
      if (element.closest('#gptlock-context-warning-host,#gptlock-context-learning-toast,#gptlock-context-hard-limit-toast')) continue;
      const match = classifyConversationLengthLimitText(elementText(element));
      if (!match) continue;
      let actionText = '';
      let container = element;
      for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
        const action = [...(container.querySelectorAll?.('button,a') || [])]
          .find((candidate) => visible(candidate) && NEW_CHAT_ACTION_PATTERN.test(elementText(candidate).trim()));
        if (action) { actionText = elementText(action).trim(); break; }
      }
      const insideConversationTurn = Boolean(element.closest('[data-message-author-role],article[data-testid^="conversation-turn-"]'));
      const semanticNotice = ['alert', 'status'].includes(String(element.getAttribute('role') || '').toLowerCase());
      if (!actionText && insideConversationTurn && !semanticNotice) continue;
      return { ...match, actionText: actionText.slice(0, 120) };
    }
    return null;
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

  function elementText(element) {
    return element?.innerText || element?.textContent || '';
  }

  function elementMetrics(element) {
    const text = elementText(element);
    return {
      characters: text.length,
      tokens: estimateTextTokens(text)
        + (imageCount(element) * IMAGE_TOKEN_ESTIMATE)
        + (attachmentCount(element) * ATTACHMENT_TOKEN_ESTIMATE)
        + MESSAGE_OVERHEAD_TOKENS,
    };
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

  function assistantElements() {
    const unique = [];
    const seen = new Set();
    for (const element of document.querySelectorAll('[data-message-author-role="assistant"]')) {
      const turn = element.closest('article[data-testid^="conversation-turn-"]') || element;
      if (seen.has(turn)) continue;
      seen.add(turn);
      unique.push(turn);
    }
    return unique;
  }

  function assistantStats() {
    const elements = assistantElements();
    const last = elements[elements.length - 1] || null;
    const lastMetrics = last ? elementMetrics(last) : { tokens: 0, characters: 0 };
    return {
      count: elements.length,
      lastTokens: lastMetrics.tokens,
      lastCharacters: lastMetrics.characters,
    };
  }

  function detectModel() {
    const validated = globalThis.__GPTLOCK_PAGE_MODEL_EVIDENCE__?.collect?.();
    const pageModel = normalizeModelId(validated?.model);
    return normalizeModelId(lastKnownModel) || pageModel || null;
  }

  function currentConversationId() {
    try {
      return new URL(location.href).pathname.match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)/)?.[1] || null;
    } catch {
      return null;
    }
  }

  function currentConversationKey() {
    try {
      const url = new URL(location.href);
      const conversationId = currentConversationId();
      return conversationId ? `conversation:${conversationId}` : `page:${url.pathname}`;
    } catch {
      return 'unknown';
    }
  }

  async function loadConversationCheckpoint() {
    const sequence = ++checkpointLoadSequence;
    const conversationId = currentConversationId();
    const model = detectModel();
    const key = checkpointStorageKey(currentAccountScope, conversationId, model);
    restoredCheckpointKey = key;
    if (!key) {
      restoredCheckpoint = null;
      scheduleRefresh();
      return null;
    }
    try {
      const stored = await chrome.storage.local.get(key);
      if (sequence !== checkpointLoadSequence) return null;
      const checkpoint = stored[key] ?? null;
      if (
        checkpoint
        && checkpoint.accountScope === currentAccountScope
        && checkpoint.conversationId === conversationId
        && normalizeModelId(checkpoint.model) === normalizeModelId(model)
      ) {
        restoredCheckpoint = checkpoint;
      } else {
        restoredCheckpoint = null;
      }
    } catch {
      if (sequence !== checkpointLoadSequence) return null;
      restoredCheckpoint = null;
    }
    scheduleRefresh();
    return restoredCheckpoint;
  }

  async function persistConversationCheckpoint(snapshot) {
    const conversationId = currentConversationId();
    const model = normalizeModelId(snapshot?.model) || detectModel();
    const key = checkpointStorageKey(currentAccountScope, conversationId, model);
    if (!key || snapshot?.historyMeasurementSource !== 'conversation-tree+dom-reconcile') return null;
    if (snapshot.conversationKey !== currentConversationKey()) return null;
    try {
      const stored = restoredCheckpointKey === key && restoredCheckpoint
        ? { [key]: restoredCheckpoint }
        : await chrome.storage.local.get(key);
      const previous = stored[key] ?? null;
      const next = buildContextCheckpoint({
        previous,
        accountScope: currentAccountScope,
        accountScopeSource: currentAccountScopeSource || 'unknown',
        conversationId,
        conversationKey: snapshot.conversationKey,
        model,
        snapshot,
        currentNode: conversationMetricsCache?.currentNode || null,
        measuredAt: new Date().toISOString(),
      });
      if (!next) return null;
      await chrome.storage.local.set({ [key]: next });
      restoredCheckpoint = next;
      restoredCheckpointKey = key;
      return next;
    } catch {
      return null;
    }
  }

  function queueConversationCheckpointPersist(snapshot) {
    if (checkpointPersistTimer !== null) window.clearTimeout(checkpointPersistTimer);
    checkpointPersistTimer = window.setTimeout(() => {
      checkpointPersistTimer = null;
      void persistConversationCheckpoint(snapshot);
    }, CONTEXT_CHECKPOINT_PERSIST_DEBOUNCE_MS);
  }

  async function persistPendingBypassState() {
    if (!pendingBypass) return null;
    const conversationId = currentConversationId();
    const model = normalizeModelId(pendingBypass.model) || detectModel();
    const key = pendingBypassStorageKey(pendingBypass.accountScope || currentAccountScope, conversationId, model);
    const record = serializePendingBypassRecord(pendingBypass);
    if (!key || !record) return null;
    try {
      await chrome.storage.local.set({ [key]: record });
      restoredPendingKey = key;
      return record;
    } catch {
      return null;
    }
  }

  async function discardPendingBypass(removeStorage = true) {
    const old = pendingBypass;
    pendingBypass = null;
    const conversationId = currentConversationId();
    const model = normalizeModelId(old?.model) || detectModel();
    const key = restoredPendingKey || pendingBypassStorageKey(old?.accountScope || currentAccountScope, conversationId, model);
    restoredPendingKey = null;
    if (removeStorage && key) {
      try { await chrome.storage.local.remove(key); } catch { /* best effort */ }
    }
  }

  async function restorePendingBypass() {
    if (pendingBypass) return pendingBypass;
    const conversationId = currentConversationId();
    const conversationKey = currentConversationKey();
    const model = detectModel();
    const key = pendingBypassStorageKey(currentAccountScope, conversationId, model);
    if (!key) return null;
    try {
      const stored = await chrome.storage.local.get(key);
      const restored = restorePendingBypassRecord(stored[key], {
        now: Date.now(),
        accountScope: currentAccountScope,
        conversationKey,
        model,
      });
      if (!restored) {
        if (stored[key]) await chrome.storage.local.remove(key);
        return null;
      }
      pendingBypass = restored;
      restoredPendingKey = key;
      scheduleRefresh();
      void maybeFinalizeBypassLearning();
      return pendingBypass;
    } catch {
      return null;
    }
  }

  async function fetchConversationMetrics(conversationId) {
    if (!conversationId) return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CONVERSATION_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return extractConversationMetrics(payload);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function refreshConversationMetrics(force = false) {
    const conversationId = currentConversationId();
    const conversationKey = currentConversationKey();
    if (!conversationId) {
      conversationMetricsCache = null;
      conversationMetricsCheckedAt = Date.now();
      return null;
    }
    const now = Date.now();
    if (
      !force
      && conversationMetricsCache?.conversationKey === conversationKey
      && now - conversationMetricsCheckedAt < CONVERSATION_METRICS_REFRESH_MS
    ) return conversationMetricsCache;
    if (conversationMetricsPromise) return conversationMetricsPromise;
    conversationMetricsPromise = (async () => {
      const metrics = await fetchConversationMetrics(conversationId);
      conversationMetricsCheckedAt = Date.now();
      if (metrics && currentConversationKey() === conversationKey) {
        conversationMetricsCache = { ...metrics, conversationKey, measuredAt: new Date().toISOString() };
        scheduleRefresh();
      }
      return conversationMetricsCache;
    })().finally(() => {
      conversationMetricsPromise = null;
    });
    return conversationMetricsPromise;
  }

  function formatCompactTokens(tokens) {
    const value = Math.max(0, Number(tokens) || 0);
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(Math.round(value));
  }

  function formatCompactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 2)}M`;
    if (number >= 1_000) return `${Math.round(number / 1_000)}k`;
    return String(Math.round(number));
  }

  function activeAdaptiveLimit(model) {
    const normalizedModel = normalizeModelId(model);
    if (!activeProfile || !currentAccountScope || !normalizedModel) return 0;
    if (activeProfile.accountScope !== currentAccountScope || activeProfile.model !== normalizedModel) return 0;
    return clampAdaptiveLimit(activeProfile.adaptiveSafeLimitTokens);
  }

  function activeHardLimit(model) {
    const normalizedModel = normalizeModelId(model);
    if (!activeProfile || !currentAccountScope || !normalizedModel) return { upper: 0, confirmed: 0 };
    if (activeProfile.accountScope !== currentAccountScope || normalizeModelId(activeProfile.model) !== normalizedModel) return { upper: 0, confirmed: 0 };
    return {
      upper: clampAdaptiveLimit(activeProfile.hardLimitUpperBoundTokens),
      confirmed: clampAdaptiveLimit(activeProfile.confirmedConversationTokens),
    };
  }

  function snapshotNow() {
    const messages = conversationElements();
    const domHistory = messages.reduce((total, element) => {
      const metrics = elementMetrics(element);
      total.tokens += metrics.tokens;
      total.characters += metrics.characters;
      return total;
    }, { tokens: 0, characters: 0 });
    const cacheFresh = Boolean(
      conversationMetricsCache
      && conversationMetricsCache.conversationKey === currentConversationKey()
      && Date.now() - conversationMetricsCheckedAt <= CONVERSATION_METRICS_MAX_AGE_MS
    );
    const checkpointUsable = Boolean(
      !cacheFresh
      && restoredCheckpoint
      && restoredCheckpoint.accountScope === currentAccountScope
      && restoredCheckpoint.conversationKey === currentConversationKey()
    );
    const history = cacheFresh ? {
      tokens: Math.max(domHistory.tokens, conversationMetricsCache.tokens),
      characters: Math.max(domHistory.characters, conversationMetricsCache.characters),
    } : checkpointUsable ? {
      tokens: Math.max(domHistory.tokens, Number(restoredCheckpoint.activeContextTokens) || 0),
      characters: Math.max(domHistory.characters, Number(restoredCheckpoint.activeContextCharacters) || 0),
    } : domHistory;
    const historyMessageCount = cacheFresh
      ? Math.max(messages.length, conversationMetricsCache.messageCount)
      : checkpointUsable
        ? Math.max(messages.length, Number(restoredCheckpoint.activeMessageCount) || 0)
        : messages.length;
    const composer = findComposer();
    const draft = composerText(composer);
    const composerRoot = composer?.closest('form') || composer?.parentElement;
    const draftTokens = estimateTextTokens(draft)
      + (imageCount(composerRoot) * IMAGE_TOKEN_ESTIMATE)
      + (attachmentCount(composerRoot) * ATTACHMENT_TOKEN_ESTIMATE)
      + (draft.trim() ? MESSAGE_OVERHEAD_TOKENS : 0);
    const model = detectModel();
    const windowProfile = contextWindowForModel(model);
    const adaptiveSafeLimitTokens = activeAdaptiveLimit(windowProfile.model);
    const learnedHardLimit = activeHardLimit(windowProfile.model);
    const budget = computeBudget({
      historyTokens: history.tokens,
      draftTokens,
      contextLimitTokens: windowProfile.tokens,
      adaptiveSafeLimitTokens,
      hardLimitUpperBoundTokens: learnedHardLimit.upper,
      confirmedLowerBoundTokens: learnedHardLimit.confirmed,
    });
    return {
      ...budget,
      model: windowProfile.model,
      contextWindowSource: windowProfile.source,
      messageCount: historyMessageCount,
      historyCharacters: history.characters,
      historyMeasurementSource: cacheFresh
        ? 'conversation-tree+dom-reconcile'
        : checkpointUsable
          ? 'checkpoint+dom-restore'
          : 'dom-fallback',
      checkpointRestored: checkpointUsable,
      checkpointMeasuredAt: checkpointUsable ? restoredCheckpoint.lastMeasuredAt ?? null : null,
      cumulativeConversationTokens: checkpointUsable || restoredCheckpoint
        ? Math.max(history.tokens, Number(restoredCheckpoint?.cumulativeTokens) || 0)
        : history.tokens,
      cumulativeConversationCharacters: checkpointUsable || restoredCheckpoint
        ? Math.max(history.characters, Number(restoredCheckpoint?.cumulativeCharacters) || 0)
        : history.characters,
      cumulativeMessageCount: checkpointUsable || restoredCheckpoint
        ? Math.max(historyMessageCount, Number(restoredCheckpoint?.cumulativeMessages) || 0)
        : historyMessageCount,
      draftCharacters: draft.length,
      fullConversationCharacters: history.characters + draft.length,
      fullConversationTokens: budget.usedTokens,
      conversationKey: currentConversationKey(),
      learnedConfirmedTokens: budget.adaptiveActive
        ? clampAdaptiveLimit(activeProfile?.confirmedConversationTokens)
        : 0,
      learnedSuccessCount: budget.adaptiveActive
        ? Math.max(0, Number(activeProfile?.successfulBypassCount) || 0)
        : 0,
      learnedAt: budget.adaptiveActive ? activeProfile?.lastConfirmedAt ?? null : null,
      hardLimitVisible: Boolean(lastHardLimitNotice && lastHardLimitNotice.conversationKey === currentConversationKey()),
      hardLimitObservedTokens: clampAdaptiveLimit(activeProfile?.hardLimitObservedTokens),
      hardLimitObservedCount: Math.max(0, Number(activeProfile?.hardLimitObservedCount) || 0),
      hardLimitConfidence: activeProfile?.hardLimitConfidence ?? (lastHardLimitNotice ? 'ui-boundary-only' : null),
      hardLimitMeasurementSource: activeProfile?.hardLimitMeasurementSource ?? null,
      hardLimitLastObservedAt: activeProfile?.hardLimitLastObservedAt ?? null,
      accountScopeAvailable: Boolean(currentAccountScope),
      accountScopeSource: currentAccountScopeSource,
      measuredAt: new Date().toISOString(),
      estimateOnly: true,
    };
  }

  function indicatorDetail(snapshot) {
    const source = snapshot.contextWindowSource === 'openai-api-model-window'
      ? '公开模型窗口'
      : '保守回退窗口';
    const rows = [
      `上下文额度：${snapshot.percent.toFixed(1)}%（本地完整聊天估算）`,
      `当前完整聊天：约 ${formatCompactTokens(snapshot.fullConversationTokens)} tokens · ${formatCompactNumber(snapshot.fullConversationCharacters)} 字符 · ${snapshot.messageCount} 条消息 · ${snapshot.historyMeasurementSource === 'conversation-tree+dom-reconcile' ? '完整活动分支' : 'DOM 回退'}`,
      `基础安全预算：${formatCompactTokens(snapshot.baseSafeLimitTokens)} / 公开窗口 ${formatCompactTokens(snapshot.nominalLimitTokens)}`,
    ];
    if (snapshot.checkpointRestored) {
      rows.push(`恢复状态：已从上次本地检查点恢复（${snapshot.checkpointMeasuredAt || '时间未知'}），正在与 ChatGPT 当前活动会话重新对账。`);
    }
    if (snapshot.cumulativeConversationTokens > snapshot.fullConversationTokens || snapshot.cumulativeMessageCount > snapshot.messageCount) {
      rows.push(`会话累计观测：约 ${formatCompactTokens(snapshot.cumulativeConversationTokens)} tokens · ${formatCompactNumber(snapshot.cumulativeConversationCharacters)} 字符 · ${snapshot.cumulativeMessageCount} 条消息`);
    }
    if (snapshot.hardLimitVisible || snapshot.hardLimitObservedCount > 0) {
      if (snapshot.hardLimitUpperBoundTokens > snapshot.confirmedLowerBoundTokens) {
        const lower = snapshot.confirmedLowerBoundTokens > 0 ? `；已确认成功下限 ≥ ${formatCompactTokens(snapshot.confirmedLowerBoundTokens)}` : '';
        rows.push(`ChatGPT 实测会话硬上限：≤ ${formatCompactTokens(snapshot.hardLimitUpperBoundTokens)} tokens${lower}（真实“对话长度上限”界面提示）`);
      } else {
        rows.push('ChatGPT 实测会话硬上限：已检测到真实“对话长度上限”提示；当前只有 DOM/不完整历史估算，因此暂不把该 token 数写成可信上限。');
      }
    }
    if (snapshot.adaptiveActive) {
      rows.push(
        `账户实测成功下限：至少 ${formatCompactTokens(snapshot.learnedConfirmedTokens)} tokens（${snapshot.learnedSuccessCount} 次超限成功）`,
        `当前自适应发送预算：${formatCompactTokens(snapshot.safeLimitTokens)} tokens`,
      );
    } else {
      rows.push(`当前发送预算：${formatCompactTokens(snapshot.safeLimitTokens)} tokens`);
    }
    rows.push(
      `预留回复：${formatCompactTokens(snapshot.reserveTokens)}`,
      `剩余发送预算：约 ${formatCompactTokens(snapshot.remainingTokens)}`,
      `模型：${snapshot.model || '未识别'} · ${source}`,
      snapshot.accountScopeAvailable
        ? '账户学习：已建立本地匿名账户范围；成功超限发送会自动抬高该账户/模型的发送预算。'
        : '账户学习：尚未识别当前 ChatGPT 账户；识别成功前不会跨账户学习。',
      '说明：插件优先读取当前会话 conversation tree 并沿 current_node 活动分支统计，再与 DOM 新内容取较大值；读取失败时退回 DOM。真实“对话长度上限”提示可以证明 ChatGPT 产品层已经封顶，但提示本身不包含官方 token 数；只有历史测量完整时才会形成可用于发送预算的 token 上界。ChatGPT 隐藏系统提示、服务端压缩/裁剪和精确 tokenizer 仍不对扩展完整开放，因此实测上下界都不等同于官方物理模型窗口。',
    );
    return rows.join('\n');
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
    if (value) {
      const adaptiveMark = snapshot.adaptiveActive ? '↗' : '';
      value.textContent = `${snapshot.percent.toFixed(snapshot.percent < 10 ? 1 : 0)}%${adaptiveMark} · 约${formatCompactTokens(snapshot.remainingTokens)}余`;
    }
    row.title = indicatorDetail(snapshot);
    row.setAttribute('aria-label', indicatorDetail(snapshot));
  }

  function publishSnapshot(next) {
    const previousFingerprint = lastSnapshot
      ? `${Math.round(lastSnapshot.percent * 10)}:${lastSnapshot.model}:${lastSnapshot.messageCount}:${lastSnapshot.wouldExceed}:${lastSnapshot.safeLimitTokens}`
      : '';
    lastSnapshot = next;
    mountIndicatorRow(next);
    if (next.historyMeasurementSource === 'conversation-tree+dom-reconcile') {
      queueConversationCheckpointPersist(next);
    }
    const fingerprint = `${Math.round(next.percent * 10)}:${next.model}:${next.messageCount}:${next.wouldExceed}:${next.safeLimitTokens}`;
    if (fingerprint !== previousFingerprint) {
      window.dispatchEvent(new CustomEvent('gptlock:context-budget', { detail: next }));
    }
  }

  function recompute() {
    refreshTimer = null;
    try {
      const notice = findVisibleConversationLengthLimit();
      if (notice) lastHardLimitNotice = { ...notice, conversationKey: currentConversationKey(), detectedAt: new Date().toISOString() };
      const next = snapshotNow();
      publishSnapshot(next);
      if (notice) void persistHardLimitObservation(next, lastHardLimitNotice);
      void refreshConversationMetrics();
      void maybeFinalizeBypassLearning();
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
    warningSnapshot = null;
  }

  function findSendButton() {
    return SEND_SELECTORS
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true') || null;
  }

  function isGenerating() {
    return STOP_SELECTORS.some((selector) => {
      const element = document.querySelector(selector);
      return element && visible(element);
    });
  }

  function hasVisibleGenerationError() {
    if (findVisibleConversationLengthLimit()) return true;
    const candidates = [
      ...document.querySelectorAll('[role="alert"],[data-testid*="error" i],[class*="error" i]'),
    ].filter(visible);
    return candidates.some((element) => {
      const text = elementText(element).trim();
      return text && ERROR_TEXT_PATTERNS.some((pattern) => pattern.test(text));
    });
  }

  function beginBypassObservation(snapshot) {
    const assistant = assistantStats();
    pendingBypass = {
      startedAt: Date.now(),
      conversationKey: snapshot?.conversationKey || currentConversationKey(),
      preSnapshot: snapshot ? { ...snapshot } : snapshotNow(),
      baselineAssistantCount: assistant.count,
      model: normalizeModelId(snapshot?.model) || detectModel(),
      accountScope: currentAccountScope,
      accountScopeSource: currentAccountScopeSource,
      requestId: null,
      requestObserved: false,
      responseSeen: false,
      responseSuccessful: null,
      stableSignature: null,
      stableSince: 0,
      learningStarted: false,
    };
    const observation = pendingBypass;
    if (observation.accountScope) void persistPendingBypassState();
    void refreshAccountScope(true).then(() => {
      if (pendingBypass !== observation) return;
      observation.accountScope = currentAccountScope;
      observation.accountScopeSource = currentAccountScopeSource;
      void persistPendingBypassState();
      void maybeFinalizeBypassLearning();
    });
  }

  function sendAfterExplicitBypass() {
    const snapshot = warningSnapshot || lastSnapshot || snapshotNow();
    if (snapshot?.wouldExceed) beginBypassObservation(snapshot);
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
    warningSnapshot = snapshot;
    const host = document.createElement('div');
    host.id = 'gptlock-context-warning-host';
    host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:2147483647;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{box-sizing:border-box;width:min(660px,calc(100vw - 32px));padding:14px 16px;border:1px solid #f59e0b;border-radius:14px;
          color:#78350f;background:#fffbeb;box-shadow:0 14px 40px rgba(120,53,15,.2);font:600 13px/1.5 system-ui,sans-serif}
        strong{display:block;margin-bottom:4px;color:#92400e;font-size:14px}.detail{font-weight:550}.learn{margin-top:6px;font-size:12px;font-weight:550;color:#92400e}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
        button{border:0;border-radius:9px;padding:8px 11px;font:700 12px/1 system-ui,sans-serif;cursor:pointer}.cancel{background:#fef3c7;color:#78350f}.send{background:#b45309;color:#fff}
      </style>
      <div class="card" role="alertdialog" aria-live="assertive">
        <strong>GPTLock 上下文预警：本次发送已拦截</strong>
        <div class="detail"></div>
        <div class="learn">如果你选择“仍然发送一次”，并且 ChatGPT 确实成功完成新答案，GPTLock 会把本次完整聊天长度记为该 ChatGPT 账户/模型的实测成功下限，并实时提高后续自适应发送预算。</div>
        <div class="actions"><button class="cancel" type="button">取消</button><button class="send" type="button">仍然发送一次</button></div>
      </div>`;
    const limitLabel = snapshot.adaptiveActive ? '当前账户自适应预算' : 'GPTLock 默认安全预算';
    root.querySelector('.detail').textContent = `当前完整聊天约 ${formatCompactTokens(snapshot.fullConversationTokens)} tokens（${formatCompactNumber(snapshot.fullConversationCharacters)} 字符），加入这条提示并预留回复后预计 ${snapshot.projectedPercent.toFixed(1)}%，将越过${limitLabel} ${formatCompactTokens(snapshot.safeLimitTokens)}。该计数为本地完整聊天估算，不是 ChatGPT 官方实时 token 计数。`;
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

  function extractStableAccountCandidate(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const direct = [
      ['account-id', payload.account?.id],
      ['account-id', payload.account_id],
      ['account-id', payload.accountId],
      ['user-id', payload.user?.id],
      ['user-id', payload.user_id],
      ['user-id', payload.userId],
      ['user-sub', payload.user?.sub],
      ['user-sub', payload.sub],
      ['user-id', payload.user?.auth0Id],
      ['email', payload.user?.email],
      ['email', payload.email],
    ];
    for (const [source, value] of direct) {
      const normalized = String(value ?? '').trim();
      if (normalized && normalized.length <= 512) return { source, value: normalized };
    }
    if (Array.isArray(payload.accounts)) {
      for (const account of payload.accounts) {
        const value = String(account?.id ?? account?.account_id ?? account?.accountId ?? '').trim();
        if (value && value.length <= 512) return { source: 'account-id', value };
      }
    }
    return null;
  }

  async function hashAccountCandidate(source, value) {
    const data = new TextEncoder().encode(`${source}:${value}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = [...new Uint8Array(digest)].slice(0, 16);
    return `acct-${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async function fetchAccountPayload(path) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ACCOUNT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, location.origin), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const contentType = String(response.headers.get('content-type') || '');
      if (!/json/i.test(contentType)) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function detectAccountScope() {
    for (const endpoint of ACCOUNT_ENDPOINTS) {
      const payload = await fetchAccountPayload(endpoint);
      const candidate = extractStableAccountCandidate(payload);
      if (!candidate) continue;
      try {
        return {
          scope: await hashAccountCandidate(candidate.source, candidate.value),
          source: candidate.source,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async function loadActiveProfile() {
    const sequence = ++profileLoadSequence;
    const model = detectModel();
    const key = profileStorageKey(currentAccountScope, model);
    lastLoadedProfileModel = model;
    if (!key) {
      activeProfile = null;
      activeProfileKey = null;
      scheduleRefresh();
      return null;
    }
    try {
      const stored = await chrome.storage.local.get(key);
      if (sequence !== profileLoadSequence) return null;
      const profile = stored[key] ?? null;
      if (
        profile
        && profile.accountScope === currentAccountScope
        && normalizeModelId(profile.model) === normalizeModelId(model)
      ) {
        activeProfile = profile;
        activeProfileKey = key;
      } else {
        activeProfile = null;
        activeProfileKey = key;
      }
    } catch {
      if (sequence !== profileLoadSequence) return null;
      activeProfile = null;
      activeProfileKey = key;
    }
    scheduleRefresh();
    return activeProfile;
  }

  async function persistHardLimitObservation(snapshot, notice) {
    if (!snapshot || !notice || hardLimitLearningInFlight) return null;
    const model = normalizeModelId(snapshot.model) || detectModel();
    const observedTokens = Math.max(
      Math.ceil(Number(snapshot.fullConversationTokens) || 0),
      Math.ceil(Number(snapshot.cumulativeConversationTokens) || 0),
    );
    const fingerprint = `${snapshot.conversationKey}:${model}:${snapshot.historyMeasurementSource}:${observedTokens}`;
    if (lastHardLimitFingerprint === fingerprint) return activeProfile;
    hardLimitLearningInFlight = true;
    try {
      if (!currentAccountScope) await refreshAccountScope(true);
      const key = profileStorageKey(currentAccountScope, model);
      if (!key) return null;
      const stored = await chrome.storage.local.get(key);
      const previous = stored[key] ?? null;
      const measurementReliable = ['conversation-tree+dom-reconcile', 'checkpoint+dom-restore'].includes(snapshot.historyMeasurementSource);
      const next = nextHardLimitProfile({
        previous,
        accountScope: currentAccountScope,
        accountScopeSource: currentAccountScopeSource || 'unknown',
        model,
        observedConversationTokens: observedTokens,
        observedCharacters: Math.max(snapshot.fullConversationCharacters || 0, snapshot.cumulativeConversationCharacters || 0),
        observedMessages: Math.max(snapshot.messageCount || 0, snapshot.cumulativeMessageCount || 0),
        conversationKey: snapshot.conversationKey,
        measuredAt: new Date().toISOString(),
        measurementSource: snapshot.historyMeasurementSource,
        measurementReliable,
        noticeText: notice.text,
        actionText: notice.actionText,
      });
      if (!next) return null;
      await chrome.storage.local.set({ [key]: next });
      activeProfile = next;
      activeProfileKey = key;
      lastLoadedProfileModel = model;
      lastHardLimitFingerprint = fingerprint;
      await discardPendingBypass();
      window.dispatchEvent(new CustomEvent('gptlock:context-hard-limit-learned', {
        detail: {
          model,
          conversationKey: snapshot.conversationKey,
          hardLimitUpperBoundTokens: next.hardLimitUpperBoundTokens || 0,
          observedConversationTokens: observedTokens,
          confidence: next.hardLimitConfidence,
          measurementSource: snapshot.historyMeasurementSource,
        },
      }));
      showHardLimitToast(next);
      scheduleRefresh();
      return next;
    } catch {
      return null;
    } finally {
      hardLimitLearningInFlight = false;
    }
  }

  async function refreshAccountScope(force = false) {
    const now = Date.now();
    if (!force && now - accountScopeCheckedAt < ACCOUNT_SCOPE_REFRESH_MS) return currentAccountScope;
    if (accountScopePromise) return accountScopePromise;
    accountScopePromise = (async () => {
      const detected = await detectAccountScope();
      accountScopeCheckedAt = Date.now();
      const nextScope = detected?.scope ?? null;
      const nextSource = detected?.source ?? null;
      const changed = nextScope !== currentAccountScope || nextSource !== currentAccountScopeSource;
      currentAccountScope = nextScope;
      currentAccountScopeSource = nextSource;
      if (changed) {
        await loadActiveProfile();
        await loadConversationCheckpoint();
        await restorePendingBypass();
      }
      return currentAccountScope;
    })().finally(() => {
      accountScopePromise = null;
    });
    return accountScopePromise;
  }

  function bindPendingToGuardState(state) {
    if (!pendingBypass) return;
    const age = Date.now() - pendingBypass.startedAt;
    if (age > BYPASS_OBSERVATION_TIMEOUT_MS) {
      pendingBypass = null;
      return;
    }
    if (pendingBypass.conversationKey !== currentConversationKey()) {
      pendingBypass = null;
      return;
    }

    const request = state?.lastRequest;
    if (request?.requestId) {
      const capturedAt = Date.parse(request.capturedAt || '') || 0;
      if (capturedAt >= pendingBypass.startedAt - 1_500) {
        if (!pendingBypass.requestId || pendingBypass.requestId === request.requestId) {
          pendingBypass.requestId = request.requestId;
          pendingBypass.requestObserved = true;
          pendingBypass.model = normalizeModelId(request.model) || pendingBypass.model;
        }
      }
    }

    if (!pendingBypass.requestObserved) return;
    void persistPendingBypassState();
    if (state?.phase === 'error' && state?.lastError) {
      pendingBypass.responseSeen = true;
      pendingBypass.responseSuccessful = false;
      void persistPendingBypassState();
      return;
    }
    if (state?.lastEvidenceDiagnostics) {
      const status = Number(state.lastEvidenceDiagnostics.httpStatus);
      pendingBypass.responseSeen = true;
      pendingBypass.responseSuccessful = !Number.isFinite(status) || status === 0 || (status >= 200 && status < 400);
      void persistPendingBypassState();
    }
  }

  function responseCanBeConsideredSuccessful() {
    if (!pendingBypass?.requestObserved) return false;
    if (pendingBypass.responseSuccessful === false) return false;
    if (pendingBypass.responseSuccessful === true) return true;
    if (lastGuardState?.phase === 'waiting' || lastGuardState?.phase === 'error') return false;
    return true;
  }

  async function persistLearnedProfile(postSnapshot) {
    if (!pendingBypass || pendingBypass.learningStarted) return null;
    pendingBypass.learningStarted = true;
    const accountScope = pendingBypass.accountScope || currentAccountScope;
    const accountScopeSource = pendingBypass.accountScopeSource || currentAccountScopeSource || 'unknown';
    const model = normalizeModelId(pendingBypass.model) || normalizeModelId(postSnapshot.model);
    const key = profileStorageKey(accountScope, model);
    if (!key) {
      await discardPendingBypass();
      return null;
    }
    // A successful answer proves the input accepted at send time, not the answer-inclusive post state.
    const confirmedConversationTokens = Math.ceil(pendingBypass.preSnapshot?.usedTokens || 0);
    const windowProfile = contextWindowForModel(model);
    const baseSafeLimitTokens = Math.floor(windowProfile.tokens * SAFETY_BUDGET_RATIO);
    try {
      const stored = await chrome.storage.local.get(key);
      const previous = stored[key] ?? null;
      const next = nextLearnedProfile({
        previous,
        accountScope,
        accountScopeSource,
        model,
        confirmedConversationTokens,
        confirmedCharacters: pendingBypass.preSnapshot?.fullConversationCharacters || 0,
        conversationKey: postSnapshot.conversationKey,
        measuredAt: new Date().toISOString(),
        baseSafeLimitTokens,
      });
      if (!next) {
        await discardPendingBypass();
        return null;
      }
      await chrome.storage.local.set({ [key]: next });
      activeProfile = next;
      activeProfileKey = key;
      lastLoadedProfileModel = model;
      const detail = {
        model,
        confirmedConversationTokens: next.confirmedConversationTokens,
        adaptiveSafeLimitTokens: next.adaptiveSafeLimitTokens,
        successfulBypassCount: next.successfulBypassCount,
      };
      await discardPendingBypass();
      window.dispatchEvent(new CustomEvent('gptlock:context-limit-learned', { detail }));
      showLearningToast(next);
      recompute();
      return next;
    } catch {
      await discardPendingBypass();
      return null;
    }
  }

  async function maybeFinalizeBypassLearning() {
    const pending = pendingBypass;
    if (!pending || pending.learningStarted) return;
    if (Date.now() - pending.startedAt > BYPASS_OBSERVATION_TIMEOUT_MS) {
      await discardPendingBypass();
      return;
    }
    if (pending.conversationKey !== currentConversationKey()) {
      pendingBypass = null;
      return;
    }
    if (!pending.requestObserved) return;
    if (pending.responseSuccessful === false) {
      await discardPendingBypass();
      return;
    }
    if (isGenerating()) {
      pending.stableSignature = null;
      pending.stableSince = 0;
      return;
    }
    if (hasVisibleGenerationError()) {
      await discardPendingBypass();
      return;
    }
    const assistant = assistantStats();
    if (assistant.count <= pending.baselineAssistantCount || assistant.lastTokens <= 0) return;
    const signature = `${assistant.count}:${assistant.lastTokens}:${assistant.lastCharacters}`;
    if (signature !== pending.stableSignature) {
      pending.stableSignature = signature;
      pending.stableSince = Date.now();
      return;
    }
    if (Date.now() - pending.stableSince < RESPONSE_SETTLE_MS) return;
    if (!responseCanBeConsideredSuccessful()) return;

    if (!pending.accountScope) {
      await refreshAccountScope(true);
      if (!pendingBypass) return;
      pending.accountScope = currentAccountScope;
      pending.accountScopeSource = currentAccountScopeSource;
    }
    if (!pending.accountScope) return;

    await refreshConversationMetrics(true);
    recomputeSnapshotOnly();
    const postSnapshot = lastSnapshot;
    if (!postSnapshot) return;
    await persistLearnedProfile(postSnapshot);
  }

  function recomputeSnapshotOnly() {
    try {
      publishSnapshot(snapshotNow());
    } catch {
      // Ignore a transient DOM replacement.
    }
  }

  function showLearningToast(profile) {
    const existing = document.getElementById('gptlock-context-learning-toast');
    existing?.remove();
    const host = document.createElement('div');
    host.id = 'gptlock-context-learning-toast';
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:86px;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .toast{max-width:420px;padding:11px 13px;border-radius:12px;background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;
          box-shadow:0 12px 30px rgba(6,95,70,.16);font:650 12px/1.45 system-ui,sans-serif}
      </style>
      <div class="toast"></div>`;
    root.querySelector('.toast').textContent = `GPTLock 已学习本次成功超限聊天：${profile.model} 实测成功下限约 ${formatCompactTokens(profile.confirmedConversationTokens)}，该账户后续自适应发送预算已提高到约 ${formatCompactTokens(profile.adaptiveSafeLimitTokens)} tokens。`;
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 6_000);
  }

  function showHardLimitToast(profile) {
    const existing = document.getElementById('gptlock-context-hard-limit-toast');
    existing?.remove();
    const host = document.createElement('div');
    host.id = 'gptlock-context-hard-limit-toast';
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:86px;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>.toast{max-width:460px;padding:11px 13px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;box-shadow:0 12px 30px rgba(154,52,18,.14);font:650 12px/1.45 system-ui,sans-serif}</style>
      <div class="toast"></div>`;
    const upper = clampAdaptiveLimit(profile?.hardLimitUpperBoundTokens);
    root.querySelector('.toast').textContent = upper
      ? `GPTLock 已捕获 ChatGPT 真实“对话长度上限”提示，并记录该账户/模型的实测上界 ≤ ${formatCompactTokens(upper)} tokens。后续发送预算会同时受成功下限与该上界约束。`
      : 'GPTLock 已捕获 ChatGPT 真实“对话长度上限”提示。当前会话历史只能从 DOM 回退估算，数据不完整，因此不会把这个不完整 token 数误写成最大上限；事件已记录，后续会继续对账。';
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 7_000);
  }

  document.addEventListener('click', handlePotentialSend, true);
  document.addEventListener('keydown', handlePotentialSend, true);
  document.addEventListener('submit', handlePotentialSend, true);
  document.addEventListener('input', scheduleRefresh, true);

  chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'GPTLOCK_GUARD_STATE') return false;
    const state = message.state;
    lastGuardState = state ?? null;
    const previousModel = detectModel();
    lastKnownModel = normalizeModelId(
      state?.lastVerification?.model
      || state?.lastRequest?.model
      || state?.pageObservation?.model
      || lastKnownModel,
    );
    bindPendingToGuardState(state);
    const nextModel = detectModel();
    if (normalizeModelId(previousModel) !== normalizeModelId(nextModel) || normalizeModelId(lastLoadedProfileModel) !== normalizeModelId(nextModel)) {
      void loadActiveProfile();
      void loadConversationCheckpoint();
      void restorePendingBypass();
    }
    if (!currentAccountScope) void refreshAccountScope();
    scheduleRefresh();
    void maybeFinalizeBypassLearning();
    return false;
  });

  chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== 'local' || !activeProfileKey || !changes[activeProfileKey]) return;
    const profile = changes[activeProfileKey].newValue ?? null;
    if (
      profile
      && profile.accountScope === currentAccountScope
      && normalizeModelId(profile.model) === normalizeModelId(detectModel())
    ) {
      activeProfile = profile;
    } else {
      activeProfile = null;
    }
    scheduleRefresh();
  });

  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  function handleConversationNavigation() {
    // Detach only. The old conversation's pending record remains recoverable until its TTL expires.
    pendingBypass = null;
    restoredPendingKey = null;
    restoredCheckpoint = null;
    restoredCheckpointKey = null;
    conversationMetricsCache = null;
    conversationMetricsCheckedAt = 0;
    lastHardLimitNotice = null;
    lastHardLimitFingerprint = null;
    scheduleRefresh();
    void refreshAccountScope(true).then(() => {
      void loadConversationCheckpoint();
      void restorePendingBypass();
    });
    void refreshConversationMetrics(true);
  }
  window.addEventListener('popstate', handleConversationNavigation);
  window.addEventListener('hashchange', handleConversationNavigation);
  window.addEventListener('resize', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshAccountScope(true);
      void refreshConversationMetrics(true);
    }
  });
  window.setInterval(recompute, PERIODIC_REFRESH_MS);
  void refreshAccountScope(true).then(() => {
    void loadConversationCheckpoint();
    void restorePendingBypass();
  });
  void refreshConversationMetrics(true);
  recompute();
})();