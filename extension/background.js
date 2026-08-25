import {
  DEFAULT_POLICY,
  DEFAULT_SETTINGS,
  normalizePolicy,
  normalizeSettings,
} from './policy.js';
import { ChatGptNetworkMonitor } from './network-monitor.js';
import { evaluateGuard } from './guard.js';
import { classifyNativeError } from './native-status.js';

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
  } else if (['monitor_offline', 'monitor_disabled', 'core_offline'].includes(guard.status)) {
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
  for (const { reject, timer } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(error);
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
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.error?.messageZhCn || message.error?.messageEn || 'Native request failed'));
    });
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      const detail = chrome.runtime.lastError?.message || 'Native host disconnected';
      nativePort = null;
      rejectPending(new Error(detail));
      void writeNativeStatus({ connected: false, lastError: detail });
      scheduleReconnect();
    });
    void writeNativeStatus({ connected: true, lastError: null, lastSeenAt: new Date().toISOString() });
    return port;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void writeNativeStatus({ connected: false, lastError: detail });
    scheduleReconnect();
    throw error;
  }
}

function sendNative(type, payload = {}) {
  const port = connectNative();
  const id = `${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Native request timed out: ${type}`));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    try {
      port.postMessage({ id, type, ...payload });
    } catch (error) {
      clearTimeout(timer);
      pendingRequests.delete(id);
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

async function applyNetworkEvidence(tabId, evidence) {
  const state = ensureTabState(tabId);
  try {
    const result = await verifyObservation({
      model: evidence.conflicts?.model ? null : evidence.model,
      reasoning: evidence.conflicts?.reasoning ? null : evidence.reasoning,
      evidenceSource: 'network_response_metadata',
      capturedAt: evidence.capturedAt,
      requestId: `cdp-${tabId}-${evidence.requestId}`,
    });
    state.lastVerification = result;
    state.lastError = evidence.bodyError || (evidence.conflicts?.model || evidence.conflicts?.reasoning
      ? 'conflicting_response_metadata'
      : null);
    state.phase = result.verdict;
  } catch (error) {
    state.phase = 'error';
    state.lastError = error instanceof Error ? error.message : String(error);
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
    void broadcastTabState(tabId);
  },
  onRequest(tabId, request) {
    const state = ensureTabState(tabId);
    state.lastRequest = {
      requestId: request.requestId,
      capturedAt: request.capturedAt,
      model: request.model,
      reasoning: request.reasoning,
    };
    state.probeUsed = true;
    state.probeArmed = false;
    state.phase = 'waiting';
    state.lastError = request.conflicts?.model || request.conflicts?.reasoning
      ? 'conflicting_request_metadata'
      : null;
    void broadcastTabState(tabId);
  },
  onEvidence(tabId, evidence) {
    void applyNetworkEvidence(tabId, evidence);
  },
  onFailure(tabId, failure) {
    void applyNetworkEvidence(tabId, {
      requestId: failure.requestId,
      capturedAt: new Date().toISOString(),
      model: null,
      reasoning: null,
      conflicts: { model: false, reasoning: false },
      bodyError: failure.error,
    });
  },
});

async function configureTab(tab) {
  if (!tab?.id || !isChatGptUrl(tab.url ?? '')) return;
  const state = ensureTabState(tab.id, tab.url);
  if (currentSettings.networkVerificationEnabled) await networkMonitor.attach(tab.id);
  else await networkMonitor.detach(tab.id);
  await broadcastTabState(tab.id);
  return state;
}

async function configureOpenTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  await Promise.all(tabs.map((tab) => configureTab(tab)));
}

async function initialize() {
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
    const detail = error instanceof Error ? error.message : String(error);
    await writeNativeStatus({ connected: false, lastError: detail });
  }
  await configureOpenTabs();
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
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
      await writeNativeStatus({ connected: false, lastError: error instanceof Error ? error.message : String(error) });
    });
  }
  if (changes.policy || changes.settings) {
    for (const state of tabStates.values()) {
      state.phase = 'initial';
      state.probeUsed = false;
      state.probeArmed = false;
      state.lastVerification = null;
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
        return { ok: true };
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
        if (!guard.canSend) return { accepted: false, guard };
        state.phase = 'waiting';
        state.probeUsed = state.probeUsed || guard.allowKind === 'probe';
        state.probeArmed = false;
        state.lastError = null;
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
        await broadcastTabState(tabId);
        return publicTabState(state);
      }
      case 'GPTLOCK_VERIFY':
        return verifyObservation(message.observation ?? {});
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
