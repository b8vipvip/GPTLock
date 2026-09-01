import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const RELEASES_API = 'https://api.github.com/repos/b8vipvip/GPTLock/releases?per_page=12';
const DEFAULT_ORIGIN = 'https://gptlock.mv3.cn';
const DEFAULT_SYNC_MS = 60 * 1000;
const MAX_NOTIFICATION_WAIT_MS = 25 * 1000;
const SAFE_TAG = /^v\d+(?:\.\d+){1,3}$/i;
const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._+()-]{0,159}$/;
const CONTENT_TYPES = new Map([
  ['.exe', 'application/octet-stream'],
  ['.zip', 'application/zip'],
  ['.gz', 'application/gzip'],
  ['.deb', 'application/vnd.debian.binary-package'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function currentVersion(serverRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(serverRoot, '..', 'extension', 'manifest.json'), 'utf8'));
    return String(manifest.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || DEFAULT_ORIGIN));
    if (url.protocol !== 'https:') return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicJson(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function digestValue(value) {
  const match = String(value || '').trim().match(/^sha256:([0-9a-f]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function contentType(name) {
  const lower = String(name || '').toLowerCase();
  for (const [suffix, type] of CONTENT_TYPES) {
    if (lower.endsWith(suffix)) return type;
  }
  return 'application/octet-stream';
}

function generationFor(releases) {
  const latest = releases[0] || null;
  const fingerprint = latest ? {
    tag: latest.tag,
    publishedAt: latest.publishedAt,
    assets: latest.assets.map((asset) => [asset.name, asset.digest, asset.size]),
  } : null;
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 24);
}

function safeReleaseRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !row?.draft && !row?.prerelease && SAFE_TAG.test(String(row?.tag_name || '')))
    .slice(0, 12);
}

export function createSiteReleaseFeed({ serverRoot, fetchImpl = fetch, env = process.env }) {
  const token = String(env.GPTLOCK_GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  const publicOrigin = normalizeOrigin(env.GPTLOCK_LICENSE_PUBLIC_ORIGIN);
  const mirrorRoot = resolve(env.GPTLOCK_RELEASE_MIRROR_DIR || join(serverRoot, 'data', 'releases'));
  const indexPath = join(mirrorRoot, 'index.json');
  const syncIntervalMs = Math.max(30_000, Number(env.GPTLOCK_RELEASE_SYNC_INTERVAL_MS || DEFAULT_SYNC_MS));
  const currentProductVersion = currentVersion(serverRoot);
  const waiters = new Set();
  let timer = null;
  let syncing = null;
  let cache = null;

  mkdirSync(mirrorRoot, { recursive: true, mode: 0o700 });

  function githubHeaders(accept = 'application/vnd.github+json') {
    const headers = {
      Accept: accept,
      'User-Agent': 'GPTLock-release-mirror/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function normalizedIndex(raw = {}) {
    const releases = Array.isArray(raw.releases) ? raw.releases : [];
    return {
      ok: true,
      currentVersion: currentProductVersion,
      source: releases.length ? 'server-mirror' : 'local',
      generation: String(raw.generation || generationFor(releases)),
      mirroredAt: raw.mirroredAt || null,
      latestVersion: releases[0]?.tag?.replace(/^v/i, '') || null,
      releases,
      ...(raw.warning ? { warning: raw.warning } : {}),
    };
  }

  function loadIndex() {
    if (cache) return cache;
    cache = normalizedIndex(readJson(indexPath, {}));
    return cache;
  }

  function notifyWaiters(next) {
    for (const resolveWaiter of waiters) resolveWaiter(next);
    waiters.clear();
  }

  function publishIndex(releases) {
    const previous = loadIndex();
    const generation = generationFor(releases);
    const next = normalizedIndex({
      generation,
      mirroredAt: new Date().toISOString(),
      releases,
    });
    atomicJson(indexPath, next);
    cache = next;
    if (generation !== previous.generation) notifyWaiters(next);
    return next;
  }

  async function downloadAsset(releaseTag, asset) {
    const name = basename(String(asset?.name || ''));
    if (!SAFE_ASSET.test(name) || name !== String(asset?.name || '')) {
      throw new Error(`Unsafe release asset name: ${asset?.name || ''}`);
    }
    const apiUrl = String(asset?.url || '');
    if (!apiUrl.startsWith('https://api.github.com/')) {
      throw new Error(`Untrusted release asset API URL: ${name}`);
    }
    const releaseDir = join(mirrorRoot, releaseTag);
    mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
    const destination = join(releaseDir, name);
    const expectedDigest = digestValue(asset?.digest);
    const expectedSize = Math.max(0, Number(asset?.size || 0));

    if (existsSync(destination)) {
      const size = statSync(destination).size;
      const actualDigest = sha256File(destination);
      if ((!expectedSize || size === expectedSize) && (!expectedDigest || actualDigest === expectedDigest)) {
        return {
          name,
          url: `${publicOrigin}/downloads/releases/${encodeURIComponent(releaseTag)}/${encodeURIComponent(name)}`,
          size,
          digest: `sha256:${actualDigest}`,
        };
      }
    }

    const response = await fetchImpl(apiUrl, {
      headers: githubHeaders('application/octet-stream'),
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`GitHub asset download failed (${response.status}): ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (expectedSize && bytes.length !== expectedSize) {
      throw new Error(`Release asset size mismatch: ${name}`);
    }
    const actualDigest = sha256Buffer(bytes);
    if (expectedDigest && actualDigest !== expectedDigest) {
      throw new Error(`Release asset SHA-256 mismatch: ${name}`);
    }
    const tmp = `${destination}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o644 });
    renameSync(tmp, destination);
    return {
      name,
      url: `${publicOrigin}/downloads/releases/${encodeURIComponent(releaseTag)}/${encodeURIComponent(name)}`,
      size: bytes.length,
      digest: `sha256:${actualDigest}`,
    };
  }

  async function mirrorRelease(release) {
    const tag = String(release.tag_name || '');
    if (!SAFE_TAG.test(tag)) throw new Error(`Unsafe release tag: ${tag}`);
    const assets = [];
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      assets.push(await downloadAsset(tag, asset));
    }
    return {
      tag,
      name: String(release.name || tag),
      publishedAt: release.published_at || release.created_at || null,
      assets,
    };
  }

  async function syncOnce() {
    if (!token) {
      const current = loadIndex();
      return { ...current, warning: 'private_release_token_required' };
    }
    const response = await fetchImpl(RELEASES_API, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub release feed returned ${response.status}`);
    const rows = safeReleaseRows(await response.json());
    if (!rows.length) return publishIndex([]);

    // The newest formal release is authoritative. It must mirror completely before
    // clients are notified, but historical archive failures must never block it.
    const releases = [await mirrorRelease(rows[0])];
    publishIndex(releases);

    for (const row of rows.slice(1)) {
      try {
        releases.push(await mirrorRelease(row));
      } catch {
        // Historical releases are best-effort archive data. Their failure does not
        // roll back or delay an already verified newest release.
      }
    }
    return publishIndex(releases);
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = syncOnce()
      .catch((error) => {
        const current = loadIndex();
        return {
          ...current,
          warning: current.releases.length ? 'release_mirror_sync_failed' : 'release_feed_unavailable',
          syncError: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => { syncing = null; });
    return syncing;
  }

  function start() {
    if (timer) return;
    void sync();
    timer = setInterval(() => void sync(), syncIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function waitForChange(since, waitMs = MAX_NOTIFICATION_WAIT_MS) {
    const current = loadIndex();
    const normalizedSince = String(since || '');
    if ((normalizedSince && normalizedSince !== current.generation) || (!normalizedSince && current.releases.length)) {
      return { changed: true, feed: current };
    }
    const timeout = Math.max(0, Math.min(MAX_NOTIFICATION_WAIT_MS, Number(waitMs || 0)));
    if (!timeout) return { changed: false, feed: current };
    return await new Promise((resolveWait) => {
      let settled = false;
      const finish = (feed, changed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        waiters.delete(onChange);
        resolveWait({ changed, feed });
      };
      const onChange = (feed) => finish(feed, true);
      const timeoutId = setTimeout(() => finish(loadIndex(), false), timeout);
      waiters.add(onChange);
    });
  }

  function serveAsset(req, res, pathname) {
    const prefix = '/downloads/releases/';
    if (!String(pathname || '').startsWith(prefix)) return false;
    let tag;
    let name;
    try {
      const parts = pathname.slice(prefix.length).split('/');
      if (parts.length !== 2) return false;
      tag = decodeURIComponent(parts[0]);
      name = decodeURIComponent(parts[1]);
    } catch {
      return false;
    }
    if (!SAFE_TAG.test(tag) || !SAFE_ASSET.test(name) || basename(name) !== name) return false;
    const feed = loadIndex();
    const release = feed.releases.find((item) => item.tag === tag);
    const asset = release?.assets?.find((item) => item.name === name);
    if (!asset) return false;
    const path = join(mirrorRoot, tag, name);
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    const headers = {
      'content-type': contentType(name),
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      etag: `"${String(asset.digest || '').replace(/^sha256:/, '')}"`,
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end(), true;
    createReadStream(path).pipe(res);
    return true;
  }

  async function load() {
    return loadIndex();
  }

  function notificationPayload(result) {
    const latest = result.feed.releases[0] || null;
    return {
      ok: true,
      changed: Boolean(result.changed && latest),
      generation: result.feed.generation,
      latestVersion: result.feed.latestVersion,
      publishedAt: latest?.publishedAt || null,
      mirroredAt: result.feed.mirroredAt || null,
    };
  }

  return {
    load,
    sync,
    start,
    stop,
    waitForChange,
    notificationPayload,
    serveAsset,
    mirrorRoot,
  };
}
