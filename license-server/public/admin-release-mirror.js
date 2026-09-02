const latestVersion = document.getElementById('releaseLatestVersion');
const mirrorState = document.getElementById('releaseMirrorState');
const mirroredAt = document.getElementById('releaseMirroredAt');
const source = document.getElementById('releaseSource');
const message = document.getElementById('releaseMirrorMessage');
const warning = document.getElementById('releaseMirrorWarning');
const details = document.getElementById('releaseMirrorDetails');
const syncButton = document.getElementById('releaseSyncButton');
let lastMirrorDiagnostics = null;

const WARNING_TEXT = {
  private_release_token_required: '服务进程未检测到 GPTLOCK_GITHUB_TOKEN / GH_TOKEN。请把只读 GitHub Token 配置到 gptlock-license.service 使用的环境文件并重启服务。',
  release_feed_unavailable: '尚未取得可发布的正式 Release。请查看下方 lastError / lastTransport；可能是 GitHub Release API、HTTPS 网络或凭据不可用。',
  release_mirror_storage_unavailable: 'Release 镜像存储目录不可用。请检查持久化数据目录权限。',
  release_mirror_sync_failed: '本轮 Release 同步失败；如果已有完整镜像，客户端仍会继续使用上一次版本。',
  release_history_partial: '最新正式版已经完整发布；部分历史版本回填失败，不影响客户端检查和更新最新版本。',
};

function localDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function stateText(data) {
  if (data.latestVersion) return data.warning === 'release_history_partial' ? '可用 · 历史回填中' : '可用';
  if (data.warning === 'private_release_token_required') return '缺少 Release Token';
  if (data.warning === 'release_mirror_storage_unavailable') return '镜像存储不可用';
  if (data.warning) return '同步失败';
  return '等待首轮同步';
}

function render(data) {
  const releases = Array.isArray(data.releases) ? data.releases : [];
  const newest = releases[0] || null;
  const assetCount = releases.reduce((sum, release) => sum + (Array.isArray(release.assets) ? release.assets.length : 0), 0);
  if (data.mirror) lastMirrorDiagnostics = data.mirror;
  const mirror = data.mirror || lastMirrorDiagnostics;

  latestVersion.textContent = data.latestVersion ? `v${data.latestVersion}` : '—';
  mirrorState.textContent = stateText(data);
  mirroredAt.textContent = localDate(data.mirroredAt);
  source.textContent = data.source || 'local';
  message.textContent = data.latestVersion
    ? `官网镜像已发布 v${data.latestVersion}，客户端可以从服务端检查并下载安装更新。`
    : (WARNING_TEXT[data.warning] || '尚未发布任何完整 Release 镜像。');

  if (data.warning) {
    warning.hidden = false;
    warning.textContent = WARNING_TEXT[data.warning] || `Release 镜像警告：${data.warning}`;
  } else {
    warning.hidden = true;
    warning.textContent = '';
  }

  details.textContent = [
    `source: ${data.source || 'local'}`,
    `latestVersion: ${data.latestVersion || '—'}`,
    `mirroredAt: ${data.mirroredAt || '—'}`,
    `generation: ${data.generation || '—'}`,
    `releaseCount: ${releases.length}`,
    `assetCount: ${assetCount}`,
    `latestTag: ${newest?.tag || '—'}`,
    `warning: ${data.warning || 'none'}`,
    ...(mirror ? [
      '',
      '[transport diagnostics]',
      `tokenConfigured: ${mirror.tokenConfigured ? 'yes' : 'no'}`,
      `storageAvailable: ${mirror.storageAvailable ? 'yes' : 'no'}`,
      `transportPolicy: ${mirror.transportPolicy || 'auto'}`,
      `lastTransport: ${mirror.lastTransport || '—'}`,
      `proxyConfigured: ${mirror.proxyConfigured ? 'yes' : 'no'}`,
      `proxyInvalid: ${mirror.proxyInvalid ? 'yes' : 'no'}`,
      `lastAttemptAt: ${mirror.lastAttemptAt || '—'}`,
      `lastSuccessAt: ${mirror.lastSuccessAt || '—'}`,
      `lastErrorAt: ${mirror.lastErrorAt || '—'}`,
      `lastError: ${mirror.lastError || 'none'}`,
      `historyFailures: ${Array.isArray(mirror.historyFailures) ? mirror.historyFailures.length : 0}`,
    ] : []),
  ].join('\n');
}

async function refresh() {
  try {
    render(await api('/admin/api/releases'));
  } catch (error) {
    if (error.status === 401) return;
    mirrorState.textContent = '读取失败';
    message.textContent = error.message;
    warning.hidden = false;
    warning.textContent = `Release 镜像状态读取失败：${error.message}`;
  }
}

syncButton?.addEventListener('click', async () => {
  const original = syncButton.textContent;
  syncButton.disabled = true;
  syncButton.textContent = '同步中…';
  message.textContent = '正在从 GitHub 同步并校验最新正式 Release…';
  try {
    render(await api('/admin/api/releases/sync', { method: 'POST', body: '{}' }));
  } catch (error) {
    warning.hidden = false;
    warning.textContent = `Release 同步请求失败：${error.message}`;
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = original;
  }
});

void refresh();
setInterval(() => void refresh(), 5000);
