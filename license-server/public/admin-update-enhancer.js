const updateUi = {
  productVersion: document.getElementById('productVersion'),
  updaterState: document.getElementById('updaterState'),
  bootstrap: document.getElementById('updateBootstrap'),
  bootstrapCommand: document.getElementById('updateBootstrapCommand'),
  copyBootstrap: document.getElementById('copyUpdateBootstrap'),
  updateButton: document.getElementById('updateButton'),
  updateWarning: document.getElementById('updateWarning'),
};

let lastProductVersion = '';
let lastUpdaterReady = false;
let refreshTimer = null;

function updaterLabel(data) {
  if (data.updaterReady) return '已就绪';
  if (data.updater?.installed) return data.updater?.active ? '已安装' : '已安装 / 未运行';
  return '未安装';
}

function renderEnhancement(data) {
  lastProductVersion = String(data.productVersion || 'unknown');
  lastUpdaterReady = Boolean(data.updaterReady);
  if (updateUi.productVersion) updateUi.productVersion.textContent = lastProductVersion;
  if (updateUi.updaterState) {
    updateUi.updaterState.textContent = updaterLabel(data);
    updateUi.updaterState.className = data.updaterReady ? 'tone-good' : 'tone-wait';
  }

  const bootstrapCommand = String(data.bootstrapCommand || '').trim();
  const needsBootstrap = !data.updaterReady && Boolean(bootstrapCommand);
  if (updateUi.bootstrap) updateUi.bootstrap.hidden = !needsBootstrap;
  if (updateUi.bootstrapCommand) updateUi.bootstrapCommand.value = needsBootstrap ? bootstrapCommand : '';

  const active = ['queued', 'running', 'restarting', 'rolling_back'].includes(String(data.status?.status || ''));
  if (updateUi.updateButton && !active) {
    updateUi.updateButton.textContent = '一键更新服务端';
    updateUi.updateButton.disabled = !data.updaterReady;
  }

  if (!data.updaterReady && updateUi.updateWarning && String(data.status?.status || '') !== 'failed') {
    updateUi.updateWarning.hidden = false;
    updateUi.updateWarning.textContent = data.updater?.installed
      ? '服务端更新器已安装，但 systemd watcher 当前未运行。请在服务器执行下方安装/修复命令后刷新。'
      : '首次使用一键更新，需要在服务器终端执行下方命令一次；以后即可直接从本页面更新。';
  }
}

async function refreshEnhancement() {
  try {
    const response = await fetch('/admin/api/update', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    renderEnhancement(await response.json());
  } catch {}
}

async function copyBootstrapCommand() {
  const value = updateUi.bootstrapCommand?.value || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const original = updateUi.copyBootstrap.textContent;
    updateUi.copyBootstrap.textContent = '已复制';
    setTimeout(() => { updateUi.copyBootstrap.textContent = original; }, 1200);
  } catch {
    updateUi.bootstrapCommand.focus();
    updateUi.bootstrapCommand.select();
    if (updateUi.updateWarning) {
      updateUi.updateWarning.hidden = false;
      updateUi.updateWarning.textContent = '浏览器未允许自动写入剪贴板，命令已选中，请按 Ctrl+C 复制。';
    }
  }
}

updateUi.copyBootstrap?.addEventListener('click', () => void copyBootstrapCommand());

// admin.js owns the update transaction and its 1-second progress polling. This
// small page-specific companion only supplies updater readiness/product-version
// details so the shared admin bundle does not need page-specific branching.
const productObserver = new MutationObserver(() => {
  if (updateUi.productVersion && lastProductVersion && updateUi.productVersion.textContent !== lastProductVersion) {
    updateUi.productVersion.textContent = lastProductVersion;
  }
  if (updateUi.updateButton && !lastUpdaterReady && updateUi.updateButton.textContent === '版本更新') {
    updateUi.updateButton.textContent = '一键更新服务端';
  }
});
productObserver.observe(document.body, { subtree: true, childList: true, characterData: true });

refreshTimer = setInterval(() => void refreshEnhancement(), 1500);
window.addEventListener('pagehide', () => {
  if (refreshTimer) clearInterval(refreshTimer);
  productObserver.disconnect();
}, { once: true });
void refreshEnhancement();
