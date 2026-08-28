export const DEFAULT_POLICY = Object.freeze({
  lockedModels: ['gpt-5.6-sol'],
  allowedReasoningLevels: ['medium', 'high', 'extra-high'],
  strictMode: true,
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  networkVerificationEnabled: true,
  firstRequestMode: 'allow_once',
  autoAlignSelection: true,
  preferredReasoning: 'high',
});

export const KNOWN_MODELS = Object.freeze([
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
]);

export const REASONING_LEVELS = Object.freeze([
  { id: 'low', labelZh: '低', labelEn: 'Low' },
  { id: 'medium', labelZh: '中', labelEn: 'Medium' },
  { id: 'high', labelZh: '高', labelEn: 'High' },
  { id: 'extra-high', labelZh: '超高', labelEn: 'Extra High' },
]);

const MODEL_ALIASES = Object.freeze({
  'gpt-5.6-sol-wm': 'gpt-5.6-sol',
  'gpt-5-6': 'gpt-5.6-sol',
});

const MODEL_TRANSPORT_IDS = Object.freeze({
  'gpt-5.6-sol': 'gpt-5.6-sol-wm',
});

function unique(values) {
  return [...new Set(values)];
}

export function normalizeModelId(value) {
  const model = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
  return MODEL_ALIASES[model] ?? model;
}

export function modelTransportId(value) {
  const model = normalizeModelId(value);
  return model ? MODEL_TRANSPORT_IDS[model] ?? model : null;
}

export function normalizeReasoningLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  if (['extra high', 'extra_high', 'extra-high', 'xhigh'].includes(level)) return 'extra-high';
  if (level === 'extended') return 'high';
  return ['low', 'medium', 'high'].includes(level) ? level : null;
}

export function normalizePolicy(input) {
  const source = input && typeof input === 'object' ? input : DEFAULT_POLICY;
  const rawModels = Array.isArray(source.lockedModels)
    ? source.lockedModels
    : Array.isArray(source.models)
      ? source.models
      : DEFAULT_POLICY.lockedModels;
  const rawLevels = Array.isArray(source.allowedReasoningLevels)
    ? source.allowedReasoningLevels
    : Array.isArray(source.reasoningLevels)
      ? source.reasoningLevels
      : DEFAULT_POLICY.allowedReasoningLevels;

  const lockedModels = unique(rawModels.map(normalizeModelId).filter(Boolean));
  const allowedReasoningLevels = unique(rawLevels.map(normalizeReasoningLevel).filter(Boolean));

  return {
    lockedModels: lockedModels.length ? lockedModels : [...DEFAULT_POLICY.lockedModels],
    allowedReasoningLevels: allowedReasoningLevels.length
      ? allowedReasoningLevels
      : [...DEFAULT_POLICY.allowedReasoningLevels],
    strictMode: typeof source.strictMode === 'boolean' ? source.strictMode : DEFAULT_POLICY.strictMode,
  };
}

export function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : DEFAULT_SETTINGS;
  return {
    enabled: typeof source.enabled === 'boolean'
      ? source.enabled
      : DEFAULT_SETTINGS.enabled,
    networkVerificationEnabled: typeof source.networkVerificationEnabled === 'boolean'
      ? source.networkVerificationEnabled
      : DEFAULT_SETTINGS.networkVerificationEnabled,
    firstRequestMode: ['allow_once', 'block'].includes(source.firstRequestMode)
      ? source.firstRequestMode
      : DEFAULT_SETTINGS.firstRequestMode,
    autoAlignSelection: typeof source.autoAlignSelection === 'boolean'
      ? source.autoAlignSelection
      : DEFAULT_SETTINGS.autoAlignSelection,
    preferredReasoning: normalizeReasoningLevel(source.preferredReasoning)
      ?? DEFAULT_SETTINGS.preferredReasoning,
  };
}

