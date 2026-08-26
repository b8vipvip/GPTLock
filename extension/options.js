import {
  KNOWN_MODELS,
  REASONING_LEVELS,
  normalizeModelId,
  normalizePolicy,
  normalizeSettings,
} from './policy.js';
import { classifyNativeError, nativeHelp, RELEASES_URL } from './native-status.js';

const elements = {
  extensionVersion: document.getElementById('extensionVersion'),
  modelChoices: document.getElementById('modelChoices'),
  reasoningChoices: document.getElementById('reasoningChoices'),
  customModels: document.getElementById('customModels'),
  preferredReasoning: document.getElementById('preferredReasoning'),
  enabled: document.getElementById('enabled'),
  networkVerification: document.getElementById('networkVerification'),
  autoAlignSelection: document.getElementById('autoAlignSelection'),
  connectionBadge: document.getElementById('connectionBadge'),
  nativeStatus: document.getElementById('nativeStatus'),
  verificationStatus: document.getElementById('verificationStatus'),
  evidenceStatus: document.getElementById('evidenceStatus'),
  reconnect: document.getElementById('reconnect'),
  autoVerify: document.getElementById('autoVerify'),
  logs: document.getElementById('logs'),
  save: document.getElementById('save'),
  formMessage: document.getElementById('formMessage'),
  installHelp: document.getElementById('installHelp'),
  installTitle: document.getElementById('installTitle'),
  installDetail: document.getElementById('installDetail'),
  installCore: document.getElementById('installCore'),
};

let loadedSettings = normalizeSettings();

function checkbox(container, name, id, label, detail = '') {
  const row = document.createElement('label');
  row.className = 'check-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = id;
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = label;
  text.append(strong);
  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    text.append(small);
  }
  row.append(input, text);
  container.append(row);
}

for (const model of KNOWN_MODELS) checkbox(elements.modelChoices, 'model', model.id, model.label, model.id);
for (const level of REASONING_LEVELS) {
  checkbox(elements.reasoningChoices, 'reasoning', level.id, level.labelZh, level.labelEn);
  const option = document.createElement('option');
  option.value = level.id;
  option.textContent = `${level.labelZh} / ${level.labelEn}`;
  elements.preferredReasoning.append(option);
}

function selected(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function setSelected(name, values) {
  for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = values.includes(input.value);
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || 'Extension request failed'));
      else resolve(response.data);
    });
  });
}

function renderStatus(nativeStatus = {}) {
  const connected = Boolean(nativeStatus.connected);
  elements.connectionBadge.className = `badge ${connected ? 'online' : 'offline'}`;
  elements.connectionBadge.textContent = connected
    ? '本地核心已连接 / Core online'
    : '本地核心离线 / Core offline';
  elements.nativeStatus.textContent = connected
    ? `已连接 / Connected${nativeStatus.policyRevision ? ` · ${nativeStatus.policyRevision}` : ''}`
    : `${nativeStatus.lastError || '未连接 / Not connected'} · 请求锁定器可独立运行`;
  elements.installHelp.hidden = connected;
  if (!connected) {
    const help = nativeHelp(nativeStatus.errorCode || classifyNativeError(nativeStatus.lastError));
    elements.installTitle.textContent = help.title;
    elements.installDetail.textContent = `${help.detail} 本地核心离线不会把日常聊天卡死；扩展仍会尝试网络层请求锁定。`;
  }

  const verification = nativeStatus.lastVerification;
  if (!verification) {
    elements.verificationStatus.textContent = '暂无 / None';
    elements.evidenceStatus.textContent = '暂无 / None';
    return;
  }
  const verdicts = {
    verified: '已验证 / Verified',
    mismatch: '不匹配 / Mismatch',
    unverified: '未验证 / Unverified',
  };
  elements.verificationStatus.textContent = `${verdicts[verification.verdict] || verification.verdict} · ${verification.decision}`;
  elements.evidenceStatus.textContent = `${verification.evidenceSource} · ${verification.confidence}`;
}

