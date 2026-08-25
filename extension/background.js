import {
  DEFAULT_POLICY,
  DEFAULT_SETTINGS,
  normalizePolicy,
  normalizeSettings,
} from './policy.js';
import { ChatGptNetworkMonitor } from './network-monitor.js';
import { evaluateGuard } from './guard.js';
import { classifyNativeError } from './native-status.js';
import {
  appendRuntimeLog,
  clearRuntimeLogs,
  getRuntimeLogs,
  sanitizeLogValue,
} from './runtime-log.js';

const NATIVE_HOST = 'com.gptlock.core';
const RECONNECT_ALARM = 'gptlock-native-reconnect';
const REQUEST_TIMEOUT_MS = 7000;

let nativePort = null;
let requestSequence = 0;
let currentPolicy = DEFAULT_POLICY;
let currentSettings = DEFAULT_SETTINGS;
let coreConnection = { connected: false, error: null };
const pendingRequests = new Map();
const tabStates = new Map();

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function logRuntime(level, component, event, details = {}) {
  void appendRuntimeLog(level, component, event, details).catch(() => {});
}

function isChatGptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch {
    return false;
  }
}

function contextKey(value) {
  try {
    const url = new URL(value);
    const conversation = url.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)/);
    return conversation ? `conversation:${conversation[1]}` : `page:${url.pathname}`;
  } catch {
    return 'unknown';
  }
}

function createTabState(tabId, url = '') {
  return {
    tabId,
    url,
    contextKey: contextKey(url),
    core: coreConnection,
    monitor: { attached: false, error: null },
    phase: 'initial',
    probeUsed: false,
    probeArmed: false,
    pageObservation: null,
    lastRequest: null,
    lastVerification: null,
    lastEvidenceDiagnostics: null,
    evidenceIssue: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

function ensureTabState(tabId, url = '') {
  let state = tabStates.get(tabId);
  if (!state) {
    state = createTabState(tabId, url);
    tabStates.set(tabId, state);
  } else if (url && state.contextKey !== contextKey(url)) {
    const monitor = state.monitor;
    state = createTabState(tabId, url);
    state.monitor = monitor;
    tabStates.set(tabId, state);
  } else if (url) {
    state.url = url;
  }
  return state;
}

function guardFor(state) {
  return evaluateGuard({
    state,
    policy: currentPolicy,
    settings: currentSettings,
    inScope: isChatGptUrl(state.url),
  });
}

function publicTabState(state) {
  if (!state) return null;
  return {
    contextKey: state.contextKey,
    core: state.core,
    monitor: state.monitor,
    phase: state.phase,
    probeUsed: state.probeUsed,
    probeArmed: state.probeArmed,
    pageObservation: state.pageObservation,
    lastRequest: state.lastRequest,
    lastVerification: state.lastVerification,
    lastEvidenceDiagnostics: state.lastEvidenceDiagnostics,
    evidenceIssue: state.evidenceIssue,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    guard: guardFor(state),
  };
}

async function updateTabBadge(state) {
  const guard = guardFor(state);
  let text = '?';
  let color = '#b45309';
  if (guard.status === 'verified') {
    text = 'OK';
    color = '#15803d';
  } else if (guard.status === 'mismatch' || guard.status === 'preflight_mismatch') {
    text = '!';
    color = '#b91c1c';
  } else if (guard.status === 'waiting') {
    text = '…';
  } else if (guard.status === 'probe_ready') {
    text = '1';
    color = '#2563eb';
  } else if (['disabled', 'monitor_offline', 'monitor_disabled', 'core_offline'].includes(guard.status)) {
    text = 'OFF';
    color = '#64748b';
  }
  try {
    await chrome.action.setBadgeText({ tabId: state.tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId: state.tabId, color });
  } catch {
    // The tab may have closed between the event and the badge update.
  }
}

async function broadcastTabState(tabId) {
  const state = tabStates.get(tabId);
  if (!state) return;
  state.updatedAt = new Date().toISOString();
  await updateTabBadge(state);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'GPTLOCK_GUARD_STATE',
      state: publicTabState(state),
      policy: currentPolicy,
      settings: currentSettings,
    });
  } catch {
    // A content script may not exist yet while a tab is loading.
  }
}

