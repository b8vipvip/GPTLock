import { classifyNativeError, nativeHelp, RELEASES_URL } from './native-status.js';

const elements = {
  version: document.getElementById('version'),
  verdict: document.getElementById('verdict'),
  guardTitle: document.getElementById('guardTitle'),
  guardDetail: document.getElementById('guardDetail'),
  native: document.getElementById('native'),
  monitor: document.getElementById('monitor'),
  pageState: document.getElementById('pageState'),
  responseState: document.getElementById('responseState'),
  enabled: document.getElementById('enabled'),
  autoVerify: document.getElementById('autoVerify'),
  armProbe: document.getElementById('armProbe'),
  reconnect: document.getElementById('reconnect'),
  logs: document.getElementById('logs'),
  options: document.getElementById('options'),
  message: document.getElementById('message'),
  installHelp: document.getElementById('installHelp'),
  installTitle: document.getElementById('installTitle'),
  installDetail: document.getElementById('installDetail'),
  installCore: document.getElementById('installCore'),
};

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

function valuePair(model, reasoning) {
  return model || reasoning ? `${model || 'model ?'} · ${reasoning || 'reasoning ?'}` : '无 / None';
}

function render(state) {
  elements.version.textContent = state.extensionVersion || '';
  const native = state.nativeStatus ?? {};
  const tab = state.tabState;
  const guard = tab?.guard;
  const enabled = state.settings?.enabled !== false;
  elements.enabled.checked = enabled;
  elements.native.textContent = native.connected
    ? `已连接 / Online${native.version ? ` · ${native.version}` : ''}`
    : `离线 / Offline${native.lastError ? ` · ${native.lastError}` : ''}`;
  elements.monitor.textContent = tab?.monitor?.attached
    ? '已连接 / Attached'
    : `未连接 / Detached${tab?.monitor?.error ? ` · ${tab.monitor.error}` : ''}`;
  elements.pageState.textContent = valuePair(tab?.pageObservation?.model, tab?.pageObservation?.reasoning);
  const responseValue = valuePair(tab?.lastVerification?.model, tab?.lastVerification?.reasoning);
  elements.responseState.textContent = tab?.evidenceIssue
    ? `${responseValue} · ${tab.evidenceIssue}`
    : responseValue;
  const nativeErrorCode = native.errorCode || classifyNativeError(native.lastError);
  elements.installHelp.hidden = Boolean(native.connected);
  if (!native.connected) {
    const help = nativeHelp(nativeErrorCode);
    elements.installTitle.textContent = help.title;
    elements.installDetail.textContent = help.detail;
  }

  const states = {
    verified: ['已验证 / Verified', '响应元数据符合锁定策略 / Response metadata matches the policy.', 'good'],
    mismatch: ['不匹配 / Mismatch', '响应元数据违反锁定策略，严格模式将阻断下一次发送。', 'bad'],
    unverified: ['未验证 / Unverified', '响应没有同时提供可信的模型与推理强度元数据。', 'bad'],
    waiting: ['验证中 / Waiting', '本次请求已发送，正在等待完整响应元数据。', 'wait'],
    probe_ready: ['可发送一次探测 / Probe ready', '首次请求无法预先证明后端路由；发送后立即进入等待验证。', 'wait'],
    preflight_mismatch: ['页面选择冲突 / Preflight mismatch', '页面检测到了策略明确禁止的模型或推理强度。', 'bad'],
    preflight_unknown: ['页面选择未知 / Preflight unknown', '页面没有暴露完整模型与推理强度；可手动授权一次探测。', 'wait'],
    monitor_offline: ['验证器离线 / Verifier offline', 'Chrome 网络调试连接不可用；打开 DevTools 也可能使它断开。', 'off'],
    monitor_disabled: ['网络验证已关闭 / Disabled', '严格模式下关闭网络验证会阻止发送。', 'off'],
    core_offline: ['本地核心离线 / Core offline', nativeErrorCode === 'host_not_installed'
      ? '只加载扩展还不够；请先安装 GPTLock 本地核心。'
      : 'Native Messaging 主机不可用；请检查安装并重新连接。', 'off'],
    initial_block: ['等待探测授权 / Probe required', '在此窗口允许一次探测，或在设置中更改首次请求策略。', 'bad'],
    error: ['验证错误 / Error', tab?.lastError || 'Verification failed.', 'bad'],
    outside_scope: ['不适用 / Out of scope', 'GPTLock 仅作用于 chatgpt.com。', 'off'],
    disabled: ['GPTLock 已关闭 / Disabled', '保护与网络监控已暂停；发送不会被 GPTLock 阻止。', 'off'],
  };
  const [title, detail, tone] = states[guard?.status] || ['无活动状态 / No active state', '请打开 chatgpt.com 后重试。', 'off'];
  const reasonDetails = {
    model_missing: '响应已被捕获，但其中没有可验证的模型字段；这不是本地核心离线。',
    reasoning_missing: '响应已被捕获，但其中没有可验证的推理强度字段。',
    response_body_read_failed: '浏览器未能读取本次响应体；请在运行日志中查看具体错误。',
    response_model_not_exposed: 'ChatGPT 本次响应未暴露模型元数据。',
    response_reasoning_not_exposed: 'ChatGPT 本次响应未暴露推理强度元数据。',
    response_body_empty: '本次可读取响应体为空。',
    response_body_unparseable: '本次响应格式无法安全解析为元数据。',
  };
  const evidenceDetail = reasonDetails[tab?.evidenceIssue] || reasonDetails[guard?.reason];
  elements.verdict.textContent = title.split(' / ')[0];
  elements.verdict.className = `verdict ${tone}`;
  elements.guardTitle.textContent = title;
  elements.guardDetail.textContent = [detail, evidenceDetail, guard?.reason].filter(Boolean).join(' · ');
  elements.autoVerify.disabled = !tab || !enabled;
  elements.armProbe.disabled = !tab || !enabled || [
    'verified', 'waiting', 'core_offline', 'monitor_offline', 'monitor_disabled', 'preflight_mismatch',
  ].includes(guard?.status);
}

