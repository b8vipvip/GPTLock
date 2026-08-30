import {
  compareVersions,
  fetchLatestRelease,
  RELEASES_URL,
  RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION,
  supportsReliableWindowsOneClickUpdate,
  UPDATE_STATUS_KEY,
  WINDOWS_DOWNLOAD_FILENAME,
} from './update-manager.js';

const NATIVE_HOST = 'com.gptlock.core';
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;
const INSTALL_INITIAL_WAIT_MS = 10 * 1000;
const INSTALL_POLL_MS = 3 * 1000;

const el = {
  card: document.getElementById('updates'),
  badge: document.getElementById('updateStatusBadge'),
  current: document.getElementById('updateCurrentVersion'),
  latest: document.getElementById('updateLatestVersion'),
  core: document.getElementById('updateCoreVersion'),
  progress: document.getElementById('updateProgress'),
  percent: document.getElementById('updatePercent'),
  message: document.getElementById('updateMessage'),
  log: document.getElementById('updateLog'),
  check: document.getElementById('checkUpdateNow'),
  install: document.getElementById('installUpdateNow'),
  release: document.getElementById('openRelease'),
};

let platform = null;
let latestRelease = null;
let lastState = null;
let busy = false;
let currentStatus = null;
let logLines = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getPlatformInfo() {
  return new Promise((resolve) => chrome.runtime.getPlatformInfo((info) => resolve(info ?? {})));
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!Number.isInteger(downloadId)) reject(new Error('浏览器未启动安装器下载 / Browser did not start installer download'));
      else resolve(downloadId);
    });
  });
}

function findDownload(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items?.[0] ?? null);
    });
  });
}

