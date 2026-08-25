import { DEFAULT_POLICY, normalizePolicy } from './policy.js';

const NATIVE_HOST = 'com.gptlock.core';
const RECONNECT_ALARM = 'gptlock-native-reconnect';
const REQUEST_TIMEOUT_MS = 7000;

let nativePort = null;
let requestSequence = 0;
const pendingRequests = new Map();

async function ensurePolicy() {
  const { policy } = await chrome.storage.sync.get('policy');
  const normalized = normalizePolicy(policy ?? DEFAULT_POLICY);
  if (!policy || JSON.stringify(policy) !== JSON.stringify(normalized)) {
    await chrome.storage.sync.set({ policy: normalized });
  }
  return normalized;
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
  await chrome.storage.local.set({ nativeStatus: next });
  await updateBadge(next);
  return next;
}

async function updateBadge(status) {
  let text = 'OFF';
  let color = '#64748b';
  const verdict = status.lastVerification?.verdict;
  if (status.connected) {
    text = verdict === 'verified' ? 'OK' : verdict === 'mismatch' ? 'MIS' : '?';
    color = verdict === 'verified' ? '#15803d' : verdict === 'mismatch' ? '#b91c1c' : '#b45309';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
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
  const policy = await ensurePolicy();
  const result = await sendNative('set_policy', { policy });
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
      ...observation,
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

async function initialize() {
  await ensurePolicy();
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
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await writeNativeStatus({ connected: false, lastError: detail });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void initialize();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.policy) {
    void syncPolicy().catch(async (error) => {
      await writeNativeStatus({
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    });
  }
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;

  const run = async () => {
    switch (message.type) {
      case 'GPTLOCK_GET_STATE': {
        const [{ policy }, { nativeStatus }] = await Promise.all([
          chrome.storage.sync.get('policy'),
          chrome.storage.local.get('nativeStatus'),
        ]);
        return { policy: normalizePolicy(policy), nativeStatus: nativeStatus ?? { connected: false } };
      }
      case 'GPTLOCK_RECONNECT':
        {
          const previousPort = nativePort;
          nativePort = null;
          rejectPending(new Error('Native host reconnect requested'));
          previousPort?.disconnect();
        }
        await initialize();
        return { ok: true };
      case 'GPTLOCK_PAGE_OBSERVATION':
      case 'GPTLOCK_VERIFY':
        return verifyObservation(message.observation ?? {});
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
