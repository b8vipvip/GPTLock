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
    ? '已连接，请求会在发送前检查 / Attached'
    : `未连接，聊天保持可用 / Detached${tab?.monitor?.error ? ` · ${tab.monitor.error}` : ''}`;
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
    elements.installDetail.textContent = `${help.detail} 请求锁定器仍会由扩展尝试运行；本地核心主要负责响应证据审计。`;
  }

  const states = {
    lock_ready: ['请求锁定已就绪 / Lock ready', '正式聊天请求会在发送前按锁定策略改写顶层模型和已有推理字段。', 'good'],
    verified: ['锁定已确认 / Verified', '正式请求已按策略发送，响应元数据也符合锁定策略。', 'good'],
    mismatch: guard?.canSend
      ? ['确认有告警 / Warning', '响应确认存在非模型级异常；聊天保持可用。', 'wait']
      : ['模型不匹配 / Model mismatch', '服务器响应确认模型不符合锁定策略，强制模式已阻断后续发送。', 'bad'],
    unverified: ['响应未完全确认 / Unverified', '响应没有同时提供可信模型与推理强度；请求锁定仍然有效，聊天不会因此被阻断。', 'wait'],
    waiting: ['请求已锁，等待确认 / Waiting', '本次正式请求已进入发送流程，正在等待可选的响应元数据确认。', 'wait'],
    preflight_mismatch: ['页面选择不同 / UI differs', '页面文字与策略不同，但正式请求仍会在网络层尝试锁定。', 'wait'],
    preflight_unknown: ['页面选择未知 / UI unknown', '页面没有暴露完整选择；这不会阻止请求锁定或正常聊天。', 'wait'],
    monitor_offline: ['请求锁定器离线 / Interceptor offline', '浏览器调试连接不可用；GPTLock 会告警但不会卡住聊天。', 'wait'],
    verification_disabled: ['请求锁定已启用 / Lock only', '响应确认已关闭；正式请求仍会在发送前尝试锁定。', 'good'],
    core_offline: ['本地核心离线 / Core offline', '请求锁定仍由扩展执行；响应审计不可用，聊天不会被阻断。', 'wait'],
    error: ['响应确认错误 / Verification error', tab?.lastError || 'Verification failed; chat remains available.', 'wait'],
    outside_scope: ['不适用 / Out of scope', 'GPTLock 仅作用于 chatgpt.com。', 'off'],
    disabled: ['GPTLock 已关闭 / Disabled', '请求锁定与响应确认均已暂停。', 'off'],
  };
  const [title, detail, tone] = states[guard?.status] || ['无活动状态 / No active state', '请打开 chatgpt.com 后重试。', 'off'];
  const reasonDetails = {
    model_missing: '响应已捕获，但未暴露可验证模型字段；这不会阻断聊天。',
    reasoning_missing: '响应已捕获，但未暴露可验证推理强度字段；这不会阻断聊天。',
    response_body_read_failed: '浏览器未能读取本次响应体；请求锁定不受影响。',
    response_model_not_exposed: 'ChatGPT 本次响应未暴露模型元数据。',
    response_reasoning_not_exposed: 'ChatGPT 本次响应未暴露推理强度元数据。',
    response_body_empty: '本次可读取响应体为空。',
    response_body_unparseable: '本次响应格式无法安全解析为元数据。',
  };
  const rewrite = tab?.lastRewrite;
  const rewriteDetail = rewrite
    ? `最近请求锁：${rewrite.changed ? '已改写' : '已检查'}${rewrite.modelAfter ? ` → ${rewrite.modelAfter}` : ''}${rewrite.reason ? ` (${rewrite.reason})` : ''}`
    : null;
  const evidenceDetail = reasonDetails[tab?.evidenceIssue] || reasonDetails[guard?.reason];
  elements.verdict.textContent = title.split(' / ')[0];
  elements.verdict.className = `verdict ${tone}`;
  elements.guardTitle.textContent = title;
  elements.guardDetail.textContent = [detail, rewriteDetail, evidenceDetail, guard?.reason].filter(Boolean).join(' · ');
  elements.autoVerify.disabled = !tab || !enabled;
}

elements.enabled.addEventListener('change', () => {
  elements.enabled.disabled = true;
  elements.message.textContent = elements.enabled.checked
    ? '正在启用请求锁定 / Enabling…'
    : '正在关闭 GPTLock / Disabling…';
  void sendMessage({ type: 'GPTLOCK_SET_ENABLED', enabled: elements.enabled.checked })
    .then(load)
    .then(() => { elements.message.textContent = elements.enabled.checked ? 'GPTLock 已启用 / Enabled.' : 'GPTLock 已关闭 / Disabled.'; })
    .catch((error) => { elements.message.textContent = error.message; })
    .finally(() => { elements.enabled.disabled = false; });
});

elements.autoVerify.addEventListener('click', () => {
  elements.message.textContent = '正在自动对齐并发送可见测试消息 / Sending visible verification message…';
  elements.autoVerify.disabled = true;
  void sendMessage({ type: 'GPTLOCK_AUTO_VERIFY' })
    .then(async (result) => {
      await load();
      elements.message.textContent = result.sent
        ? '已自动发送可见测试消息；响应完成后会自动确认 / Visible test sent; verification will finish automatically.'
        : `自动验证未发送 / Not sent · ${result.tabState?.guard?.reason || result.tabState?.guard?.status || 'unknown'}`;
    })
    .catch((error) => { elements.message.textContent = `自动验证失败 / Auto verification failed: ${error.message}`; })
    .finally(() => { elements.autoVerify.disabled = false; });
});

async function load() {
  render(await sendMessage({ type: 'GPTLOCK_GET_STATE' }));
}

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
