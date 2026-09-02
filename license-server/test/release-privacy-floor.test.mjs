import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSiteReleaseFeed } from '../site-releases.mjs';

const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'github_pat_release_privacy_floor_test';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function row(tag, id, bytes) {
  return {
    tag_name: tag,
    name: `GPTLock ${tag}`,
    draft: false,
    prerelease: false,
    published_at: '2026-09-02T00:00:00Z',
    assets: [{
      id,
      name: `gptlock-${tag.slice(1)}.zip`,
      url: `https://api.github.com/repos/b8vipvip/GPTLock/releases/assets/${id}`,
      size: bytes.length,
      digest: digest(bytes),
    }],
  };
}

test('public mirror permanently excludes and removes releases older than v0.5.30', async (t) => {
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'gptlock-release-privacy-floor-'));
  t.after(() => rmSync(mirrorRoot, { recursive: true, force: true }));

  const oldDir = join(mirrorRoot, 'v0.5.29');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'private-old.zip'), 'private-history');
  writeFileSync(join(mirrorRoot, 'index.json'), JSON.stringify({
    generation: 'legacy-generation',
    mirroredAt: '2026-08-31T00:00:00Z',
    releases: [{
      tag: 'v0.5.29',
      name: 'private historical release',
      publishedAt: '2026-08-31T00:00:00Z',
      assets: [{ name: 'private-old.zip', url: 'https://gptlock.mv3.cn/downloads/releases/v0.5.29/private-old.zip', size: 15, digest: digest(Buffer.from('private-history')) }],
    }],
  }));

  const currentBytes = Buffer.from('public-v0.5.30');
  const oldBytes = Buffer.from('private-v0.5.29');
  const rows = [row('v0.5.30', 530, currentBytes), row('v0.5.29', 529, oldBytes)];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/releases?per_page=12')) {
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/530')) return new Response(currentBytes, { status: 200 });
    if (String(url).endsWith('/529')) return new Response(oldBytes, { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    fetchImpl,
    env: {
      GPTLOCK_GITHUB_TOKEN: TOKEN,
      GPTLOCK_LICENSE_PUBLIC_ORIGIN: 'https://gptlock.mv3.cn',
      GPTLOCK_RELEASE_MIRROR_DIR: mirrorRoot,
      GPTLOCK_RELEASE_FETCH_RETRIES: '1',
    },
  });

  const before = await feed.load();
  assert.equal(before.minimumPublicVersion, '0.5.30');
  assert.deepEqual(before.releases, []);
  assert.equal(existsSync(oldDir), false);
  assert.doesNotMatch(readFileSync(join(mirrorRoot, 'index.json'), 'utf8'), /0\.5\.29|private-old/);

  const result = await feed.sync();
  assert.equal(result.latestVersion, '0.5.30');
  assert.deepEqual(result.releases.map((release) => release.tag), ['v0.5.30']);
  assert.equal(calls.some((url) => url.endsWith('/529')), false);
  assert.equal(feed.serveAsset({ method: 'GET' }, {}, '/downloads/releases/v0.5.29/private-old.zip'), false);
  assert.equal(existsSync(join(mirrorRoot, 'v0.5.29')), false);
  assert.doesNotMatch(readFileSync(join(mirrorRoot, 'index.json'), 'utf8'), /0\.5\.29|private-old/);
});
