import { KNOWN_MODELS, REASONING_LEVELS, normalizeModelId, normalizePolicy } from './policy.js';

const elements = {
  modelChoices: document.getElementById('modelChoices'),
  reasoningChoices: document.getElementById('reasoningChoices'),
  customModels: document.getElementById('customModels'),
  connectionBadge: document.getElementById('connectionBadge'),
  nativeStatus: document.getElementById('nativeStatus'),
  verificationStatus: document.getElementById('verificationStatus'),
  evidenceStatus: document.getElementById('evidenceStatus'),
  reconnect: document.getElementById('reconnect'),
  save: document.getElementById('save'),
  formMessage: document.getElementById('formMessage'),
};

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
    : nativeStatus.lastError || '未连接 / Not connected';

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
  const policy = normalizePolicy(state.policy);
  setSelected('model', policy.lockedModels);
  setSelected('reasoning', policy.allowedReasoningLevels);
  const known = new Set(KNOWN_MODELS.map((model) => model.id));
  elements.customModels.value = policy.lockedModels.filter((model) => !known.has(model)).join(', ');
  document.querySelector(`input[name="mode"][value="${policy.strictMode}"]`).checked = true;
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
  await chrome.storage.sync.set({ policy: { lockedModels, allowedReasoningLevels, strictMode } });
  elements.formMessage.textContent = '已保存，正在同步本地核心 / Saved; syncing with the local core.';
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

void load().catch((error) => {
  renderStatus({ connected: false, lastError: error.message });
});
