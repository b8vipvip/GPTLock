const toggle = document.getElementById('enabled');
const message = document.getElementById('message');

const STORAGE_TIMEOUT_MS = 5000;
let busy = false;
let entitlement = { authenticated: null, active: null };

function runtimeMessage(type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || 'Extension request failed'));
      else resolve(response.data);
    });
  });
}

function withTimeout(promise, ms = STORAGE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error('本地设置写入超时，请重试 / Settings write timed out; please retry'));
    }, ms)),
  ]);
}

function storageGetSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get('settings', (stored) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(stored?.settings || {});
    });
  });
}

function storageSetSettings(settings) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ settings }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function syncAvailability() {
  if (!toggle) return;
  const explicitlyDenied = entitlement.authenticated === false
    || (entitlement.authenticated === true && entitlement.active === false);
  toggle.disabled = busy || explicitlyDenied;
  if (busy) toggle.title = '正在切换 GPTWork，请稍候 / Updating GPTWork…';
  else if (explicitlyDenied) toggle.title = '免费期或会员已到期，请在账户中心开通会员';
  else toggle.title = '启用或关闭 GPTWork；窗口数量不受限制';
}

async function refreshState() {
  const state = await runtimeMessage('GPTLOCK_GET_STATE');
  entitlement = {
    authenticated: Boolean(state?.account?.authenticated),
    active: Boolean(state?.account?.entitlement?.active),
  };
  if (toggle) toggle.checked = state?.settings?.enabled !== false;
  syncAvailability();
  return state;
}

async function persistEnabled(desired) {
  const settings = await withTimeout(storageGetSettings());
  await withTimeout(storageSetSettings({ ...settings, enabled: desired }));
  const confirmed = await withTimeout(storageGetSettings());
  if (Boolean(confirmed.enabled) !== desired) {
    throw new Error('设置未成功保存 / The setting was not persisted');
  }
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
    // The legacy popup.js handler is bypassed so UI responsiveness does not wait
    // for Chrome Debugger/CDP attach-detach work on every open ChatGPT tab.
    event.stopImmediatePropagation();
    if (busy) return;

    const desired = Boolean(toggle.checked);
    const previous = !desired;
    busy = true;
    syncAvailability();
    if (message) message.textContent = desired
      ? '正在启用请求锁定 / Enabling…'
      : '正在关闭 GPTWork / Disabling…';

    void persistEnabled(desired)
      .then(() => {
        toggle.checked = desired;
        if (message) message.textContent = desired
          ? 'GPTWork 已启用 / Enabled.'
          : 'GPTWork 已关闭 / Disabled.';
      })
      .catch((error) => {
        toggle.checked = previous;
        if (message) message.textContent = `切换失败 / Toggle failed: ${error.message}`;
      })
      .finally(() => {
        busy = false;
        syncAvailability();
        window.dispatchEvent(new CustomEvent('gptlock-account-refresh'));
        setTimeout(() => void refreshState().catch(() => {}), 250);
      });
  }, true);
}

void refreshState().catch(() => {
  // Fail open for the control itself when account state is temporarily unknown;
  // background.js still enforces entitlement through effectiveSettingsForState().
  entitlement = { authenticated: null, active: null };
  busy = false;
  syncAvailability();
});