async function ensureConfiguration() {
  const stored = await chrome.storage.sync.get(['policy', 'settings']);
  currentPolicy = normalizePolicy(stored.policy ?? DEFAULT_POLICY);
  currentSettings = normalizeSettings(stored.settings ?? DEFAULT_SETTINGS);
  const patch = {};
  if (!stored.policy || JSON.stringify(stored.policy) !== JSON.stringify(currentPolicy)) patch.policy = currentPolicy;
  if (!stored.settings || JSON.stringify(stored.settings) !== JSON.stringify(currentSettings)) patch.settings = currentSettings;
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  return { policy: currentPolicy, settings: currentSettings };
}

async function writeNativeStatus(patch) {
  const { nativeStatus = {} } = await chrome.storage.local.get('nativeStatus');
  const next = {
    connected: false,
    lastError: null,
    lastSeenAt: null,
    lastVerification: null,
    ...nativeStatus,
    ...patch,
  };
  if (Object.hasOwn(patch, 'lastError')) {
    next.errorCode = classifyNativeError(patch.lastError);
  }
  await chrome.storage.local.set({ nativeStatus: next });
  if (
    nativeStatus.connected !== next.connected
    || nativeStatus.lastError !== next.lastError
    || nativeStatus.version !== next.version
  ) {
    logRuntime(next.connected ? 'info' : 'warn', 'native', 'status_changed', {
      connected: next.connected,
      version: next.version ?? null,
      errorCode: next.errorCode ?? null,
      lastError: next.lastError ?? null,
    });
  }
  coreConnection = { connected: Boolean(next.connected), error: next.lastError ?? null };
  for (const state of tabStates.values()) {
    state.core = coreConnection;
    void broadcastTabState(state.tabId);
  }
  return next;
}

function scheduleReconnect() {
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.5 });
}

function rejectPending(error) {
  for (const { reject, timer, type } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(error);
    logRuntime('warn', 'native', 'request_rejected', { type, error: errorText(error) });
  }
  pendingRequests.clear();
}

function connectNative() {
  if (nativePort) return nativePort;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener((message) => {
      const pending = pendingRequests.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRequests.delete(String(message.id));
      if (message.ok) {
        pending.resolve(message.data);
      } else {
        const error = new Error(message.error?.messageZhCn || message.error?.messageEn || 'Native request failed');
        logRuntime('error', 'native', 'request_failed', {
          type: pending.type,
          code: message.error?.code ?? null,
          error: error.message,
        });
        pending.reject(error);
      }
    });
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      const detail = chrome.runtime.lastError?.message || 'Native host disconnected';
      nativePort = null;
      rejectPending(new Error(detail));
      void writeNativeStatus({ connected: false, lastError: detail });
      scheduleReconnect();
      logRuntime('warn', 'native', 'disconnected', { error: detail });
    });
    void writeNativeStatus({ connected: true, lastError: null, lastSeenAt: new Date().toISOString() });
    return port;
  } catch (error) {
    const detail = errorText(error);
    void writeNativeStatus({ connected: false, lastError: detail });
    scheduleReconnect();
    logRuntime('error', 'native', 'connect_failed', { error: detail });
    throw error;
  }
}

