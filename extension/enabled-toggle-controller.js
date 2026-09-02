const toggle = document.getElementById('enabled');
const message = document.getElementById('message');

const TOGGLE_TIMEOUT_MS = 12000;
let busy = false;
let entitlement = { authenticated: false, active: false };

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('切换操作超时，请重试 / Toggle request timed out; please retry'));
    }, TOGGLE_TIMEOUT_MS);

    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || 'Extension request failed'));
      else resolve(response.data);
    });
  });
}

function syncAvailability() {
  if (!toggle) return;
  toggle.disabled = busy || !entitlement.authenticated || !entitlement.active;
  if (busy) toggle.title = '正在切换 GPTLock，请稍候 / Updating GPTLock…';
  else if (!entitlement.active) toggle.title = '免费期或会员已到期，请在账户中心开通会员';
  else toggle.title = '启用或关闭 GPTLock；窗口数量不受限制';
}

async function refreshState() {
  const state = await sendMessage('GPTLOCK_GET_STATE');
  entitlement = {
    authenticated: Boolean(state?.account?.authenticated),
    active: Boolean(state?.account?.entitlement?.active),
  };
  if (toggle) toggle.checked = state?.settings?.enabled !== false;
  syncAvailability();
  return state;
}

window.addEventListener('gptlock-entitlement-state', (event) => {
  entitlement = {
    authenticated: Boolean(event.detail?.authenticated),
    active: Boolean(event.detail?.active),
  };
  syncAvailability();
});

if (toggle) {
  toggle.addEventListener('change', (event) => {
    // Capture phase makes this controller the only owner of the switch action.
    // The legacy popup.js listener is intentionally bypassed so it cannot leave
    // the input disabled while waiting for unrelated CDP tab reconfiguration.
    event.stopImmediatePropagation();
    if (busy) return;

    const desired = Boolean(toggle.checked);
    const previous = !desired;
    busy = true;
    syncAvailability();
    if (message) message.textContent = desired
      ? '正在启用请求锁定 / Enabling…'
      : '正在关闭 GPTLock / Disabling…';

    void sendMessage('GPTLOCK_SET_ENABLED', { enabled: desired })
      .then(() => refreshState())
      .then(() => {
        if (message) message.textContent = desired
          ? 'GPTLock 已启用 / Enabled.'
          : 'GPTLock 已关闭 / Disabled.';
      })
      .catch(async (error) => {
        toggle.checked = previous;
        if (message) message.textContent = `切换失败 / Toggle failed: ${error.message}`;
        try { await refreshState(); } catch {}
      })
      .finally(() => {
        busy = false;
        syncAvailability();
        window.dispatchEvent(new CustomEvent('gptlock-account-refresh'));
      });
  }, true);
}

void refreshState().catch(() => {
  busy = false;
  syncAvailability();
});