elements.enabled.addEventListener('change', () => {
  elements.enabled.disabled = true;
  elements.message.textContent = elements.enabled.checked
    ? '正在启用 / Enabling…'
    : '正在关闭 / Disabling…';
  void sendMessage({ type: 'GPTLOCK_SET_ENABLED', enabled: elements.enabled.checked })
    .then(load)
    .then(() => { elements.message.textContent = elements.enabled.checked ? 'GPTLock 已启用 / Enabled.' : 'GPTLock 已关闭 / Disabled.'; })
    .catch((error) => { elements.message.textContent = error.message; })
    .finally(() => { elements.enabled.disabled = false; });
});

elements.autoVerify.addEventListener('click', () => {
  elements.message.textContent = '正在检查核心、网络验证器和页面状态 / Checking core, verifier, and page…';
  elements.autoVerify.disabled = true;
  void sendMessage({ type: 'GPTLOCK_AUTO_VERIFY' })
    .then(async (result) => {
      await load();
      elements.message.textContent = result.ready
        ? '自动验证已准备；请正常发送一条消息 / Ready; send one normal message.'
        : `尚未就绪 / Not ready · ${result.tabState?.guard?.reason || result.tabState?.guard?.status || 'unknown'}`;
    })
    .catch((error) => { elements.message.textContent = error.message; })
    .finally(() => { elements.autoVerify.disabled = false; });
});

function armFeedback(guard) {
  if (guard?.canSend) return '已授权；返回页面发送一次消息 / Armed; send one message.';
  const messages = {
    core_offline: '请先安装或修复本地核心 / Install or repair the Local Core first.',
    monitor_offline: '请先重新连接网络验证器 / Reconnect the network verifier first.',
    monitor_disabled: '请先在设置中启用网络验证 / Enable network verification first.',
    preflight_mismatch: '页面存在明确策略冲突，未授权 / Explicit preflight mismatch; not armed.',
  };
  return messages[guard?.status] || `未授权 / Not armed${guard?.reason ? ` · ${guard.reason}` : ''}`;
}

async function load() {
  render(await sendMessage({ type: 'GPTLOCK_GET_STATE' }));
}

elements.armProbe.addEventListener('click', () => {
  elements.message.textContent = '正在授权一次探测 / Arming one probe…';
  void sendMessage({ type: 'GPTLOCK_ARM_PROBE' })
    .then(async (tabState) => {
      await load();
      elements.message.textContent = armFeedback(tabState.guard);
    })
    .catch((error) => { elements.message.textContent = error.message; });
});

elements.reconnect.addEventListener('click', () => {
  elements.message.textContent = '重新连接中 / Reconnecting…';
  void sendMessage({ type: 'GPTLOCK_RECONNECT' })
    .then(() => load())
    .then(() => { elements.message.textContent = '连接检查完成 / Reconnect completed.'; })
    .catch((error) => { elements.message.textContent = error.message; });
});

elements.installCore.addEventListener('click', () => {
  void chrome.tabs.create({ url: RELEASES_URL }).then(() => window.close());
});

elements.options.addEventListener('click', () => {
  void sendMessage({ type: 'GPTLOCK_OPEN_OPTIONS' }).then(() => window.close());
});

elements.logs.addEventListener('click', () => {
  void sendMessage({ type: 'GPTLOCK_OPEN_DIAGNOSTICS' }).then(() => window.close());
});

void load().catch((error) => {
  elements.guardTitle.textContent = '读取失败 / Failed to load';
  elements.guardDetail.textContent = error.message;
  elements.verdict.textContent = '错误';
  elements.verdict.className = 'verdict bad';
});
