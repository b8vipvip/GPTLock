import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASES_API = 'https://api.github.com/repos/b8vipvip/GPTLock/releases?per_page=12';
const CACHE_MS = 5 * 60 * 1000;
const DOWNLOAD_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

function currentVersion(serverRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(serverRoot, '..', 'extension', 'manifest.json'), 'utf8'));
    return String(manifest.version || 'unknown');
  } catch { return 'unknown'; }
}

function safeDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return null;
    if (DOWNLOAD_HOSTS.has(url.hostname) || url.hostname.endsWith('.githubusercontent.com')) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function createSiteReleaseFeed({ serverRoot, fetchImpl = fetch, env = process.env }) {
  let cache = null;
  const token = String(env.GPTLOCK_GITHUB_TOKEN || env.GH_TOKEN || '').trim();

  function githubHeaders(accept = 'application/vnd.github+json') {
    const headers = {
      Accept: accept,
      'User-Agent': 'GPTLock-site/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function resolveAssetUrl(asset) {
    const publicUrl = String(asset?.browser_download_url || '');
    if (!token) return publicUrl;
    const apiUrl = String(asset?.url || '');
    if (!apiUrl.startsWith('https://api.github.com/')) return '';
    try {
      const response = await fetchImpl(apiUrl, {
        headers: githubHeaders('application/octet-stream'),
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      const location = safeDownloadUrl(response.headers.get('location'));
      if (location) return location;
      const finalUrl = safeDownloadUrl(response.url);
      if (response.ok && finalUrl) return finalUrl;
      return '';
    } catch {
      return '';
    }
  }

  async function publicRelease(release) {
    const rawAssets = Array.isArray(release.assets) ? release.assets : [];
    const assets = await Promise.all(rawAssets.map(async (asset) => ({
      name: String(asset.name || ''),
      url: await resolveAssetUrl(asset),
      size: Number(asset.size || 0),
      digest: String(asset.digest || ''),
    })));
    return {
      tag: String(release.tag_name || ''),
      name: String(release.name || release.tag_name || ''),
      publishedAt: release.published_at || release.created_at || null,
      assets: assets.filter((asset) => asset.name && asset.url),
    };
  }

  async function load() {
    if (cache && cache.expiresAt > Date.now()) return cache.value;
    const fallback = { ok: true, currentVersion: currentVersion(serverRoot), source: 'local', releases: [] };
    try {
      const response = await fetchImpl(RELEASES_API, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub release feed returned ${response.status}`);
      const rows = await response.json();
      const formal = (Array.isArray(rows) ? rows : []).filter((row) => !row.draft && !row.prerelease);
      const releases = await Promise.all(formal.map(publicRelease));
      const value = {
        ok: true,
        currentVersion: currentVersion(serverRoot),
        source: token ? 'github-private' : 'github',
        releases,
      };
      cache = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    } catch {
      return {
        ...fallback,
        warning: token ? 'release_feed_unavailable' : 'private_release_token_required',
      };
    }
  }

  return { load };
}
