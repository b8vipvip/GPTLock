import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  normalizeVersion,
  parseLatestRelease,
  WINDOWS_INSTALLER_NAME,
} from '../update-manager.js';

test('normalizes and compares release versions', () => {
  assert.equal(normalizeVersion('v0.4.0'), '0.4.0');
  assert.equal(compareVersions('0.4.0', '0.3.9'), 1);
  assert.equal(compareVersions('0.4.0', '0.4'), 0);
  assert.equal(compareVersions('0.3.9', '0.4.0'), -1);
  assert.equal(compareVersions('bad', '0.4.0'), null);
});

test('parses a verified Windows installer from GitHub release metadata', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const release = parseLatestRelease({
    tag_name: 'v0.4.0',
    html_url: 'https://github.com/b8vipvip/GPTLock/releases/tag/v0.4.0',
    draft: false,
    prerelease: false,
    assets: [{
      name: WINDOWS_INSTALLER_NAME,
      browser_download_url: 'https://github.com/b8vipvip/GPTLock/releases/download/v0.4.0/GPTLockSetup-x64.exe',
      digest,
      size: 1234,
    }],
  }, '0.3.9');

  assert.equal(release.latestVersion, '0.4.0');
  assert.equal(release.updateAvailable, true);
  assert.equal(release.installer.sha256, 'a'.repeat(64));
  assert.equal(release.installer.size, 1234);
});

test('rejects release metadata without a SHA-256 installer digest', () => {
  assert.throws(() => parseLatestRelease({
    tag_name: 'v0.4.0',
    draft: false,
    prerelease: false,
    assets: [{
      name: WINDOWS_INSTALLER_NAME,
      browser_download_url: 'https://example.invalid/GPTLockSetup-x64.exe',
      digest: null,
    }],
  }, '0.3.9'), /verified Windows installer/);
});
