import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSiteReleaseFeed } from '../site-releases.mjs';

const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'github_pat_private_release_read_only_test_secret';
const INSTALLER = 'GPTLockSetup-x64.exe';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function releaseRow(assetUrl = 'https://api.github.com/repos/b8vipvip/GPTLock/releases/assets/123') {
  return [{
    tag_name: 'v0.5.28',
    name: 'GPTLock v0.5.28',
    draft: false,
    prerelease: false,
    published_at: '2026-09-01T00:00:00Z',
    assets: [{
      name: INSTALLER,
      url: assetUrl,
      browser_download_url: 'https://github.com/b8vipvip/GPTLock/releases/download/v0.5.28/GPTLockSetup-x64.exe',
      size: 1234,
      digest: DIGEST,
      content_type: 'application/octet-stream',
    }],
  }];
}

test('private release feed authenticates only server-side and exposes a signed asset URL', async () => {
  const calls = [];
  const signedUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/example?sig=test';
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/releases?per_page=12')) {
      return new Response(JSON.stringify(releaseRow()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/releases/assets/123')) {
      return new Response(null, {
        status: 302,
        headers: { location: signedUrl },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    fetchImpl,
    env: { GPTLOCK_GITHUB_TOKEN: TOKEN },
  });
  const result = await feed.load();

  assert.equal(result.ok, true);
  assert.equal(result.source, 'github-private');
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].assets.length, 1);
  assert.equal(result.releases[0].assets[0].url, signedUrl);
  assert.equal(result.releases[0].assets[0].digest, DIGEST);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].options.headers.Accept, 'application/octet-stream');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test('private release feed never exposes an untrusted redirect host', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/releases?per_page=12')) {
      return new Response(JSON.stringify(releaseRow()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: 'https://example.invalid/steal-private-release' },
    });
  };

  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    fetchImpl,
    env: { GPTLOCK_GITHUB_TOKEN: TOKEN },
  });
  const result = await feed.load();

  assert.equal(result.source, 'github-private');
  assert.deepEqual(result.releases[0].assets, []);
});

test('private repository without a server token degrades safely instead of exposing credentials', async () => {
  let calls = 0;
  const feed = createSiteReleaseFeed({
    serverRoot: SERVER_ROOT,
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await feed.load();
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'local');
  assert.equal(result.warning, 'private_release_token_required');
  assert.deepEqual(result.releases, []);
});
