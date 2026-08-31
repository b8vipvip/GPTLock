from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


updater = "native-core/src/updater.rs"

replace_once(
    updater,
    r'''    Ok(parent.to_path_buf())
}

#[cfg(windows)]
fn powershell_hash(path: &Path) -> Result<String> {''',
    r'''    Ok(parent.to_path_buf())
}

#[cfg(windows)]
fn windows_shell_path(path: &Path) -> Result<String> {
    let raw = path
        .to_str()
        .context("Windows update path is not valid UTF-8 / Windows 更新路径不是有效 UTF-8")?;
    let normalized = if let Some(rest) = raw.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{rest}")
    } else if let Some(rest) = raw.strip_prefix("\\\\?\\") {
        rest.to_owned()
    } else {
        raw.to_owned()
    };
    if normalized.contains('"') {
        bail!("Windows update path contains an invalid quote / Windows 更新路径包含非法引号");
    }
    Ok(normalized)
}

#[cfg(windows)]
fn powershell_hash(path: &Path) -> Result<String> {''',
)

replace_once(
    updater,
    r'''    let install_root = install_root
        .to_str()
        .context("Windows install root is not valid UTF-8 / Windows 安装目录不是有效 UTF-8")?;
    let installer_log = installer_log.to_str().context(
        "Windows installer log path is not valid UTF-8 / Windows 安装日志路径不是有效 UTF-8",
    )?;
    if [install_root, installer_log]
        .iter()
        .any(|value| value.contains('"'))
    {
        bail!("Windows update path contains an invalid quote / Windows 更新路径包含非法引号");
    }
    Ok(format!(
        "/SUPPRESSMSGBOXES /NORESTART /VERYSILENT /DIR=\"{install_root}\" /LOG=\"{installer_log}\""
    ))''',
    r'''    let install_root = windows_shell_path(install_root)?;
    let installer_log = windows_shell_path(installer_log)?;
    Ok(format!(
        "/SUPPRESSMSGBOXES /NORESTART /VERYSILENT /DIR=\"{install_root}\" /LOG=\"{installer_log}\""
    ))''',
)

replace_once(
    updater,
    r'''function Stop-InstalledCoreProcesses {
  $target = [IO.Path]::GetFullPath([string]$job.corePath)
  Get-CimInstance Win32_Process -Filter "Name='gptlock-core.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and ([IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $target)
    } |
    ForEach-Object {
      try {
        Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction Stop
        Write-HelperLog ("stopped_core pid=" + $_.ProcessId)
      } catch {
        Write-HelperLog ("stop_core_failed pid=" + $_.ProcessId + " error=" + $_.Exception.Message)
      }
    }
}

try {
  Write-HelperLog ("coordinator_started target=" + $job.targetVersion + " current_pid=" + $job.currentPid)
  $deadline = (Get-Date).AddSeconds(20)
  while (Get-Process -Id ([int]$job.currentPid) -ErrorAction SilentlyContinue) {
    if ((Get-Date) -ge $deadline) { throw 'Timed out waiting for preparing Native Messaging host to exit' }
    Start-Sleep -Milliseconds 100
  }
  Write-HelperLog 'preparing_native_host_exited'

  Stop-InstalledCoreProcesses
  $installer = Start-Process''',
    r'''function Get-InstalledCoreProcesses {
  $target = [IO.Path]::GetFullPath([string]$job.corePath)
  return @(Get-Process -Name 'gptlock-core' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and ([IO.Path]::GetFullPath([string]$_.Path) -ieq $target) } catch { $false }
  })
}

function Stop-InstalledCoreProcesses {
  foreach ($process in @(Get-InstalledCoreProcesses)) {
    try {
      Stop-Process -Id ([int]$process.Id) -Force -ErrorAction Stop
      Write-HelperLog ("stopped_core pid=" + $process.Id)
    } catch {
      Write-HelperLog ("stop_core_failed pid=" + $process.Id + " error=" + $_.Exception.Message)
    }
  }
}

try {
  Write-HelperLog ("coordinator_started target=" + $job.targetVersion + " current_pid=" + $job.currentPid)
  $deadline = (Get-Date).AddSeconds(3)
  while (Get-Process -Id ([int]$job.currentPid) -ErrorAction SilentlyContinue) {
    if ((Get-Date) -ge $deadline) {
      Write-HelperLog 'preparing_native_host_still_running_forcing_shutdown'
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Get-Process -Id ([int]$job.currentPid) -ErrorAction SilentlyContinue)) {
    Write-HelperLog 'preparing_native_host_exited'
  }

  Stop-InstalledCoreProcesses
  Start-Sleep -Milliseconds 150
  Stop-InstalledCoreProcesses
  $installer = Start-Process''',
)