async function load() {
  const state = await sendMessage({ type: 'GPTLOCK_GET_STATE' });
  elements.extensionVersion.textContent = state.extensionVersion || '';
  const policy = normalizePolicy(state.policy);
  loadedSettings = normalizeSettings(state.settings);
  setSelected('model', policy.lockedModels);
  setSelected('reasoning', policy.allowedReasoningLevels);
  const known = new Set(KNOWN_MODELS.map((model) => model.id));
  elements.customModels.value = policy.lockedModels.filter((model) => !known.has(model)).join(', ');
  document.querySelector(`input[name="mode"][value="${policy.strictMode}"]`).checked = true;
  elements.preferredReasoning.value = loadedSettings.preferredReasoning;
  elements.enabled.checked = loadedSettings.enabled;
  elements.networkVerification.checked = loadedSettings.networkVerificationEnabled;
  elements.autoAlignSelection.checked = loadedSettings.autoAlignSelection;
  renderStatus(state.nativeStatus);
}

async function save() {
  elements.formMessage.textContent = '';
  const customModels = elements.customModels.value
    .split(',')
    .map(normalizeModelId)
    .filter(Boolean);
  const lockedModels = [...new Set([...selected('model'), ...customModels])];
  const allowedReasoningLevels = selected('reasoning');
  if (!lockedModels.length || !allowedReasoningLevels.length) {
    elements.formMessage.textContent = '至少选择一个模型和一个推理强度 / Select at least one model and one reasoning level.';
    return;
  }

  const strictMode = document.querySelector('input[name="mode"]:checked')?.value === 'true';
  const preferredReasoning = allowedReasoningLevels.includes(elements.preferredReasoning.value)
    ? elements.preferredReasoning.value
    : allowedReasoningLevels[0];
  const settings = {
    enabled: elements.enabled.checked,
    preferredReasoning,
    networkVerificationEnabled: elements.networkVerification.checked,
    autoAlignSelection: elements.autoAlignSelection.checked,
    firstRequestMode: loadedSettings.firstRequestMode,
  };
  await chrome.storage.sync.set({
    policy: { lockedModels, allowedReasoningLevels, strictMode },
    settings,
  });
  loadedSettings = normalizeSettings(settings);
  elements.formMessage.textContent = '已保存；请求锁定策略已同步 / Saved; request-lock policy synced.';
  window.setTimeout(() => void load().catch(() => {}), 700);
}

elements.save.addEventListener('click', () => {
  void save().catch((error) => {
    elements.formMessage.textContent = `保存失败 / Save failed: ${error.message}`;
  });
});

elements.reconnect.addEventListener('click', () => {
  elements.nativeStatus.textContent = '重新连接中 / Reconnecting…';
  void sendMessage({ type: 'GPTLOCK_RECONNECT' })
    .then(load)
    .catch((error) => {
      elements.nativeStatus.textContent = `连接失败 / Failed: ${error.message}`;
    });
});

elements.autoVerify.addEventListener('click', () => {
  elements.formMessage.textContent = '正在自动对齐并发送可见测试消息 / Sending visible verification message…';
  elements.autoVerify.disabled = true;
  void sendMessage({ type: 'GPTLOCK_AUTO_VERIFY' })
    .then(async (result) => {
      await load();
      elements.formMessage.textContent = result.sent
        ? '已自动发送可见测试消息；无需人工发送，响应完成后自动确认 / Visible test sent automatically.'
        : `自动验证未发送 / Not sent · ${result.tabState?.guard?.reason || result.tabState?.guard?.status || 'unknown'}`;
    })
    .catch((error) => {
      elements.formMessage.textContent = `自动验证失败 / Auto verification failed: ${error.message}`;
    })
    .finally(() => {
      elements.autoVerify.disabled = false;
    });
});

elements.logs.addEventListener('click', () => {
  void sendMessage({ type: 'GPTLOCK_OPEN_DIAGNOSTICS' });
});

elements.installCore.addEventListener('click', () => {
  void chrome.tabs.create({ url: RELEASES_URL });
});

void load().catch((error) => {
  renderStatus({ connected: false, lastError: error.message });
});
