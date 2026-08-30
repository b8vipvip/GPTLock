export const CURRENT_SETTINGS_PAGE = 'settings-v0519.html';
export const LEGACY_SETTINGS_PAGES = new Set([
  'options.html',
  'settings-v0517.html',
]);

function extensionPageName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== chrome.runtime.id) return null;
    return parsed.pathname.split('/').filter(Boolean).pop() || null;
  } catch {
    return null;
  }
}

function replacementUrl(url) {
  let hash = '';
  try { hash = new URL(url).hash || ''; } catch {}
  return chrome.runtime.getURL(`${CURRENT_SETTINGS_PAGE}${hash}`);
}

export async function redirectLegacySettingsTab(tab) {
  if (!Number.isInteger(tab?.id) || !LEGACY_SETTINGS_PAGES.has(extensionPageName(tab.url))) return false;
  await chrome.tabs.update(tab.id, { url: replacementUrl(tab.url) });
  return true;
}

export async function redirectLegacySettingsTabs() {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => LEGACY_SETTINGS_PAGES.has(extensionPageName(tab.url)));
  await Promise.all(candidates.map((tab) => redirectLegacySettingsTab(tab).catch(() => false)));
  return candidates.length;
}

function runMigration() {
  void redirectLegacySettingsTabs().catch(() => {});
}

// A runtime reload after an in-place update can leave an already-open extension page
// rendered with its old DOM. Run immediately when the new service worker starts, and
// again on install/startup, so stale License-era settings tabs are navigated to the
// current cache-busted settings document without requiring the user to close them.
runMigration();
chrome.runtime.onInstalled.addListener(runMigration);
chrome.runtime.onStartup.addListener(runMigration);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== 'string') return false;
  if (![
    'GPTLOCK-LICENSE-GET',
    'GPTLOCK_LICENSE_GET',
    'GPTLOCK-LICENSE-ACTIVATE',
    'GPTLOCK_LICENSE_ACTIVATE',
    'GPTLOCK-LICENSE-CLEAR',
    'GPTLOCK_LICENSE_CLEAR',
  ].includes(message.type)) return false;
  if (sender.tab) void redirectLegacySettingsTab(sender.tab).catch(() => {});
  return false;
});
