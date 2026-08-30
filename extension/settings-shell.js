const SETTINGS_RUNTIME_KEY = 'gptlockSettingsRuntimeInfo';
const SETTINGS_REVISION = 'v0519-license-ui-purge-1';

const LEGACY_LICENSE_SELECTORS = [
  '.license-card',
  '[class~="license-card"]',
  '#licenseHeading',
  '#licenseBadge',
  '#licensePurchase',
  '#licenseDetail',
  '#licenseCode',
  '#licenseActivate',
  '#licenseMessage',
  '[id^="license" i]',
  '[class^="license-" i]',
  '[class*=" license-" i]',
  'input[placeholder^="GPTL-" i]',
];

const LEGACY_LICENSE_TEXT = [
  '授权验证 / License',
  '验证授权码',
  '重新验证',
  '退出授权',
  '获取授权码',
];

function removeLegacyLicenseUi() {
  let removed = false;
  for (const selector of LEGACY_LICENSE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      const card = node.closest('section, article, .card, .license-card');
      (card || node).remove();
      removed = true;
    }
  }

  for (const node of document.querySelectorAll('section, article')) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (LEGACY_LICENSE_TEXT.some((marker) => text.includes(marker))) {
      node.remove();
      removed = true;
    }
  }
  return removed;
}

async function persistRuntimeFingerprint() {
  try {
    await chrome.storage.local.set({
      [SETTINGS_RUNTIME_KEY]: {
        schemaVersion: 1,
        extensionVersion: chrome.runtime.getManifest().version,
        extensionId: chrome.runtime.id,
        entrypoint: location.pathname.split('/').pop() || location.pathname,
        settingsRevision: SETTINGS_REVISION,
        documentUrl: location.href,
        legacyLicenseUiRemoved: removeLegacyLicenseUi(),
        recordedAt: new Date().toISOString(),
      },
    });
  } catch {
    // Diagnostics are best effort.
  }
}

removeLegacyLicenseUi();
void persistRuntimeFingerprint();
const observer = new MutationObserver(() => removeLegacyLicenseUi());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pageshow', () => removeLegacyLicenseUi());
window.addEventListener('unload', () => observer.disconnect(), { once: true });
