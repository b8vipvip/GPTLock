import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASES_API = 'https://api.github.com/repos/b8vipvip/GPTLock/releases?per_page=12';
const RELEASES_PAGE = 'https://github.com/b8vipvip/GPTLock/releases';
const CACHE_MS = 5 * 60 * 1000;

function currentVersion(serverRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(serverRoot, '..', 'extension', 'manifest.json'), 'utf8'));
    return String(manifest.version || 'unknown');
  } catch { return 'unknown'; }
}

function publicRelease(release) {
  return {
    tag: String(release.tag_name || ''),
    name: String(release.name || release.tag_name || ''),
    publishedAt: release.published_at || release.created_at || null,
    url: String(release.html_url || RELEASES_PAGE),
    notes: String(release.body || '').slice(0, 12000),
    assets: Array.isArray(release.assets) ? release.assets.map((asset) => ({
      name: String(asset.name || ''),
      url: String(asset.browser_download_url || ''),
      size: Number(asset.size || 0),
      digest: String(asset.digest || ''),
    })).filter((asset) => asset.name && asset.url) : [],
  };
}

export function createSiteReleaseFeed({ serverRoot, fetchImpl = fetch }) {
  let cache = null;

  async function load() {
    if (cache && cache.expiresAt > Date.now()) return cache.value;
    const fallback = { ok: true, currentVersion: currentVersion(serverRoot), source: 'local', githubUrl: RELEASES_PAGE, releases: [] };
    try {
      const response = await fetchImpl(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GPTLock-site/1.0', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub release feed returned ${response.status}`);
      const rows = await response.json();
      const releases = (Array.isArray(rows) ? rows : []).filter((row) => !row.draft && !row.prerelease).map(publicRelease);
      const value = { ok: true, currentVersion: currentVersion(serverRoot), source: 'github', githubUrl: RELEASES_PAGE, releases };
      cache = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    } catch (error) {
      return { ...fallback, warning: String(error?.message || error).slice(0, 240) };
    }
  }

  return { load };
}