function sendNative(type, payload = {}) {
  const port = connectNative();
  const id = `${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      const error = new Error(`Native request timed out: ${type}`);
      logRuntime('error', 'native', 'request_timeout', { type, timeoutMs: REQUEST_TIMEOUT_MS });
      reject(error);
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer, type });
    try {
      port.postMessage({ id, type, ...payload });
    } catch (error) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      logRuntime('error', 'native', 'post_message_failed', { type, error: errorText(error) });
      reject(error);
    }
  });
}

async function syncPolicy() {
  const result = await sendNative('set_policy', { policy: currentPolicy });
  await writeNativeStatus({
    connected: true,
    lastError: null,
    lastSeenAt: new Date().toISOString(),
    policyRevision: result.revision,
  });
  return result;
}

async function verifyObservation(observation) {
  const result = await sendNative('verify', {
    observation: {
      model: observation.model ?? null,
      reasoning: observation.reasoning ?? null,
      evidenceSource: observation.evidenceSource,
      capturedAt: observation.capturedAt ?? new Date().toISOString(),
      requestId: observation.requestId || `extension-${Date.now()}-${++requestSequence}`,
    },
  });
  await writeNativeStatus({
    connected: true,
    lastError: null,
    lastSeenAt: new Date().toISOString(),
    lastVerification: result,
    policyRevision: result.policyRevision,
  });
  return result;
}

function diagnoseEvidenceIssue(evidence, result) {
  if (evidence.bodyError) return 'response_body_read_failed';
  if (evidence.conflicts?.model || evidence.conflicts?.reasoning) return 'response_metadata_conflict';
  const format = evidence.diagnostics?.bodyFormat;
  if (format === 'empty') return 'response_body_empty';
  if (format === 'too_large') return 'response_body_too_large';
  if (format === 'unparsed') return 'response_body_unparseable';
  if (result.reason === 'model_missing') return 'response_model_not_exposed';
  if (result.reason === 'reasoning_missing') return 'response_reasoning_not_exposed';
  return result.verdict === 'verified' ? null : 'response_metadata_incomplete';
}

async function applyNetworkEvidence(tabId, evidence) {
  const state = ensureTabState(tabId);
  state.lastEvidenceDiagnostics = evidence.diagnostics ?? null;
  try {
    const result = await verifyObservation({
      model: evidence.conflicts?.model ? null : evidence.model,
      reasoning: evidence.conflicts?.reasoning ? null : evidence.reasoning,
      evidenceSource: 'network_response_metadata',
      capturedAt: evidence.capturedAt,
      requestId: `cdp-${tabId}-${evidence.requestId}`,
    });
    state.lastVerification = result;
    state.evidenceIssue = diagnoseEvidenceIssue(evidence, result);
    state.lastError = evidence.bodyError || (evidence.conflicts?.model || evidence.conflicts?.reasoning
      ? 'conflicting_response_metadata'
      : null);
    state.phase = result.verdict;
    logRuntime(result.verdict === 'verified' ? 'info' : 'warn', 'verification', 'response_evaluated', {
      tabId,
      verdict: result.verdict,
      decision: result.decision,
      reason: result.reason,
      reasons: result.reasons,
      model: result.model,
      reasoning: result.reasoning,
      evidenceSource: result.evidenceSource,
      evidenceIssue: state.evidenceIssue,
      diagnostics: evidence.diagnostics ?? null,
    });
  } catch (error) {
    state.phase = 'error';
    state.evidenceIssue = 'verification_request_failed';
    state.lastError = errorText(error);
    logRuntime('error', 'verification', 'response_evaluation_failed', {
      tabId,
      error: state.lastError,
      diagnostics: evidence.diagnostics ?? null,
    });
  }
  await broadcastTabState(tabId);
}

const networkMonitor = new ChatGptNetworkMonitor({
  onStatus(tabId, monitor) {
    const state = ensureTabState(tabId);
    state.monitor = monitor;
    if (!monitor.attached && state.phase !== 'initial') {
      state.phase = 'error';
      state.lastError = monitor.error || 'network_monitor_detached';
    }
    logRuntime(monitor.attached ? 'info' : 'warn', 'network', 'monitor_status', {
      tabId,
      attached: monitor.attached,
      error: monitor.error,
    });
    void broadcastTabState(tabId);
  },
  onRequest(tabId, request) {
    const state = ensureTabState(tabId);
    state.lastRequest = {
      requestId: request.requestId,
      capturedAt: request.capturedAt,
      model: request.model,
      reasoning: request.reasoning,
      diagnostics: request.diagnostics ?? null,
    };
    state.probeUsed = true;
    state.probeArmed = false;
    state.phase = 'waiting';
    state.lastError = request.conflicts?.model || request.conflicts?.reasoning
      ? 'conflicting_request_metadata'
      : null;
    state.evidenceIssue = null;
    state.lastEvidenceDiagnostics = null;
    logRuntime('info', 'network', 'conversation_request_detected', {
      tabId,
      model: request.model,
      reasoning: request.reasoning,
      conflicts: request.conflicts,
      fields: request.fields,
      diagnostics: request.diagnostics,
    });
    void broadcastTabState(tabId);
  },
  onEvidence(tabId, evidence) {
    void applyNetworkEvidence(tabId, evidence);
  },
  onFailure(tabId, failure) {
    logRuntime('error', 'network', 'response_loading_failed', {
      tabId,
      endpoint: failure.endpoint,
      httpStatus: failure.httpStatus,
      canceled: failure.canceled,
      error: failure.error,
    });
    void applyNetworkEvidence(tabId, {
      requestId: failure.requestId,
      capturedAt: new Date().toISOString(),
      model: null,
      reasoning: null,
      conflicts: { model: false, reasoning: false },
      bodyError: failure.error,
      diagnostics: {
        endpoint: failure.endpoint,
        httpStatus: failure.httpStatus,
        bodyLength: 0,
        bodyFormat: 'empty',
        parsedObjectCount: 0,
      },
    });
  },
});

async function configureTab(tab) {
  if (!tab?.id || !isChatGptUrl(tab.url ?? '')) return;
  const state = ensureTabState(tab.id, tab.url);
  if (currentSettings.enabled && currentSettings.networkVerificationEnabled) await networkMonitor.attach(tab.id);
  else await networkMonitor.detach(tab.id);
  await broadcastTabState(tab.id);
  return state;
}

async function configureOpenTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  await Promise.all(tabs.map((tab) => configureTab(tab)));
}

async function initialize() {
  logRuntime('info', 'extension', 'initialize_started', {
    version: chrome.runtime.getManifest().version,
  });
  await ensureConfiguration();
  try {
    await sendNative('ping');
    await syncPolicy();
    const status = await sendNative('get_status');
    await writeNativeStatus({
      connected: true,
      lastError: null,
      lastSeenAt: new Date().toISOString(),
      lastVerification: status.lastVerification ?? null,
      policyRevision: status.policyRevision,
      version: status.version,
    });
  } catch (error) {
    const detail = errorText(error);
    await writeNativeStatus({ connected: false, lastError: detail });
  }
  await configureOpenTabs();
  logRuntime('info', 'extension', 'initialize_completed', {
    enabled: currentSettings.enabled,
    networkVerificationEnabled: currentSettings.networkVerificationEnabled,
    coreConnected: coreConnection.connected,
  });
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function chatGptTabId(preferred = null) {
  if (Number.isInteger(preferred)) {
    const tab = await chrome.tabs.get(preferred);
    if (isChatGptUrl(tab.url ?? '')) return preferred;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isChatGptUrl(active.url ?? '')) return active.id;
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  tabs.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return tabs[0]?.id ?? null;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function getPlatformInfo() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => resolve(info ?? {}));
  });
}

async function autoVerify(tabId) {
  if (!currentSettings.enabled) throw new Error('GPTLock is disabled / GPTLock 已关闭');
  const tab = await chrome.tabs.get(tabId);
  if (!isChatGptUrl(tab.url ?? '')) throw new Error('Open chatgpt.com first / 请先打开 chatgpt.com');
  const state = ensureTabState(tabId, tab.url);
  logRuntime('info', 'verification', 'auto_verify_started', { tabId });

  await sendNative('ping');
  await syncPolicy();
  const coreStatus = await sendNative('get_status');
  await writeNativeStatus({
    connected: true,
    lastError: null,
    lastSeenAt: new Date().toISOString(),
    policyRevision: coreStatus.policyRevision,
    version: coreStatus.version,
  });

  const monitorAttached = currentSettings.networkVerificationEnabled
    ? await networkMonitor.attach(tabId)
    : false;
  let pageCollected = false;
  let pageCollectionError = null;
  try {
    const response = await sendTabMessage(tabId, { type: 'GPTLOCK_COLLECT_PAGE_STATE' });
    if (response?.observation) {
      state.pageObservation = {
        model: response.observation.model ?? null,
        reasoning: response.observation.reasoning ?? null,
        capturedAt: response.observation.capturedAt ?? new Date().toISOString(),
        evidenceSource: 'page_dom',
      };
      pageCollected = true;
    }
  } catch (error) {
    pageCollectionError = errorText(error);
  }

  state.phase = 'initial';
  state.probeUsed = false;
  state.probeArmed = monitorAttached;
  state.lastRequest = null;
  state.lastVerification = null;
  state.lastEvidenceDiagnostics = null;
  state.evidenceIssue = null;
  state.lastError = pageCollectionError;
  await broadcastTabState(tabId);
  const guard = guardFor(state);
  logRuntime(guard.canSend ? 'info' : 'warn', 'verification', 'auto_verify_prepared', {
    tabId,
    coreConnected: coreConnection.connected,
    monitorAttached,
    pageCollected,
    pageCollectionError,
    pageModel: state.pageObservation?.model ?? null,
    pageReasoning: state.pageObservation?.reasoning ?? null,
    guardStatus: guard.status,
    guardReason: guard.reason,
    ready: guard.allowKind === 'probe',
  });
  return {
    ready: guard.allowKind === 'probe',
    checks: {
      coreConnected: coreConnection.connected,
      monitorAttached,
      pageCollected,
      pageCollectionError,
    },
    tabState: publicTabState(state),
  };
}

function diagnosticTabState(state) {
  return {
    tabId: state.tabId,
    inScope: isChatGptUrl(state.url),
    core: state.core,
    monitor: state.monitor,
    phase: state.phase,
    probeUsed: state.probeUsed,
    probeArmed: state.probeArmed,
    pageObservation: state.pageObservation,
    lastRequest: state.lastRequest ? {
      capturedAt: state.lastRequest.capturedAt,
      model: state.lastRequest.model,
      reasoning: state.lastRequest.reasoning,
      diagnostics: state.lastRequest.diagnostics,
    } : null,
    lastVerification: state.lastVerification,
    lastEvidenceDiagnostics: state.lastEvidenceDiagnostics,
    evidenceIssue: state.evidenceIssue,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    guard: guardFor(state),
  };
}

async function createDiagnosticBundle() {
  const [stored, runtimeLogs, platform] = await Promise.all([
    chrome.storage.local.get('nativeStatus'),
    getRuntimeLogs(),
    getPlatformInfo(),
  ]);
  let nativeDiagnostics = null;
  let nativeDiagnosticsError = null;
  try {
    nativeDiagnostics = await sendNative('get_diagnostics', { auditLimit: 300 });
  } catch (error) {
    nativeDiagnosticsError = errorText(error);
  }
  return sanitizeLogValue({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: {
      chatContentIncluded: false,
      credentialsIncluded: false,
      noteZhCn: '诊断包不包含提示词、回答正文、Cookie、授权头或令牌。',
      noteEn: 'The bundle excludes prompts, answer bodies, cookies, authorization headers, and tokens.',
    },
    extension: {
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      platform,
      userAgent: navigator.userAgent,
    },
    policy: currentPolicy,
    settings: currentSettings,
    nativeStatus: stored.nativeStatus ?? { connected: false },
    tabs: [...tabStates.values()].map(diagnosticTabState),
    runtimeLogs,
    nativeDiagnostics,
    nativeDiagnosticsError,
  });
}

chrome.runtime.onInstalled.addListener(() => void initialize());
chrome.runtime.onStartup.addListener(() => void initialize());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void initialize();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !isChatGptUrl(changeInfo.url)) {
    tabStates.delete(tabId);
    if (networkMonitor.isAttached(tabId)) void networkMonitor.detach(tabId);
    return;
  }
  if (isChatGptUrl(tab.url ?? '') && (changeInfo.url || changeInfo.status === 'complete')) {
    void configureTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  if (networkMonitor.isAttached(tabId)) void networkMonitor.detach(tabId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (changes.policy) currentPolicy = normalizePolicy(changes.policy.newValue);
  if (changes.settings) currentSettings = normalizeSettings(changes.settings.newValue);
  if (changes.policy) {
    void syncPolicy().catch(async (error) => {
      await writeNativeStatus({ connected: false, lastError: errorText(error) });
    });
  }
  if (changes.policy || changes.settings) {
    logRuntime('info', 'settings', 'configuration_changed', {
      policyChanged: Boolean(changes.policy),
      settingsChanged: Boolean(changes.settings),
      enabled: currentSettings.enabled,
      networkVerificationEnabled: currentSettings.networkVerificationEnabled,
      strictMode: currentPolicy.strictMode,
    });
    for (const state of tabStates.values()) {
      state.phase = 'initial';
      state.probeUsed = false;
      state.probeArmed = false;
      state.lastVerification = null;
      state.lastEvidenceDiagnostics = null;
      state.evidenceIssue = null;
      state.lastError = null;
      void broadcastTabState(state.tabId);
    }
    void configureOpenTabs();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;

  const run = async () => {
    switch (message.type) {
      case 'GPTLOCK_GET_STATE': {
        const tabId = Number.isInteger(message.tabId)
          ? message.tabId
          : sender.tab?.id ?? await activeTabId();
        const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
        return {
          policy: currentPolicy,
          settings: currentSettings,
          nativeStatus: nativeStatus ?? { connected: false },
          tabState: tabId === null ? null : publicTabState(tabStates.get(tabId)),
          extensionVersion: chrome.runtime.getManifest().version,
        };
      }
      case 'GPTLOCK_RECONNECT': {
        const previousPort = nativePort;
        nativePort = null;
        rejectPending(new Error('Native host reconnect requested'));
        previousPort?.disconnect();
        await initialize();
        logRuntime('info', 'native', 'manual_reconnect_completed');
        return { ok: true };
      }
      case 'GPTLOCK_SET_ENABLED': {
        currentSettings = normalizeSettings({
          ...currentSettings,
          enabled: Boolean(message.enabled),
        });
        await chrome.storage.sync.set({ settings: currentSettings });
        logRuntime('info', 'settings', 'global_enabled_changed', {
          enabled: currentSettings.enabled,
        });
        await configureOpenTabs();
        return { settings: currentSettings };
      }
      case 'GPTLOCK_PAGE_OBSERVATION': {
        if (!sender.tab?.id) throw new Error('Page observation requires a tab');
        const state = ensureTabState(sender.tab.id, sender.tab.url);
        const previous = state.pageObservation;
        state.pageObservation = {
          model: message.observation?.model ?? null,
          reasoning: message.observation?.reasoning ?? null,
          capturedAt: message.observation?.capturedAt ?? new Date().toISOString(),
          evidenceSource: 'page_dom',
        };
        if (
          previous?.model && previous?.reasoning
          && state.pageObservation.model && state.pageObservation.reasoning
          && (previous.model !== state.pageObservation.model || previous.reasoning !== state.pageObservation.reasoning)
        ) {
          state.phase = 'initial';
          state.probeUsed = false;
          state.probeArmed = false;
          state.lastVerification = null;
          state.lastEvidenceDiagnostics = null;
          state.evidenceIssue = null;
          logRuntime('info', 'page', 'selection_changed', {
            tabId: sender.tab.id,
            previousModel: previous.model,
            previousReasoning: previous.reasoning,
            model: state.pageObservation.model,
            reasoning: state.pageObservation.reasoning,
          });
        }
        await broadcastTabState(sender.tab.id);
        return publicTabState(state);
      }
      case 'GPTLOCK_CONTEXT_CHANGED': {
        if (!sender.tab?.id) throw new Error('Context update requires a tab');
        const state = ensureTabState(sender.tab.id, message.url || sender.tab.url);
        await broadcastTabState(sender.tab.id);
        return publicTabState(state);
      }
      case 'GPTLOCK_SEND_STARTED': {
        if (!sender.tab?.id) throw new Error('Send event requires a tab');
        const state = ensureTabState(sender.tab.id, sender.tab.url);
        const guard = guardFor(state);
        if (!guard.canSend) {
          logRuntime('warn', 'guard', 'send_rejected', {
            tabId: sender.tab.id,
            status: guard.status,
            reason: guard.reason,
          });
          return { accepted: false, guard };
        }
        if (guard.allowKind === 'disabled' || guard.allowKind === 'outside_scope') {
          return { accepted: true, guard };
        }
        state.phase = 'waiting';
        state.probeUsed = state.probeUsed || guard.allowKind === 'probe';
        state.probeArmed = false;
        state.lastError = null;
        state.evidenceIssue = null;
        logRuntime('info', 'guard', 'send_accepted', {
          tabId: sender.tab.id,
          allowKind: guard.allowKind,
          status: guard.status,
        });
        await broadcastTabState(sender.tab.id);
        return { accepted: true, guard: guardFor(state) };
      }
      case 'GPTLOCK_ARM_PROBE': {
        const tabId = Number.isInteger(message.tabId) ? message.tabId : await activeTabId();
        if (tabId === null) throw new Error('No active tab');
        const state = ensureTabState(tabId);
        state.phase = 'initial';
        state.probeArmed = true;
        state.lastError = null;
        state.evidenceIssue = null;
        logRuntime('info', 'verification', 'manual_probe_armed', { tabId });
        await broadcastTabState(tabId);
        return publicTabState(state);
      }
      case 'GPTLOCK_AUTO_VERIFY': {
        const tabId = await chatGptTabId(Number.isInteger(message.tabId) ? message.tabId : null);
        if (tabId === null) throw new Error('No ChatGPT tab / 没有打开的 ChatGPT 标签页');
        return autoVerify(tabId);
      }
      case 'GPTLOCK_SEND_BLOCKED': {
        logRuntime('warn', 'guard', 'send_blocked_in_page', {
          tabId: sender.tab?.id ?? null,
          status: message.status ?? null,
          reason: message.reason ?? null,
        });
        return { recorded: true };
      }
      case 'GPTLOCK_VERIFY':
        return verifyObservation(message.observation ?? {});
      case 'GPTLOCK_GET_RUNTIME_LOGS':
        return { logs: await getRuntimeLogs() };
      case 'GPTLOCK_CLEAR_RUNTIME_LOGS':
        await clearRuntimeLogs();
        logRuntime('info', 'diagnostics', 'runtime_logs_cleared');
        return { cleared: true };
      case 'GPTLOCK_EXPORT_DIAGNOSTICS': {
        const bundle = await createDiagnosticBundle();
        logRuntime('info', 'diagnostics', 'bundle_created', {
          runtimeLogCount: bundle.runtimeLogs?.length ?? 0,
          nativeAuditCount: bundle.nativeDiagnostics?.auditRecords?.length ?? 0,
          nativeDiagnosticsError: bundle.nativeDiagnosticsError,
        });
        return bundle;
      }
      case 'GPTLOCK_OPEN_DIAGNOSTICS':
        await chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics.html') });
        return { ok: true };
      case 'GPTLOCK_OPEN_OPTIONS':
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        throw new Error(`Unsupported extension message: ${message.type}`);
    }
  };

  run().then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});

void initialize();
