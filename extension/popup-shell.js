const LEGACY_LICENSE_SELECTORS = [
  '.license-card',
  '#licenseHeading',
  '#licenseBadge',
  '#licensePurchase',
  '#licenseDetail',
  '#licenseCode',
  '#licenseActivate',
  '#licenseMessage',
];

function removeLegacyLicenseUi() {
  for (const selector of LEGACY_LICENSE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      const card = node.closest?.('.license-card');
      (card || node).remove();
    }
  }
}

function openUpdateCenter(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const url = chrome.runtime.getURL('options.html#updates-auto');
  void chrome.tabs.create({ url }).then(() => window.close());
}

removeLegacyLicenseUi();

const observer = new MutationObserver(() => removeLegacyLicenseUi());
observer.observe(document.documentElement, { childList: true, subtree: true });

const checkUpdate = document.getElementById('checkUpdate');
checkUpdate?.addEventListener('click', openUpdateCenter, true);

window.addEventListener('unload', () => observer.disconnect(), { once: true });