if (typeof document === 'undefined' && typeof chrome !== 'undefined' && chrome.debugger && chrome.runtime?.onMessage) {
  const API_BASE = 'https://gptlock.mv3.cn/api/v1';
  const STORAGE_KEY = 'gptlockLicense';
  const BROWSER_KEY = 'gptlockBrowserInstanceId';
  const HEARTBEAT_ALARM = 'gptlock-license-heartbeat';
  const HEARTBEAT_MINUTES = 1;
  const OFFLINE_GRACE_MS = 3 * 60 * 1000;
  const NATIVE_HOST = 'com.gptlock.core';

  const original = {
    debuggerAttach: chrome.debugger.attach.bind(chrome.debugger),
    debuggerSendCommand: chrome.debugger.sendCommand.bind(chrome.debugger),
    debuggerDetach: chrome.debugger.detach.bind(chrome.debugger),
    tabsSendMessage: chrome.tabs.sendMessage.bind(chrome.tabs),
    onMessageAddListener: chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage),
  };

  let licenseState = {
    authorized: false,
    status: 'unlicensed',
    reason: 'license_required',
    activationToken: null,
    deviceId: null,
    browserInstanceId: null,
    allowedWindowKeys: [],
    deniedWindowKeys: [],
    license: null,
    lastVerifiedAt: null,
    lastError: null,
  };
  const tabWindowMap = new Map();
  let heartbeatTimer = null;
  let initialized = false;

  function errorText(error) { return error instanceof Error ? error.message : String(error); }
  function replaceMethod(target, key, replacement) {
    try { target[key] = replacement; } catch {}
    if (target[key] !== replacement) {
      try { Object.defineProperty(target, key, { value: replacement, configurable: true, writable: true }); } catch {}
    }
    if (target[key] !== replacement) throw new Error(`GPTLock license enforcement cannot wrap chrome API: ${key}`);
  }
  function randomId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
  function windowKey(windowId) {
    return licenseState.browserInstanceId && Number.isInteger(windowId)
      ? `${licenseState.browserInstanceId}:${windowId}`
      : null;
  }
  function windowAuthorized(windowId) {
    const key = windowKey(windowId);
    return Boolean(licenseState.authorized && key && licenseState.allowedWindowKeys.includes(key));
  }
  function tabAuthorized(tabId) { return windowAuthorized(tabWindowMap.get(tabId)); }
  function publicLicense(windowId = null) {
    return {
      authorized: Boolean(licenseState.authorized),
      windowAuthorized: Number.isInteger(windowId) ? windowAuthorized(windowId) : Boolean(licenseState.authorized),
      status: licenseState.status,
      reason: licenseState.reason,
      deviceId: licenseState.deviceId,
      browserInstanceId: licenseState.browserInstanceId,
      license: licenseState.license,
      allowedWindowCount: licenseState.allowedWindowKeys.length,
      deniedWindowCount: licenseState.deniedWindowKeys.length,
      lastVerifiedAt: licenseState.lastVerifiedAt,
      lastError: licenseState.lastError,
      server: 'gptlock.mv3.cn',
    };
  }
  function passiveGuard() {
    return { canSend: true, allowKind: 'license_required', status: 'license_required', reason: 'license_required' };
  }
  function augmentPayload(payload, windowId) {
    if (!payload || typeof payload !== 'object') return payload;
    const licensed = Number.isInteger(windowId) ? windowAuthorized(windowId) : licenseState.authorized;
    const next = { ...payload, license: publicLicense(windowId) };
    if (!licensed) {
      if (next.settings) next.settings = { ...next.settings, enabled: false, autoAlignSelection: false };
      if (next.tabState) next.tabState = { ...next.tabState, guard: passiveGuard() };
      if (next.state) next.state = { ...next.state, guard: passiveGuard() };
    }
    return next;
  }
  function augmentResponse(response, sender) {
    if (!response?.ok || !response.data || typeof response.data !== 'object') return response;
    return { ...response, data: augmentPayload(response.data, sender?.tab?.windowId ?? null) };
  }

  async function storageLoad() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, BROWSER_KEY]);
    let browserInstanceId = stored[BROWSER_KEY];
    if (!browserInstanceId) {
      browserInstanceId = randomId('browser');
      await chrome.storage.local.set({ [BROWSER_KEY]: browserInstanceId });
    }
    licenseState = {
      ...licenseState,
      ...(stored[STORAGE_KEY] || {}),
      browserInstanceId,
      allowedWindowKeys: Array.isArray(stored[STORAGE_KEY]?.allowedWindowKeys) ? stored[STORAGE_KEY].allowedWindowKeys : [],
      deniedWindowKeys: Array.isArray(stored[STORAGE_KEY]?.deniedWindowKeys) ? stored[STORAGE_KEY].deniedWindowKeys : [],
    };
  }
  async function storageSave() {
    await chrome.storage.local.set({ [STORAGE_KEY]: licenseState, [BROWSER_KEY]: licenseState.browserInstanceId });
  }
  async function refreshTabMap() {
    const tabs = await chrome.tabs.query({});
    tabWindowMap.clear();
    for (const tab of tabs) if (Number.isInteger(tab.id) && Number.isInteger(tab.windowId)) tabWindowMap.set(tab.id, tab.windowId);
    return tabs;
  }
  async function chatGptWindowKeys() {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    for (const tab of tabs) if (Number.isInteger(tab.id) && Number.isInteger(tab.windowId)) tabWindowMap.set(tab.id, tab.windowId);
    return [...new Set(tabs.map((tab) => windowKey(tab.windowId)).filter(Boolean))].sort();
  }
  function nativeRequest(type) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      const id = `license-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => { try { port.disconnect(); } catch {} reject(new Error('本地核心响应超时 / Native core timed out')); }, 5000);
      port.onMessage.addListener((message) => {
        if (String(message?.id) !== id) return;
        clearTimeout(timer);
        try { port.disconnect(); } catch {}
        if (message.ok) resolve(message.data);
        else reject(new Error(message.error?.messageZhCn || message.error?.messageEn || 'Native core request failed'));
      });
      port.onDisconnect.addListener(() => {
        if (!chrome.runtime.lastError) return;
        clearTimeout(timer);
        reject(new Error(chrome.runtime.lastError.message));
      });
      port.postMessage({ id, type });
    });
  }
  async function resolveDeviceId() {
    const status = await nativeRequest('get_status');
    if (!status?.deviceId) throw new Error('本地核心版本过旧，缺少设备标识；请更新 GPTLock / Native Core update required');
    licenseState.deviceId = status.deviceId;
    return status.deviceId;
  }
  async function api(path, { token = null, body = {} } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error?.message || `授权服务器返回 HTTP ${response.status}`);
      error.code = data.error?.code || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function detachUnauthorizedTabs() {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    await Promise.all(tabs.filter((tab) => !windowAuthorized(tab.windowId)).map((tab) => new Promise((resolve) => {
      original.debuggerDetach({ tabId: tab.id }, () => { void chrome.runtime.lastError; resolve(); });
    })));
  }
  async function nudgeCore() {
    try { await chrome.runtime.sendMessage({ type: 'GPTLOCK_RECONNECT', licenseInternal: true }); } catch {}
  }
  async function heartbeat({ forceNudge = false } = {}) {
    if (!licenseState.activationToken) {
      licenseState.authorized = false;
      licenseState.status = 'unlicensed';
      licenseState.reason = 'license_required';
      licenseState.allowedWindowKeys = [];
      licenseState.deniedWindowKeys = [];
      await storageSave();
      await detachUnauthorizedTabs();
      return publicLicense();
    }
    const previousAllowed = JSON.stringify(licenseState.allowedWindowKeys);
    try {
      const windowKeys = await chatGptWindowKeys();
      const data = await api('/licenses/heartbeat', {
        token: licenseState.activationToken,
        body: { windowKeys, extensionVersion: chrome.runtime.getManifest().version },
      });
      licenseState.authorized = true;
      licenseState.status = 'authorized';
      licenseState.reason = null;
      licenseState.allowedWindowKeys = data.allowedWindowKeys || [];
      licenseState.deniedWindowKeys = data.deniedWindowKeys || [];
      licenseState.license = data.license || licenseState.license;
      licenseState.lastVerifiedAt = new Date().toISOString();
      licenseState.lastError = null;
      await storageSave();
      await detachUnauthorizedTabs();
      if (forceNudge || previousAllowed !== JSON.stringify(licenseState.allowedWindowKeys)) await nudgeCore();
      return publicLicense();
    } catch (error) {
      const serverRejected = ['ACTIVATION_INVALID', 'LICENSE_REVOKED', 'LICENSE_EXPIRED', 'LICENSE_NOT_STARTED'].includes(error.code);
      const last = Date.parse(licenseState.lastVerifiedAt || '');
      if (!serverRejected && Number.isFinite(last) && Date.now() - last <= OFFLINE_GRACE_MS) {
        licenseState.authorized = true;
        licenseState.status = 'grace';
        licenseState.reason = 'license_server_temporarily_unreachable';
        licenseState.lastError = errorText(error);
        await storageSave();
        return publicLicense();
      }
      licenseState.authorized = false;
      licenseState.status = serverRejected ? 'invalid' : 'offline';
      licenseState.reason = error.code || 'license_server_unreachable';
      licenseState.lastError = errorText(error);
      licenseState.allowedWindowKeys = [];
      licenseState.deniedWindowKeys = [];
      if (serverRejected) licenseState.activationToken = null;
      await storageSave();
      await detachUnauthorizedTabs();
      return publicLicense();
    }
  }
  async function activate(code) {
    const deviceId = await resolveDeviceId();
    const platform = await chrome.runtime.getPlatformInfo();
    const data = await api('/licenses/activate', {
      body: {
        code: String(code || '').trim(),
        deviceId,
        browserInstanceId: licenseState.browserInstanceId,
        extensionId: chrome.runtime.id,
        extensionVersion: chrome.runtime.getManifest().version,
        platform: `${platform.os || ''}/${platform.arch || ''}`,
      },
    });
    licenseState.activationToken = data.activationToken;
    licenseState.license = data.license;
    licenseState.authorized = true;
    licenseState.status = 'authorized';
    licenseState.reason = null;
    licenseState.lastVerifiedAt = new Date().toISOString();
    licenseState.lastError = null;
    await storageSave();
    return heartbeat({ forceNudge: true });
  }
  async function deactivate() {
    const token = licenseState.activationToken;
    if (token) { try { await api('/licenses/deactivate', { token }); } catch {} }
    licenseState = {
      ...licenseState,
      authorized: false,
      status: 'unlicensed',
      reason: 'license_required',
      activationToken: null,
      allowedWindowKeys: [],
      deniedWindowKeys: [],
      license: null,
      lastVerifiedAt: null,
      lastError: null,
    };
    await storageSave();
    await detachUnauthorizedTabs();
    await nudgeCore();
    return publicLicense();
  }
  function scheduleHeartbeatSoon() {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => void heartbeat(), 600);
  }

  replaceMethod(chrome.debugger, 'attach', function patchedAttach(target, version, callback) {
    if (target?.tabId && !tabAuthorized(target.tabId)) throw new Error('GPTLock license required for this browser window');
    return original.debuggerAttach(target, version, callback);
  });
  replaceMethod(chrome.debugger, 'sendCommand', function patchedSendCommand(target, method, params, callback) {
    if (target?.tabId && !tabAuthorized(target.tabId)) throw new Error('GPTLock license required for this browser window');
    return original.debuggerSendCommand(target, method, params, callback);
  });
  replaceMethod(chrome.tabs, 'sendMessage', function patchedTabsSendMessage(tabId, message, ...rest) {
    if (message?.type === 'GPTLOCK_GUARD_STATE') message = augmentPayload(message, tabWindowMap.get(tabId));
    return original.tabsSendMessage(tabId, message, ...rest);
  });

  original.onMessageAddListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;
    if (!message.type.startsWith('GPTLOCK_LICENSE_')) return false;
    const run = async () => {
      switch (message.type) {
        case 'GPTLOCK_LICENSE_GET': return publicLicense(Number.isInteger(message.windowId) ? message.windowId : (sender.tab?.windowId ?? null));
        case 'GPTLOCK_LICENSE_ACTIVATE': return activate(message.code);
        case 'GPTLOCK_LICENSE_REFRESH': return heartbeat({ forceNudge: true });
        case 'GPTLOCK_LICENSE_DEACTIVATE': return deactivate();
        default: throw new Error(`Unsupported license message: ${message.type}`);
      }
    };
    run().then((data) => sendResponse({ ok: true, data }), (error) => sendResponse({ ok: false, error: errorText(error), code: error.code || null }));
    return true;
  });

  replaceMethod(chrome.runtime.onMessage, 'addListener', function patchedAddListener(listener) {
    return original.onMessageAddListener((message, sender, sendResponse) => {
      const windowId = Number.isInteger(message?.windowId) ? message.windowId : (sender?.tab?.windowId ?? null);
      const licensed = Number.isInteger(windowId) ? windowAuthorized(windowId) : licenseState.authorized;
      if (!licensed && message?.type === 'GPTLOCK_SEND_STARTED') {
        sendResponse({ ok: true, data: { accepted: true, guard: passiveGuard(), license: publicLicense(windowId) } });
        return false;
      }
      if (!licensed && message?.type === 'GPTLOCK_SET_ENABLED' && message.enabled) {
        sendResponse({ ok: false, error: '请先验证 GPTLock 授权码 / License required' });
        return false;
      }
      if (!licensed && ['GPTLOCK_AUTO_VERIFY', 'GPTLOCK_ARM_PROBE', 'GPTLOCK_VERIFY'].includes(message?.type)) {
        sendResponse({ ok: false, error: '当前浏览器窗口未获得 GPTLock 授权 / This browser window is not licensed' });
        return false;
      }
      const wrappedSendResponse = (response) => sendResponse(augmentResponse(response, sender));
      return listener(message, sender, wrappedSendResponse);
    });
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (Number.isInteger(tab.id) && Number.isInteger(tab.windowId)) tabWindowMap.set(tab.id, tab.windowId);
    scheduleHeartbeatSoon();
  });
  chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
    if (Number.isInteger(tab.windowId)) tabWindowMap.set(tabId, tab.windowId);
    scheduleHeartbeatSoon();
  });
  chrome.tabs.onAttached.addListener((tabId, info) => { tabWindowMap.set(tabId, info.newWindowId); scheduleHeartbeatSoon(); });
  chrome.tabs.onRemoved.addListener((tabId) => { tabWindowMap.delete(tabId); scheduleHeartbeatSoon(); });
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === HEARTBEAT_ALARM) void heartbeat(); });

  async function initializeLicense() {
    if (initialized) return;
    initialized = true;
    await storageLoad();
    await refreshTabMap();
    chrome.alarms.create(HEARTBEAT_ALARM, { delayInMinutes: 0.2, periodInMinutes: HEARTBEAT_MINUTES });
    await heartbeat();
  }

  void initializeLicense();
}