function nativeRequest(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = `options-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let port;
    let settled = false;
    const timer = setTimeout(() => finish(reject, new Error(`Native request timed out: ${type}`)), 12000);

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch {}
      callback(value);
    }

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((response) => {
        if (String(response?.id) !== id) return;
        if (response.ok) finish(resolve, response.data);
        else finish(reject, new Error(response?.error?.messageZhCn || response?.error?.messageEn || 'Native request failed'));
      });
      port.onDisconnect.addListener(() => {
        if (!settled) finish(reject, new Error(chrome.runtime.lastError?.message || 'Native host disconnected'));
      });
      port.postMessage({ id, type, ...payload });
    } catch (error) {
      finish(reject, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function phaseLabel(phase) {
  return ({
    idle: '待检查',
    checking: '检查中',
    ready: '发现新版',
    downloading: '下载中',
    verifying: '校验中',
    installing: '安装中',
    reconnecting: '重连中',
    complete: '已完成',
    up_to_date: '已是最新',
    error: '更新失败',
  })[phase] || '更新状态';
}

function phaseTone(phase) {
  if (phase === 'error') return 'bad';
  if (phase === 'complete' || phase === 'up_to_date') return 'good';
  if (['checking', 'downloading', 'verifying', 'installing', 'reconnecting'].includes(phase)) return 'running';
  if (phase === 'ready') return 'ready';
  return 'idle';
}

function appendLog(message) {
  const stamp = new Date().toLocaleTimeString();
  logLines.push(`${stamp}  ${message}`);
  if (logLines.length > 14) logLines = logLines.slice(-14);
  el.log.textContent = logLines.join('\n') || '等待更新操作…';
  el.log.scrollTop = el.log.scrollHeight;
}

function renderStatus(status = currentStatus) {
  if (!status) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(status.percent) || 0)));
  el.progress.style.width = `${percent}%`;
  el.percent.textContent = `${percent}%`;
  el.message.textContent = status.message || '等待更新操作…';
  el.badge.textContent = phaseLabel(status.phase);
  el.badge.className = `update-badge ${phaseTone(status.phase)}`;
  if (status.targetVersion) el.latest.textContent = status.targetVersion;
  if (status.nativeVersion) el.core.textContent = status.nativeVersion;
}

async function setStatus(phase, percent, message, extra = {}) {
  currentStatus = {
    schemaVersion: 2,
    phase,
    percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
    message,
    targetVersion: extra.targetVersion ?? currentStatus?.targetVersion ?? latestRelease?.latestVersion ?? null,
    nativeVersion: extra.nativeVersion ?? currentStatus?.nativeVersion ?? lastState?.nativeStatus?.version ?? null,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  renderStatus(currentStatus);
  await chrome.storage.local.set({ [UPDATE_STATUS_KEY]: currentStatus }).catch(() => {});
  return currentStatus;
}

function setBusy(value) {
  busy = value;
  el.check.disabled = value;
  el.install.disabled = value;
}

async function loadRuntimeState() {
  lastState = await sendMessage({ type: 'GPTLOCK_GET_STATE' });
  const currentVersion = lastState?.extensionVersion || chrome.runtime.getManifest().version;
  el.current.textContent = currentVersion;
  el.core.textContent = lastState?.nativeStatus?.version || (lastState?.nativeStatus?.connected ? '已连接' : '离线');
  return lastState;
}

function oneClickCapability(state = lastState) {
  const coreVersion = state?.nativeStatus?.version ?? null;
  const connected = Boolean(state?.nativeStatus?.connected);
  const windows = platform?.os === 'win';
  return {
    windows,
    connected,
    coreVersion,
    ready: windows && connected && supportsReliableWindowsOneClickUpdate(coreVersion),
  };
}

async function waitForDownload(downloadId, targetVersion) {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  let lastReported = -1;
  while (Date.now() < deadline) {
    const item = await findDownload(downloadId);
    if (item?.state === 'complete') {
      if (item.danger && !['safe', 'accepted'].includes(item.danger)) {
        throw new Error(`浏览器安全检查阻止安装器：${item.danger} / Browser blocked installer`);
      }
      if (!item.filename) throw new Error('无法取得下载后的安装器路径 / Downloaded installer path is unavailable');
      await setStatus('downloading', 48, `安装器下载完成：${targetVersion}`, { targetVersion, downloadId });
      appendLog(`下载完成 · ${targetVersion}`);
      return item;
    }
    if (item?.state === 'interrupted') {
      throw new Error(`安装器下载中断：${item.error || 'unknown'} / Installer download interrupted`);
    }

    let percent = 24;
    if (Number(item?.totalBytes) > 0) {
      const ratio = Math.max(0, Math.min(1, Number(item.bytesReceived || 0) / Number(item.totalBytes)));
      percent = 15 + Math.round(ratio * 32);
    }
    if (percent !== lastReported) {
      lastReported = percent;
      const receivedMb = Number(item?.bytesReceived || 0) / 1024 / 1024;
      const totalMb = Number(item?.totalBytes || 0) / 1024 / 1024;
      const detail = totalMb > 0
        ? `正在下载 ${targetVersion} · ${receivedMb.toFixed(1)} / ${totalMb.toFixed(1)} MB`
        : `正在下载 ${targetVersion} · ${receivedMb.toFixed(1)} MB`;
      await setStatus('downloading', percent, detail, { targetVersion, downloadId });
    }
    await sleep(350);
  }
  throw new Error('安装器下载超时 / Installer download timed out');
}

async function waitForInstalledCore(targetVersion) {
  appendLog('安装器已启动，等待本地核心切换版本');
  await sleep(INSTALL_INITIAL_WAIT_MS);
  const startedAt = Date.now();
  const deadline = startedAt + INSTALL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const elapsed = Date.now() - startedAt;
    const percent = 72 + Math.min(22, Math.floor((elapsed / INSTALL_TIMEOUT_MS) * 22));
    await setStatus('reconnecting', percent, `正在等待新版本 Core 启动 · 第 ${attempt} 次重连`, { targetVersion });
    try {
      await sendMessage({ type: 'GPTLOCK_RECONNECT' });
      const state = await loadRuntimeState();
      const nativeVersion = state?.nativeStatus?.version;
      if (state?.nativeStatus?.connected && compareVersions(nativeVersion, targetVersion) >= 0) {
        appendLog(`本地核心已切换到 ${nativeVersion}`);
        return state;
      }
    } catch {
      // The installer temporarily stops the native host; retry until the deadline.
    }
    await sleep(INSTALL_POLL_MS);
  }
  throw new Error('等待新版本本地核心启动超时；请完全重启浏览器 / Timed out waiting for updated core');
}

async function installReleaseInternal(release, initialState = lastState) {
  platform ??= await getPlatformInfo();
  const capability = oneClickCapability(initialState);
  if (!capability.windows) {
    throw new Error('当前系统暂不支持一键静默安装，请使用正式发布包 / One-click install is currently Windows-only');
  }
  if (!capability.connected) {
    throw new Error('本地核心离线，无法安全执行一键更新；请先重新连接 / Native Core is offline');
  }
  if (!capability.ready) {
    throw new Error(`Core ${capability.coreVersion || '未知'} 低于安全更新基线 ${RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION}，请先从正式发布页升级一次`);
  }

  appendLog(`开始一键更新 ${release.currentVersion} → ${release.latestVersion}`);
  await setStatus('downloading', 15, `准备下载 ${release.latestVersion} 安装器…`, {
    targetVersion: release.latestVersion,
    startedAt: new Date().toISOString(),
  });
  const downloadId = await downloadFile({
    url: release.installer.url,
    filename: WINDOWS_DOWNLOAD_FILENAME,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  const download = await waitForDownload(downloadId, release.latestVersion);

  await setStatus('verifying', 55, '正在校验 SHA-256，并准备静默安装…', {
    targetVersion: release.latestVersion,
    downloadId,
  });
  appendLog('开始校验 GitHub Release 安装器 SHA-256');
  const prepared = await nativeRequest('prepare_update', {
    update: {
      installerPath: download.filename,
      expectedSha256: release.installer.sha256,
      targetVersion: release.latestVersion,
    },
  });
  appendLog(`校验通过 · 签名状态 ${prepared?.signatureStatus || 'Unknown'}`);

  await setStatus('installing', 68, `正在后台安装 ${release.latestVersion}；Core 会短暂断开`, {
    targetVersion: release.latestVersion,
    installRoot: prepared?.installRoot ?? null,
    helperLogPath: prepared?.helperLogPath ?? null,
  });

  const updatedState = await waitForInstalledCore(release.latestVersion);
  const nativeVersion = updatedState?.nativeStatus?.version ?? null;
  await setStatus('complete', 100, `更新完成：${release.latestVersion}。正在重新加载扩展…`, {
    targetVersion: release.latestVersion,
    nativeVersion,
    completedAt: new Date().toISOString(),
  });
  appendLog(`更新完成 · Core ${nativeVersion || release.latestVersion}`);
  await sleep(1200);
  chrome.runtime.reload();
}

async function checkForUpdates({ autoInstall = false } = {}) {
  if (busy) return latestRelease;
  setBusy(true);
  try {
    platform ??= await getPlatformInfo();
    await loadRuntimeState();
    const currentVersion = chrome.runtime.getManifest().version;
    await setStatus('checking', 5, '正在检查 GitHub 正式版本…', { targetVersion: null });
    appendLog(`检查更新 · 当前 ${currentVersion}`);

    latestRelease = await fetchLatestRelease(currentVersion);
    el.latest.textContent = latestRelease.latestVersion;
    if (!latestRelease.updateAvailable) {
      el.install.hidden = true;
      await setStatus('up_to_date', 100, `当前 ${currentVersion} 已是最新正式版`, {
        targetVersion: latestRelease.latestVersion,
      });
      appendLog('当前版本已是最新正式版');
      return latestRelease;
    }

    const capability = oneClickCapability();
    el.install.hidden = false;
    el.install.textContent = capability.ready ? '立即更新' : '查看升级方式';
    const message = capability.ready
      ? `发现 ${latestRelease.latestVersion}，Windows 一键更新已就绪`
      : capability.windows
        ? `发现 ${latestRelease.latestVersion}；Core ${capability.coreVersion || '未知'} 暂不满足一键更新条件`
        : `发现 ${latestRelease.latestVersion}；当前系统请使用正式发布包`;
    await setStatus('ready', 12, message, { targetVersion: latestRelease.latestVersion });
    appendLog(`发现新版本 ${latestRelease.latestVersion}`);

    if (autoInstall && capability.ready) {
      await installReleaseInternal(latestRelease, lastState);
    }
    return latestRelease;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus('error', currentStatus?.percent || 0, `更新失败：${message}`, {
      error: message,
      failedAt: new Date().toISOString(),
    });
    appendLog(`失败 · ${message}`);
    throw error;
  } finally {
    setBusy(false);
  }
}

async function installLatest() {
  if (busy) return;
  if (!latestRelease?.updateAvailable) {
    await checkForUpdates({ autoInstall: true });
    return;
  }
  setBusy(true);
  try {
    platform ??= await getPlatformInfo();
    await loadRuntimeState();
    const capability = oneClickCapability();
    if (!capability.ready) {
      if (!capability.windows) {
        await setStatus('ready', 12, '当前系统请从正式发布页安装最新版本', { targetVersion: latestRelease.latestVersion });
      } else {
        await setStatus('ready', 12, `Core ${capability.coreVersion || '未知'} 低于一键更新安全基线 ${RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION}`, { targetVersion: latestRelease.latestVersion });
      }
      return;
    }
    await installReleaseInternal(latestRelease, lastState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus('error', currentStatus?.percent || 0, `更新失败：${message}`, {
      error: message,
      failedAt: new Date().toISOString(),
    });
    appendLog(`失败 · ${message}`);
  } finally {
    setBusy(false);
  }
}

async function restoreStoredStatus() {
  const stored = await chrome.storage.local.get(UPDATE_STATUS_KEY);
  currentStatus = stored[UPDATE_STATUS_KEY] ?? {
    schemaVersion: 2,
    phase: 'idle',
    percent: 0,
    message: '尚未检查更新',
    targetVersion: null,
  };
  renderStatus(currentStatus);

  const currentVersion = chrome.runtime.getManifest().version;
  if (currentStatus.phase === 'complete' && currentStatus.targetVersion && compareVersions(currentVersion, currentStatus.targetVersion) >= 0) {
    el.current.textContent = currentVersion;
  }
}

function openReleasePage() {
  void chrome.tabs.create({ url: latestRelease?.releaseUrl || RELEASES_URL });
}

el.check.addEventListener('click', () => void checkForUpdates().catch(() => {}));
el.install.addEventListener('click', () => void installLatest());
el.release.addEventListener('click', openReleasePage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[UPDATE_STATUS_KEY]?.newValue) return;
  const incoming = changes[UPDATE_STATUS_KEY].newValue;
  if (incoming?.schemaVersion !== 2) return;
  currentStatus = incoming;
  renderStatus(currentStatus);
});

async function init() {
  el.current.textContent = chrome.runtime.getManifest().version;
  await restoreStoredStatus();
  await Promise.all([
    getPlatformInfo().then((info) => { platform = info; }),
    loadRuntimeState().catch(() => null),
  ]);

  if (location.hash === '#updates-auto') {
    el.card?.scrollIntoView({ block: 'start' });
    await sleep(100);
    void checkForUpdates({ autoInstall: true }).catch(() => {});
  } else if (location.hash === '#updates') {
    el.card?.scrollIntoView({ block: 'start' });
  }
}

void init().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  void setStatus('error', 0, `更新中心初始化失败：${message}`, { error: message });
});
