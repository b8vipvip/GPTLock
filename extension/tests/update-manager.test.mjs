import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindAutomaticInstallAfterCheck,
  compareVersions,
  isInstallActionReady,
  normalizeLatestReleasePayload,
  normalizeVersion,
  parseLatestRelease,
  RELEASE_API_URL,
  RELEASES_URL,
  RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION,
  secureServerDownloadUrl,
  supportsReliableWindowsOneClickUpdate,
  updateStatusEventName,
  WINDOWS_INSTALLER_NAME,
} from '../update-manager.js';

const mirroredInstaller = (tag = 'v0.5.30') => `https://gptlock.mv3.cn/downloads/releases/${tag}/GPTLockSetup-x64.exe`;

test('normalizes and compares release versions', () => {
  assert.equal(normalizeVersion('v0.4.0'), '0.4.0');
  assert.equal(compareVersions('0.4.0', '0.3.9'), 1);
  assert.equal(compareVersions('0.4.0', '0.4'), 0);
  assert.equal(compareVersions('0.3.9', '0.4.0'), -1);
  assert.equal(compareVersions('bad', '0.4.0'), null);
});

test('private repository update checks use only the official GPTLock service', () => {
  assert.equal(RELEASE_API_URL, 'https://gptlock.mv3.cn/site/api/releases');
  assert.equal(RELEASES_URL, 'https://gptlock.mv3.cn/releases');
  assert.equal(secureServerDownloadUrl(mirroredInstaller()), mirroredInstaller());
  assert.equal(secureServerDownloadUrl('https://release-assets.githubusercontent.com/private/signed'), null);
  assert.equal(secureServerDownloadUrl('https://github.com/b8vipvip/GPTLock/releases/download/v0.5.30/GPTLockSetup-x64.exe'), null);
});

test('requires the hardened updater core baseline for Windows one-click installs', () => {
  assert.equal(RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION, '0.5.24');
  assert.equal(supportsReliableWindowsOneClickUpdate('0.5.21'), false);
  assert.equal(supportsReliableWindowsOneClickUpdate('0.5.22'), false);
  assert.equal(supportsReliableWindowsOneClickUpdate('0.5.23'), false);
  assert.equal(supportsReliableWindowsOneClickUpdate('0.5.24'), true);
  assert.equal(supportsReliableWindowsOneClickUpdate('1.0.0'), true);
  assert.equal(supportsReliableWindowsOneClickUpdate('bad'), false);
  assert.equal(supportsReliableWindowsOneClickUpdate(null), false);
});

test('normalizes the server mirror feed into update metadata', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const payload = normalizeLatestReleasePayload({
    ok: true,
    source: 'server-mirror',
    releases: [{
      tag: 'v0.5.30',
      name: 'GPTLock v0.5.30',
      publishedAt: '2026-09-01T00:00:00Z',
      assets: [{
        name: WINDOWS_INSTALLER_NAME,
        url: mirroredInstaller('v0.5.30'),
        digest,
        size: 1234,
      }],
    }],
  });
  assert.equal(payload.tag_name, 'v0.5.30');
  assert.equal(payload.html_url, RELEASES_URL);
  assert.equal(payload.assets[0].browser_download_url, mirroredInstaller('v0.5.30'));
});

test('parses a verified Windows installer only from the official mirror', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const release = parseLatestRelease({
    tag_name: 'v0.5.30',
    html_url: RELEASES_URL,
    draft: false,
    prerelease: false,
    assets: [{
      name: WINDOWS_INSTALLER_NAME,
      browser_download_url: mirroredInstaller('v0.5.30'),
      digest,
      size: 1234,
    }],
  }, '0.5.29');

  assert.equal(release.latestVersion, '0.5.30');
  assert.equal(release.updateAvailable, true);
  assert.equal(release.installer.sha256, 'a'.repeat(64));
  assert.equal(release.installer.size, 1234);
  assert.equal(release.installer.url, mirroredInstaller('v0.5.30'));
});

test('parses the official site mirror feed directly', () => {
  const digest = `sha256:${'b'.repeat(64)}`;
  const release = parseLatestRelease({
    ok: true,
    source: 'server-mirror',
    releases: [{
      tag: 'v0.5.30',
      name: 'GPTLock v0.5.30',
      publishedAt: '2026-09-01T00:00:00Z',
      assets: [{
        name: WINDOWS_INSTALLER_NAME,
        url: mirroredInstaller('v0.5.30'),
        digest,
        size: 5678,
      }],
    }],
  }, '0.5.29');
  assert.equal(release.latestVersion, '0.5.30');
  assert.equal(release.updateAvailable, true);
  assert.equal(release.releaseUrl, RELEASES_URL);
  assert.equal(release.installer.sha256, 'b'.repeat(64));
});

test('rejects release metadata without a SHA-256 installer digest', () => {
  assert.throws(() => parseLatestRelease({
    tag_name: 'v0.5.30',
    draft: false,
    prerelease: false,
    assets: [{
      name: WINDOWS_INSTALLER_NAME,
      browser_download_url: mirroredInstaller('v0.5.30'),
      digest: null,
    }],
  }, '0.5.29'), /server-mirrored Windows installer/);
});

test('rejects non-server installer URLs even when HTTPS', () => {
  assert.throws(() => parseLatestRelease({
    tag_name: 'v0.5.30',
    draft: false,
    prerelease: false,
    assets: [{
      name: WINDOWS_INSTALLER_NAME,
      browser_download_url: 'https://release-assets.githubusercontent.com/example/private-signed-url',
      digest: `sha256:${'c'.repeat(64)}`,
    }],
  }, '0.5.29'), /server-mirrored Windows installer/);
});

test('automatic install waits for the install action to become ready and clicks once', () => {
  class FakeButton {
    constructor() {
      this.hidden = true;
      this.disabled = false;
      this.listeners = new Map();
      this.clickCount = 0;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
    }

    click() {
      this.clickCount += 1;
      for (const listener of this.listeners.get('click') || []) listener();
    }
  }

  class FakeMutationObserver {
    static latest = null;

    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      FakeMutationObserver.latest = this;
    }

    observe() {}

    disconnect() {
      this.disconnected = true;
    }

    trigger() {
      this.callback([]);
    }
  }

  const checkButton = new FakeButton();
  const installButton = new FakeButton();
  const unbind = bindAutomaticInstallAfterCheck({
    checkButton,
    installButton,
    MutationObserverImpl: FakeMutationObserver,
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  });

  checkButton.click();
  assert.equal(installButton.clickCount, 0);
  assert.equal(isInstallActionReady(installButton), false);

  installButton.hidden = false;
  installButton.disabled = false;
  FakeMutationObserver.latest.trigger();
  assert.equal(installButton.clickCount, 1);
  assert.equal(FakeMutationObserver.latest.disconnected, true);

  FakeMutationObserver.latest.trigger();
  assert.equal(installButton.clickCount, 1);
  unbind();
});

test('maps persisted update phases to diagnostic runtime events', () => {
  assert.equal(updateStatusEventName('downloading'), 'update_download_started');
  assert.equal(updateStatusEventName('installing'), 'update_install_started');
  assert.equal(updateStatusEventName('complete'), 'update_completed');
  assert.equal(updateStatusEventName('error'), 'update_failed');
  assert.equal(updateStatusEventName('unknown'), null);
});
