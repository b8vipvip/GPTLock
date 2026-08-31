import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows one-click updater coordinates Core shutdown outside the Native Messaging host job', async () => {
  const [updater, updateManager, installer] = await Promise.all([
    readFile(new URL('../../native-core/src/updater.rs', import.meta.url), 'utf8'),
    readFile(new URL('../update-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../packaging/windows/GPTLock.iss', import.meta.url), 'utf8'),
  ]);

  assert.match(updater, /Win32_ProcessStartup/);
  assert.match(updater, /CREATE_BREAKAWAY_FROM_JOB/);
  assert.match(updater, /CreateFlags=\{CREATE_BREAKAWAY_FROM_JOB\}/);
  assert.match(updater, /launcher_strategy: "wmi_coordinator_breakaway"/);
  assert.match(updater, /UPDATE_COORDINATOR_SCRIPT_NAME/);
  assert.match(updater, /UPDATE_COORDINATOR_JOB_NAME/);
  assert.match(updater, /Get-Process -Id \(\[int\]\$job\.currentPid\)/);
  assert.match(updater, /while \(-not \$installer\.HasExited\)/);
  assert.match(updater, /Stop-InstalledCoreProcesses/);
  assert.match(updater, /Get-Process -Name 'gptlock-core'/);
  assert.match(updater, /windows_shell_path/);
  assert.match(updater, /installed_core_version_output/);
  assert.match(updater, /UPDATE_INSTALLER_LOG_NAME/);
  assert.doesNotMatch(updater, /CREATE_NEW_PROCESS_GROUP/);

  assert.match(installer, /function StopInstalledCoreProcesses\(\): Boolean;/);
  assert.match(installer, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(updateManager, /RELIABLE_WINDOWS_UPDATER_MIN_CORE_VERSION = '0\.5\.22'/);
});
