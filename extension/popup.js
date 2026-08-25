const elements = {
  version: document.getElementById('version'),
  verdict: document.getElementById('verdict'),
  guardTitle: document.getElementById('guardTitle'),
  guardDetail: document.getElementById('guardDetail'),
  native: document.getElementById('native'),
  monitor: document.getElementById('monitor'),
  pageState: document.getElementById('pageState'),
  responseState: document.getElementById('responseState'),
  armProbe: document.getElementById('armProbe'),
  reconnect: document.getElementById('reconnect'),
  options: document.getElementById('options'),
  message: document.getElementById('message'),
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
  elements.native.textContent = native.connected
    ? `已连接 / Online${native.version ? ` · ${native.version}` : ''}`
    : `离线 / Offline${native.lastError ? ` · ${native.lastError}` : ''}`;
  elements.monitor.textContent = tab?.monitor?.attached
    ? '已连接 / Attached'
    : `未连接 / Detached${tab?.monitor?.error ? ` · ${tab.monitor.error}` : ''}`;
  elements.pageState.textContent = valuePair(tab?.pageObservation?.model, tab?.pageObservation?.reasoning);
  elements.responseState.textContent = valuePair(tab?.lastVerification?.model, tab?.lastVerification?.reasoning);

  const states = {
    verified: ['已验证 / Verified', '响应元数据符合锁定策略 / Response metadata matches the policy.', 'good'],
    mismatch: ['不匹配 / Mismatch', '响应元数据违反锁定策略，严格模式将阻断下一次发送。', 'bad'],
    unverified: ['未验证 / Unverified', '响应没有同时提供可信的模型与推理强度元数据。', 'bad'],
    waiting: ['验证中 / Waiting', '本次请求已发送，正在等待完整响应元数据。', 'wait'],
    probe_ready: ['可发送一次探测 / Probe ready', '首次请求无法预先证明后端路由；发送后立即进入等待验证。', 'wait'],
    preflight_mismatch: ['页面选择不符 / Preflight mismatch', '请先把页面模型与推理强度调整到允许范围。', 'bad'],
    monitor_offline: ['验证器离线 / Verifier offline', 'Chrome 网络调试连接不可用；打开 DevTools 也可能使它断开。', 'off'],
    monitor_disabled: ['网络验证已关闭 / Disabled', '严格模式下关闭网络验证会阻止发送。', 'off'],
    core_offline: ['本地核心离线 / Core offline', 'Native Messaging 主机不可用；请检查安装并重新连接。', 'off'],
    initial_block: ['等待探测授权 / Probe required', '在此窗口允许一次探测，或在设置中更改首次请求策略。', 'bad'],
    error: ['验证错误 / Error', tab?.lastError || 'Verification failed.', 'bad'],
    outside_scope: ['不适用 / Out of scope', 'GPTLock 仅作用于 chatgpt.com。', 'off'],
  };
  const [title, detail, tone] = states[guard?.status] || ['无活动状态 / No active state', '请打开 chatgpt.com 后重试。', 'off'];
  elements.verdict.textContent = title.split(' / ')[0];
  elements.verdict.className = `verdict ${tone}`;
  elements.guardTitle.textContent = title;
  elements.guardDetail.textContent = guard?.reason ? `${detail} · ${guard.reason}` : detail;
  elements.armProbe.disabled = !tab || guard?.status === 'verified' || guard?.status === 'waiting';
}

async function load() {
  render(await sendMessage({ type: 'GPTLOCK_GET_STATE' }));
}

elements.armProbe.addEventListener('click', () => {
  elements.message.textContent = '正在授权一次探测 / Arming one probe…';
  void sendMessage({ type: 'GPTLOCK_ARM_PROBE' })
    .then(async (tabState) => {
      await load();
      elements.message.textContent = tabState.guard?.canSend
        ? '已授权；返回页面发送一次消息 / Armed; send one message.'
        : '页面存在明确策略冲突，未授权 / Explicit preflight mismatch; not armed.';
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

elements.options.addEventListener('click', () => {
  void sendMessage({ type: 'GPTLOCK_OPEN_OPTIONS' }).then(() => window.close());
});

void load().catch((error) => {
  elements.guardTitle.textContent = '读取失败 / Failed to load';
  elements.guardDetail.textContent = error.message;
  elements.verdict.textContent = '错误';
  elements.verdict.className = 'verdict bad';
});
