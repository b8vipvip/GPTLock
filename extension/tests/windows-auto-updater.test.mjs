import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows one-click updater launches installer outside the Native Messaging host job', async () => {
  const [updater, updateManager, installer] = await Promise.all([
    readFile(new URL('../../native-core/src/updater.rs', import.meta.url), 'utf8'),
    readFile(new URL('../update-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../packaging/windows/GPTLock.iss', import.meta.url), 'utf8'),
  ]);

  assert.match(updater, /Win32_ProcessStartup/);
  assert.match(updater, /CREATE_BREAKAWAY_FROM_JOB/);
  assert.match(updater, /CreateFlags=\{CREATE_BREAKAWAY_FROM_JOB\}/);
  assert.match(updater, /Win32_Process'; \$result=\$processClass\.Create/);
  assert.match(updater, /launcher_strategy: "wmi_breakaway"/);
  assert.match(updater, /UPDATE_INSTALLER_LOG_NAME/);
  assert.doesNotMatch(updater, /Start-Process -FilePath \$installer/);
  assert.doesNotMatch(updater, /CREATE_NEW_PROCESS_GROUP/);
  assert.doesNotMatch(updater, /function Stop-GptLockCore/);
  assert.doesNotMatch(updater, /Stop-Process -Id \{current_pid\}/);

  assert.match(installer, /function StopInstalledCoreProcesses\(\): Boolean;/);
  assert.match(installer, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(updateManager, /RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION = '0\.5\.20'/);
});
