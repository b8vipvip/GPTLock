import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const optionsUrl = new URL('../options.js', import.meta.url);
const settingsShellUrl = new URL('../settings-shell.js', import.meta.url);
const migrationUrl = new URL('../settings-migration.js', import.meta.url);

test('current settings keep the global switch interactive and reconcile stale Core versions', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const settingsPageUrl = new URL(`../${manifest.options_ui.page}`, import.meta.url);
  const [settingsHtml, options, shell, migration] = await Promise.all([
    readFile(settingsPageUrl, 'utf8'),
    readFile(optionsUrl, 'utf8'),
    readFile(settingsShellUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ]);

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.options_ui.page, 'settings-v0521.html');
  assert.match(settingsHtml, /<input id="enabled" type="checkbox">/);
  assert.doesNotMatch(settingsHtml, /<input id="enabled"[^>]*disabled/);

  assert.match(options, /function ensureEnabledControlInteractive\(\)/);
  assert.match(options, /elements\.enabled\.disabled = false/);
  assert.match(options, /removeAttribute\('disabled'\)/);
  assert.match(options, /MutationObserver\(\(\) => ensureEnabledControlInteractive\(\)\)/);
  assert.match(options, /window\.addEventListener\('pageshow', ensureEnabledControlInteractive\)/);

  assert.match(shell, /UPDATE_STATUS_KEY = 'gptlockUiUpdateStatus'/);
  assert.match(shell, /SAFE_CORE_RECONCILE_PHASES = new Set\(\['idle', 'checking', 'ready', 'up_to_date', 'error'\]\)/);
  assert.match(shell, /state\?\.nativeStatus\?\.connected \? state\.nativeStatus\.version : null/);
  assert.match(shell, /coreNode\.textContent = nativeVersion/);
  assert.match(shell, /nativeVersion,\n        coreVersionReconciledAt/);
  assert.match(shell, /chrome\.storage\.onChanged\.addListener/);

  assert.match(migration, /CURRENT_SETTINGS_PAGE = 'settings-v0521\.html'/);
  assert.match(migration, /'settings-v0519\.html'/);
});
