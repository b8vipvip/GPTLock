export const RELEASE_API_URL = 'https://api.github.com/repos/b8vipvip/GPTLock/releases/latest';
export const RELEASES_URL = 'https://github.com/b8vipvip/GPTLock/releases/latest';
export const WINDOWS_INSTALLER_NAME = 'GPTLockSetup-x64.exe';
export const WINDOWS_DOWNLOAD_FILENAME = 'GPTLock/GPTLockSetup-x64.exe';

function numericParts(value) {
  const normalized = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){1,3}$/.test(normalized)) return null;
  return normalized.split('.').map((part) => Number.parseInt(part, 10));
}

export function normalizeVersion(value) {
  const parts = numericParts(value);
  return parts ? parts.join('.') : null;
}

export function compareVersions(left, right) {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  if (!leftParts || !rightParts) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function sha256FromDigest(value) {
  const match = String(value || '').trim().match(/^sha256:([0-9a-f]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

export function parseLatestRelease(release, currentVersion) {
  if (!release || release.draft || release.prerelease) {
    throw new Error('Latest GitHub release is unavailable / 最新正式版本不可用');
  }
  const latestVersion = normalizeVersion(release.tag_name);
  const normalizedCurrent = normalizeVersion(currentVersion);
  if (!latestVersion || !normalizedCurrent) {
    throw new Error('Release version is invalid / 发布版本号无效');
  }
  const installerAsset = Array.isArray(release.assets)
    ? release.assets.find((asset) => asset?.name === WINDOWS_INSTALLER_NAME)
    : null;
  const installerSha256 = sha256FromDigest(installerAsset?.digest);
  const installerUrl = typeof installerAsset?.browser_download_url === 'string'
    ? installerAsset.browser_download_url
    : null;
  if (!installerAsset || !installerUrl || !installerSha256) {
    throw new Error('Latest release is missing a verified Windows installer / 最新版本缺少可校验的 Windows 安装器');
  }
  const comparison = compareVersions(latestVersion, normalizedCurrent);
  return {
    currentVersion: normalizedCurrent,
    latestVersion,
    tag: String(release.tag_name || `v${latestVersion}`),
    releaseUrl: typeof release.html_url === 'string' ? release.html_url : RELEASES_URL,
    updateAvailable: comparison === 1,
    installer: {
      name: WINDOWS_INSTALLER_NAME,
      url: installerUrl,
      sha256: installerSha256,
      size: Number.isFinite(installerAsset.size) ? installerAsset.size : null,
    },
  };
}

export async function fetchLatestRelease(currentVersion, fetchImpl = fetch) {
  const response = await fetchImpl(RELEASE_API_URL, {
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub update check failed (${response.status}) / GitHub 更新检查失败`);
  }
  return parseLatestRelease(await response.json(), currentVersion);
}