replace_once(
    updater,
    r'''    let script_path = install_root.join(UPDATE_COORDINATOR_SCRIPT_NAME);
    let job_path = install_root.join(UPDATE_COORDINATOR_JOB_NAME);
    let core_path = install_root.join("bin").join("gptlock-core.exe");
    let job = UpdateCoordinatorJob {
        current_pid,
        installer_path: installer.to_string_lossy().into_owned(),
        installer_arguments: windows_installer_arguments(install_root, installer_log)?,
        install_root: install_root.to_string_lossy().into_owned(),
        core_path: core_path.to_string_lossy().into_owned(),
        target_version: target_version.to_owned(),
        helper_log_path: helper_log.to_string_lossy().into_owned(),
    };''',
    r'''    let script_path = install_root.join(UPDATE_COORDINATOR_SCRIPT_NAME);
    let job_path = install_root.join(UPDATE_COORDINATOR_JOB_NAME);
    let core_path = install_root.join("bin").join("gptlock-core.exe");
    let job = UpdateCoordinatorJob {
        current_pid,
        installer_path: windows_shell_path(installer)?,
        installer_arguments: windows_installer_arguments(install_root, installer_log)?,
        install_root: windows_shell_path(install_root)?,
        core_path: windows_shell_path(&core_path)?,
        target_version: target_version.to_owned(),
        helper_log_path: windows_shell_path(helper_log)?,
    };''',
)

replace_once(
    updater,
    r'''    let script_path = script_path.to_str().context(
        "Windows coordinator path is not valid UTF-8 / Windows 协调器路径不是有效 UTF-8",
    )?;
    let job_path = job_path.to_str().context(
        "Windows update job path is not valid UTF-8 / Windows 更新任务路径不是有效 UTF-8",
    )?;
    if [script_path, job_path]
        .iter()
        .any(|value| value.contains('"'))
    {
        bail!("Windows update path contains an invalid quote / Windows 更新路径包含非法引号");
    }
    Ok(format!(''',
    r'''    let script_path = windows_shell_path(script_path)?;
    let job_path = windows_shell_path(job_path)?;
    Ok(format!(''',
)

replace_once(
    updater,
    r'''    let install_root_text = install_root
        .to_str()
        .context("Windows install root is not valid UTF-8 / Windows 安装目录不是有效 UTF-8")?;''',
    r'''    let install_root_text = windows_shell_path(install_root)?;''',
)

replace_once(
    updater,
    r'''        assert!(script.contains("Get-Process -Id ([int]$job.currentPid)"));
        assert!(script.contains("Stop-InstalledCoreProcesses"));
        assert!(script.contains("while (-not $installer.HasExited)"));
        assert!(script.contains("Get-CimInstance Win32_Process"));
        assert!(script.contains("installed_core_version_output"));''',
    r'''        assert!(script.contains("Get-Process -Id ([int]$job.currentPid)"));
        assert!(script.contains("preparing_native_host_still_running_forcing_shutdown"));
        assert!(!script.contains("Timed out waiting for preparing Native Messaging host to exit"));
        assert!(script.contains("Stop-InstalledCoreProcesses"));
        assert!(script.contains("while (-not $installer.HasExited)"));
        assert!(script.contains("Get-Process -Name 'gptlock-core'"));
        assert!(script.contains("installed_core_version_output"));''',
)

marker = r'''    #[cfg(windows)]
    #[test]
    fn coordinator_waits_for_preparing_host_and_suppresses_core_reconnects() {'''
insertion = r'''    #[cfg(windows)]
    #[test]
    fn normalizes_extended_windows_paths_for_powershell_and_wmi() {
        assert_eq!(
            windows_shell_path(Path::new(r"\\?\D:\AI\GPTLock")).unwrap(),
            r"D:\AI\GPTLock"
        );
        assert_eq!(
            windows_shell_path(Path::new(r"\\?\UNC\server\share\GPTLock")).unwrap(),
            r"\\server\share\GPTLock"
        );
    }

''' + marker
replace_once(updater, marker, insertion)

installer = "packaging/windows/GPTLock.iss"
replace_once(
    installer,
    """    '$matches=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'foreach ($p in $matches) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }; ' +
    'Start-Sleep -Milliseconds 500; ' +
    '$remaining=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'if ($remaining.Count -gt 0) { throw ''GPTLock core still running'' }';""",
    """    '$deadline=(Get-Date).AddSeconds(8); ' +
    'do { ' +
    '$matches=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'foreach ($p in $matches) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }; ' +
    'Start-Sleep -Milliseconds 150; ' +
    '$remaining=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'if ($remaining.Count -eq 0) { exit 0 } ' +
    '} while ((Get-Date) -lt $deadline); ' +
    'throw ''GPTLock core still running after retry window''';""",
)

for path in [
    "extension/manifest.json",
    "extension/package.json",
    "native-core/Cargo.toml",
    "native-core/Cargo.lock",
    "extension/tests/settings-runtime-migration.test.mjs",
    "extension/tests/settings-state-regression.test.mjs",
]:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if "0.5.23" in text:
        p.write_text(text.replace("0.5.23", "0.5.24"), encoding="utf-8")
