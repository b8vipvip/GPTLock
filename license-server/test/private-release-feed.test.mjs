import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSiteReleaseFeed } from '../site-releases.mjs';

const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'github_pat_private_release_read_only_test_secret';
const ORIGIN = 'https://gptlock.mv3.cn';
const INSTALLER = 'GPTLockSetup-x64.exe';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function releaseRow({ tag = 'v0.5.30', assets }) {
  return [{
    tag_name: tag,
    name: `GPTLock ${tag}`,
    body: `Release notes for ${tag}`,
    draft: false,
    prerelease: false,
    published_at: '2026-09-01T00:00:00Z',
    assets,
  }];
}

function asset(name, id, bytes) {
  return {
    name,
    url: `https://api.github.com/repos/b8vipvip/GPTLock/releases/assets/${id}`,
    browser_download_url: `https://github.com/b8vipvip/GPTLock/releases/download/v0.5.30/${name}`,
    size: bytes.length,
    digest: `sha256:${sha256(bytes)}`,
  };
}

function testFeed({ mirrorRoot, currentRelease }) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/releases?per_page=12')) {
      return new Response(JSON.stringify(currentRelease()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const found = currentRelease()[0]?.assets?.find((item) => item.url === String(url));
    if (!found) throw new Error(`Unexpected URL: ${url}`);
    const bytes = currentRelease().bytesByName[found.name];
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  };
  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    fetchImpl,
    env: {
      GPTLOCK_GITHUB_TOKEN: TOKEN,
      GPTLOCK_LICENSE_PUBLIC_ORIGIN: ORIGIN,
      GPTLOCK_RELEASE_MIRROR_DIR: mirrorRoot,
      GPTLOCK_RELEASE_SYNC_INTERVAL_MS: '60000',
    },
  });
  return { feed, calls };
}

function fixture(tag = 'v0.5.30') {
  const installer = Buffer.from(`installer-${tag}`);
  const extension = Buffer.from(`extension-${tag}`);
  const sums = Buffer.from(`${sha256(installer)}  ${INSTALLER}\n${sha256(extension)}  gptlock-extension-${tag.slice(1)}.zip\n`);
  const rows = releaseRow({
    tag,
    assets: [
      asset(INSTALLER, 101, installer),
      asset(`gptlock-extension-${tag.slice(1)}.zip`, 102, extension),
      asset('SHA256SUMS.txt', 103, sums),
    ],
  });
  rows.bytesByName = {
    [INSTALLER]: installer,
    [`gptlock-extension-${tag.slice(1)}.zip`]: extension,
    'SHA256SUMS.txt': sums,
  };
  return rows;
}

test('private GitHub releases are fully mirrored to the official server with verified digests', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-mirror-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));
  let rows = fixture();
  const { feed, calls } = testFeed({ mirrorRoot, currentRelease: () => rows });

  const result = await feed.sync();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'server-mirror');
  assert.equal(result.latestVersion, '0.5.30');
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].assets.length, 3);
  assert.match(result.generation, /^[0-9a-f]{24}$/);

  for (const mirrored of result.releases[0].assets) {
    assert.equal(
      mirrored.url,
      `${ORIGIN}/downloads/releases/v0.5.30/${encodeURIComponent(mirrored.name)}`,
    );
    const path = join(mirrorRoot, 'v0.5.30', mirrored.name);
    assert.equal(existsSync(path), true);
    assert.equal(`sha256:${sha256(readFileSync(path))}`, mirrored.digest);
  }
  assert.equal(existsSync(join(mirrorRoot, 'index.json')), true);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls.slice(1).every((call) => call.options.headers.Authorization === `Bearer ${TOKEN}`), true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(result), /release-assets\.githubusercontent\.com/);
});

test('a second sync reuses already verified local assets instead of downloading them again', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-reuse-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));
  const rows = fixture();
  const { feed, calls } = testFeed({ mirrorRoot, currentRelease: () => rows });

  await feed.sync();
  const firstAssetCalls = calls.filter((call) => call.url.includes('/releases/assets/')).length;
  await feed.sync();
  const secondAssetCalls = calls.filter((call) => call.url.includes('/releases/assets/')).length;

  assert.equal(firstAssetCalls, 3);
  assert.equal(secondAssetCalls, 3);
});

test('mirror publication is atomic when any release asset fails verification', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-atomic-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));
  const rows = fixture();
  rows[0].assets[1].digest = `sha256:${'0'.repeat(64)}`;
  const { feed } = testFeed({ mirrorRoot, currentRelease: () => rows });

  const result = await feed.sync();
  assert.equal(result.source, 'local');
  assert.equal(result.warning, 'release_feed_unavailable');
  assert.deepEqual(result.releases, []);
  assert.equal(existsSync(join(mirrorRoot, 'index.json')), false);
});

test('notification wait resolves when a newly mirrored release changes the generation', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-notify-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));
  let rows = fixture('v0.5.30');
  const { feed } = testFeed({ mirrorRoot, currentRelease: () => rows });
  const first = await feed.sync();

  const pending = feed.waitForChange(first.generation, 2_000);
  rows = fixture('v0.5.31');
  await feed.sync();
  const notification = await pending;
  const payload = feed.notificationPayload(notification);

  assert.equal(payload.changed, true);
  assert.equal(payload.latestVersion, '0.5.31');
  assert.notEqual(payload.generation, first.generation);
});

test('private repository without a server token never contacts GitHub and safely serves the local mirror state', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-no-token-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));
  let calls = 0;
  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    env: {
      GPTLOCK_LICENSE_PUBLIC_ORIGIN: ORIGIN,
      GPTLOCK_RELEASE_MIRROR_DIR: mirrorRoot,
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  });

  const result = await feed.sync();
  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'local');
  assert.equal(result.warning, 'private_release_token_required');
  assert.deepEqual(result.releases, []);
});
