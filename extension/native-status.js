export const RELEASES_URL = 'https://gptlock.mv3.cn/releases';

export function classifyNativeError(error) {
  const message = String(error || '').trim().toLowerCase();
  if (!message) return null;
  if (
    message.includes('specified native messaging host not found')
    || message.includes('native messaging host not found')
    || message.includes('找不到指定的本机消息传递主机')
  ) return 'host_not_installed';
  if (
    message.includes('not allowed to connect')
    || message.includes('access to the specified native messaging host is forbidden')
    || message.includes('forbidden')
  ) return 'origin_not_allowed';
  if (message.includes('error when communicating with the native messaging host')) return 'protocol_error';
  if (
    message.includes('failed to start native messaging host')
    || message.includes('native host has exited')
    || message.includes('access is denied')
  ) return 'host_start_failed';
  return 'connection_failed';
}

export function nativeHelp(errorCode) {
  const messages = {
    host_not_installed: {
      title: '尚未安装本地核心 / Local Core is not installed',
      detail: '只加载浏览器扩展还不够。请运行 GPTLock Windows Setup 或安装 Linux deb，再完全重启浏览器。',
    },
    origin_not_allowed: {
      title: '扩展 ID 未获授权 / Extension ID is not allowed',
      detail: '请使用官方安装目录中的扩展，并运行安装器的“修复浏览器连接”。',
    },
    host_start_failed: {
      title: '本地核心无法启动 / Local Core could not start',
      detail: '请重新运行安装器修复文件与浏览器注册，然后完全重启浏览器。',
    },
    protocol_error: {
      title: '本地通信协议失败 / Native protocol failed',
      detail: '浏览器已找到并启动核心，但协议握手失败。请更新 GPTLock Core 后运行“修复浏览器连接”。',
    },
    connection_failed: {
      title: '本地核心连接失败 / Local Core connection failed',
      detail: '请运行安装器修复浏览器连接，并从本弹窗重新连接。',
    },
  };
  return messages[errorCode] || messages.connection_failed;
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  const currentWindowPromise = chrome.windows.getCurrent().then((window) => window?.id ?? null).catch(() => null);

  chrome.runtime.sendMessage = function licensedSendMessage(message, ...args) {
    if (!message || typeof message !== 'object' || Number.isInteger(message.windowId)) return originalSendMessage(message, ...args);
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const promise = currentWindowPromise.then((windowId) => originalSendMessage({ ...message, windowId }, ...args));
    if (callback) {
      promise.then(callback, () => callback(undefined));
      return undefined;
    }
    return promise;
  };

  function send(message) {
    return currentWindowPromise.then((windowId) => new Promise((resolve, reject) => {
      originalSendMessage({ ...message, windowId }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error || '授权请求失败'));
        else resolve(response.data);
      });
    }));
  }
  function expiryText(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  function buildCard() {
    const card = document.createElement('section');
    card.id = 'gptlockLicenseCard';
    card.innerHTML = `
      <div class="gptlock-license-head"><div><strong>授权验证 / License</strong><small>gptlock.mv3.cn</small></div><span id="gptlockLicenseBadge">检查中…</span></div>
      <div id="gptlockLicenseDetails" class="gptlock-license-details">正在读取授权状态…</div>
      <div id="gptlockLicenseForm" class="gptlock-license-form">
        <input id="gptlockLicenseCode" type="text" autocomplete="off" spellcheck="false" placeholder="GPTL-XXXX-XXXX-XXXX-XXXX-XXXX">
        <button id="gptlockLicenseActivate" type="button">验证授权码</button>
      </div>
      <div id="gptlockLicenseActions" class="gptlock-license-actions" hidden>
        <button id="gptlockLicenseRefresh" type="button">重新验证</button>
        <button id="gptlockLicenseDeactivate" type="button">退出授权</button>
      </div>
      <div id="gptlockLicenseMessage" class="gptlock-license-message"></div>`;
    const style = document.createElement('style');
    style.textContent = `
      #gptlockLicenseCard{margin:10px 0 12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fff}
      .gptlock-license-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.gptlock-license-head div{display:grid;gap:2px}.gptlock-license-head small{font-size:10px;color:#64748b}.gptlock-license-head span{font-size:11px;font-weight:750;padding:3px 7px;border-radius:999px;background:#f1f5f9;color:#475569}
      .gptlock-license-details{margin:8px 0;font-size:11px;line-height:1.55;color:#475569}.gptlock-license-form{display:grid;grid-template-columns:1fr auto;gap:7px}.gptlock-license-form input{min-width:0;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:600 11px/1.2 ui-monospace,monospace;text-transform:uppercase}.gptlock-license-form button,.gptlock-license-actions button{border:0;border-radius:8px;padding:8px 10px;background:#2457d6;color:white;font-size:11px;font-weight:700;cursor:pointer}.gptlock-license-actions{display:flex;gap:7px}.gptlock-license-actions[hidden]{display:none}.gptlock-license-actions button:last-child{background:#64748b}.gptlock-license-message{min-height:14px;margin-top:6px;font-size:10px;color:#b45309}`;
    document.head.append(style);
    return card;
  }
  function mount() {
    if (document.getElementById('gptlockLicenseCard')) return;
    const card = buildCard();
    const popupTarget = document.querySelector('main .enable-row');
    const optionsTarget = document.querySelector('main .hero, main header');
    if (popupTarget) popupTarget.after(card);
    else if (optionsTarget) optionsTarget.after(card);
    else document.body.prepend(card);
  }
  function controls() {
    return {
      badge: document.getElementById('gptlockLicenseBadge'), details: document.getElementById('gptlockLicenseDetails'),
      form: document.getElementById('gptlockLicenseForm'), code: document.getElementById('gptlockLicenseCode'), activate: document.getElementById('gptlockLicenseActivate'),
      actions: document.getElementById('gptlockLicenseActions'), refresh: document.getElementById('gptlockLicenseRefresh'), deactivate: document.getElementById('gptlockLicenseDeactivate'),
      message: document.getElementById('gptlockLicenseMessage'),
    };
  }
  function gateExistingUi(state) {
    const allowed = Boolean(state?.authorized && state?.windowAuthorized);
    const enable = document.getElementById('enabled');
    const autoVerify = document.getElementById('autoVerify');
    if (enable) {
      enable.disabled = !allowed;
      if (!allowed) enable.checked = false;
      enable.title = allowed ? '' : '请先验证授权码；当前窗口需要授权额度';
    }
    if (autoVerify) {
      autoVerify.disabled = !allowed;
      autoVerify.title = allowed ? '' : '请先验证授权码；当前窗口需要授权额度';
    }
  }
  function renderLicense(state) {
    const c = controls();
    const authorized = Boolean(state?.authorized);
    const windowAllowed = Boolean(state?.windowAuthorized);
    c.form.hidden = authorized;
    c.actions.hidden = !authorized;
    if (!authorized) {
      c.badge.textContent = state?.status === 'offline' ? '服务器离线' : '未授权';
      c.badge.style.background = '#fff7ed'; c.badge.style.color = '#b45309';
      c.details.textContent = state?.lastError ? `未授权。${state.lastError}` : '页面模型等被动信息仍可显示；请求锁定、自动验证和自动对齐需要授权。';
    } else if (!windowAllowed) {
      c.badge.textContent = '窗口额度已满'; c.badge.style.background = '#fef2f2'; c.badge.style.color = '#b91c1c';
      c.details.textContent = `授权有效至 ${expiryText(state.license?.expiresAt)}；设备 ${state.license?.usage?.devices ?? 0}/${state.license?.limits?.devices ?? '-'}，窗口 ${state.license?.usage?.windows ?? 0}/${state.license?.limits?.windows ?? '-'}。当前窗口未获得额度。`;
    } else {
      c.badge.textContent = state.status === 'grace' ? '临时离线授权' : '已授权'; c.badge.style.background = '#ecfdf5'; c.badge.style.color = '#047857';
      c.details.textContent = `有效至 ${expiryText(state.license?.expiresAt)}；设备 ${state.license?.usage?.devices ?? 0}/${state.license?.limits?.devices ?? '-'}，窗口 ${state.license?.usage?.windows ?? 0}/${state.license?.limits?.windows ?? '-'}`;
    }
    gateExistingUi(state);
  }
  async function refreshLicense() {
    const state = await send({ type: 'GPTLOCK_LICENSE_GET' });
    renderLicense(state);
    return state;
  }

  mount();
  const c = controls();
  c.activate.addEventListener('click', async () => {
    c.message.textContent = '正在验证授权码…'; c.activate.disabled = true;
    try { await send({ type: 'GPTLOCK_LICENSE_ACTIVATE', code: c.code.value }); c.code.value = ''; c.message.textContent = '授权成功。'; await refreshLicense(); }
    catch (error) { c.message.textContent = `授权失败：${error.message}`; }
    finally { c.activate.disabled = false; }
  });
  c.refresh.addEventListener('click', async () => {
    c.message.textContent = '正在重新验证…';
    try { await send({ type: 'GPTLOCK_LICENSE_REFRESH' }); c.message.textContent = '授权状态已刷新。'; await refreshLicense(); }
    catch (error) { c.message.textContent = `验证失败：${error.message}`; }
  });
  c.deactivate.addEventListener('click', async () => {
    c.message.textContent = '正在退出授权…';
    try { await send({ type: 'GPTLOCK_LICENSE_DEACTIVATE' }); c.message.textContent = '已退出授权。'; await refreshLicense(); }
    catch (error) { c.message.textContent = `退出失败：${error.message}`; }
  });

  void refreshLicense().catch((error) => { c.message.textContent = `授权状态读取失败：${error.message}`; gateExistingUi(null); });
}
