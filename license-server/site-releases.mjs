import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY = 'b8vipvip/GPTLock';
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=12`;
const CACHE_MS = 5 * 60 * 1000;
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.+-][A-Za-z0-9.-]+)?$/;
const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$/;

function currentVersion(serverRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(serverRoot, '..', 'extension', 'manifest.json'), 'utf8'));
    return String(manifest.version || 'unknown');
  } catch { return 'unknown'; }
}

function normalizedOrigin(value) {
  return String(value || 'https://gptlock.mv3.cn').replace(/\/$/, '');
}

function releaseAssetUrl(publicOrigin, tag, assetName) {
  return `${publicOrigin}/site/api/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

function publicRelease(release, publicOrigin) {
  const tag = String(release.tag_name || '');
  return {
    tag,
    name: String(release.name || release.tag_name || ''),
    publishedAt: release.published_at || release.created_at || null,
    assets: Array.isArray(release.assets) ? release.assets.map((asset) => ({
      name: String(asset.name || ''),
      url: releaseAssetUrl(publicOrigin, tag, String(asset.name || '')),
      size: Number(asset.size || 0),
      digest: String(asset.digest || ''),
    })).filter((asset) => asset.name && ASSET_PATTERN.test(asset.name) && TAG_PATTERN.test(tag)) : [],
  };
}

function apiError(message, status = 502, code = 'release_backend_unavailable') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function createSiteReleaseFeed({
  serverRoot,
  fetchImpl = fetch,
  env = process.env,
  publicOrigin = env.GPTLOCK_LICENSE_PUBLIC_ORIGIN || 'https://gptlock.mv3.cn',
} = {}) {
  let cache = null;
  const origin = normalizedOrigin(publicOrigin);
  const token = String(env.GPTLOCK_GITHUB_TOKEN || '').trim();

  function githubHeaders(accept = 'application/vnd.github+json') {
    const headers = {
      Accept: accept,
      'User-Agent': 'GPTLock-site/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function githubJson(url) {
    const response = await fetchImpl(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 404 && !token) {
        throw apiError('Private GitHub release feed requires GPTLOCK_GITHUB_TOKEN', 503, 'release_backend_auth_required');
      }
      throw apiError(`GitHub release feed returned ${response.status}`);
    }
    return response.json();
  }

  async function load() {
    if (cache && cache.expiresAt > Date.now()) return cache.value;
    const fallback = { ok: true, currentVersion: currentVersion(serverRoot), source: 'local', releases: [] };
    try {
      const rows = await githubJson(RELEASES_API);
      const releases = (Array.isArray(rows) ? rows : [])
        .filter((row) => !row.draft && !row.prerelease)
        .map((row) => publicRelease(row, origin));
      const value = { ok: true, currentVersion: currentVersion(serverRoot), source: 'github-private-proxy', releases };
      cache = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    } catch (error) {
      return { ...fallback, warning: error?.code || 'release_feed_unavailable' };
    }
  }

  async function latest() {
    const feed = await load();
    const release = feed.releases?.[0] || null;
    if (!release) {
      throw apiError(
        feed.warning === 'release_backend_auth_required'
          ? 'Private release backend is not authenticated'
          : 'No formal release is currently available',
        503,
        feed.warning || 'release_unavailable',
      );
    }
    return {
      tag_name: release.tag,
      name: release.name,
      html_url: `${origin}/releases`,
      draft: false,
      prerelease: false,
      published_at: release.publishedAt,
      assets: release.assets.map((asset) => ({
        name: asset.name,
        browser_download_url: asset.url,
        size: asset.size,
        digest: asset.digest,
      })),
    };
  }

  async function download(tagValue, assetNameValue) {
    const tag = String(tagValue || '').trim();
    const assetName = String(assetNameValue || '').trim();
    if (!TAG_PATTERN.test(tag) || !ASSET_PATTERN.test(assetName)) {
      throw apiError('Invalid release asset path', 400, 'invalid_release_asset');
    }
    const release = await githubJson(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`);
    if (release.draft || release.prerelease) {
      throw apiError('Release asset is unavailable', 404, 'release_asset_not_found');
    }
    const asset = Array.isArray(release.assets)
      ? release.assets.find((candidate) => candidate?.name === assetName)
      : null;
    if (!asset?.url) throw apiError('Release asset was not found', 404, 'release_asset_not_found');

    const response = await fetchImpl(asset.url, {
      headers: githubHeaders('application/octet-stream'),
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) {
      throw apiError(`GitHub release asset returned ${response.status}`, 502, 'release_asset_download_failed');
    }
    return {
      stream: response.body,
      name: assetName,
      size: Number(asset.size || response.headers.get('content-length') || 0),
      contentType: String(response.headers.get('content-type') || asset.content_type || 'application/octet-stream'),
      digest: String(asset.digest || ''),
    };
  }

  return { load, latest, download };
}
