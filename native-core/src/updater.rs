use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const INSTALLER_FILE_NAME: &str = "GPTLockSetup-x64.exe";
#[cfg(windows)]
const UPDATE_HELPER_LOG_NAME: &str = "update-helper.log";
#[cfg(windows)]
const UPDATE_INSTALLER_LOG_NAME: &str = "update-installer.log";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUpdateRequest {
    pub installer_path: String,
    pub expected_sha256: String,
    pub target_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUpdateResult {
    pub target_version: String,
    pub installer_path: String,
    pub install_root: String,
    pub current_pid: u32,
    pub signature_status: String,
    pub download_unblocked: bool,
    pub helper_log_path: String,
    pub installer_log_path: String,
    pub launcher_strategy: String,
    pub launcher_process_id: u32,
}

fn normalized_sha256(value: &str) -> Result<String> {
    let trimmed = value.trim();
    let normalized = trimmed
        .strip_prefix("sha256:")
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("invalid SHA-256 digest / SHA-256 校验值无效");
    }
    Ok(normalized)
}

fn validate_target_version(value: &str) -> Result<String> {
    let normalized = value.trim().trim_start_matches(['v', 'V']);
    let parts = normalized.split('.').collect::<Vec<_>>();
    if !(2..=4).contains(&parts.len())
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        bail!("invalid target version / 目标版本号无效");
    }
    Ok(normalized.to_owned())
}

fn validate_installer_path(path: &Path) -> Result<PathBuf> {
    if path.file_name().and_then(|value| value.to_str()) != Some(INSTALLER_FILE_NAME) {
        bail!("unexpected installer filename / 安装器文件名不受信任");
    }
    let canonical = path
        .canonicalize()
        .with_context(|| format!("cannot resolve installer path: {}", path.display()))?;
    if !canonical.is_file() {
        bail!("installer is not a file / 安装器文件不存在");
    }
    Ok(canonical)
}

fn install_root_from_current_exe() -> Result<PathBuf> {
    let executable = std::env::current_exe()
        .context("cannot determine GPTLock executable path / 无法确定 GPTLock 程序路径")?
        .canonicalize()
        .context("cannot resolve GPTLock executable path / 无法解析 GPTLock 程序路径")?;
    let parent = executable
        .parent()
        .context("GPTLock executable has no parent directory")?;
    if parent.file_name().and_then(|value| value.to_str()) == Some("bin") {
        return parent
            .parent()
            .map(Path::to_path_buf)
            .context("GPTLock bin directory has no install root");
    }
    Ok(parent.to_path_buf())
}

#[cfg(windows)]
fn powershell_hash(path: &Path) -> Result<String> {
    use std::process::Command;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$ErrorActionPreference='Stop'; (Get-FileHash -LiteralPath $env:GPTLOCK_INSTALLER_PATH -Algorithm SHA256).Hash.ToLowerInvariant()",
        ])
        .env("GPTLOCK_INSTALLER_PATH", path)
        .output()
        .context("failed to calculate installer SHA-256 / 无法计算安装器 SHA-256")?;
    if !output.status.success() {
        bail!(
            "installer SHA-256 command failed / 安装器 SHA-256 校验命令失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    normalized_sha256(String::from_utf8_lossy(&output.stdout).trim())
}

#[cfg(windows)]
fn powershell_signature_status(path: &Path) -> Result<String> {
    use std::process::Command;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$ErrorActionPreference='Stop'; (Get-AuthenticodeSignature -LiteralPath $env:GPTLOCK_INSTALLER_PATH).Status.ToString()",
        ])
        .env("GPTLOCK_INSTALLER_PATH", path)
        .output()
        .context("failed to inspect installer signature / 无法检查安装器数字签名")?;
    if !output.status.success() {
        bail!(
            "installer signature inspection failed / 安装器数字签名检查失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let status = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    Ok(if status.is_empty() {
        "Unknown".to_owned()
    } else {
        status
    })
}

#[cfg(windows)]
fn unblock_verified_download(path: &Path) -> Result<bool> {
    use std::process::Command;

    // Chrome/Edge attach Mark-of-the-Web (Zone.Identifier) to downloaded EXEs. Launching
    // an unsigned MOTW file from a hidden updater can strand the update behind an
    // interactive Attachment Manager/SmartScreen prompt. We remove MOTW only *after* the
    // file has matched the exact SHA-256 published by the trusted GitHub Release metadata.
    // Manual downloads are never modified by GPTLock.
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$ErrorActionPreference='Stop'; $hadZone = @((Get-Item -LiteralPath $env:GPTLOCK_INSTALLER_PATH -Stream Zone.Identifier -ErrorAction SilentlyContinue)).Count -gt 0; if ($hadZone) { Unblock-File -LiteralPath $env:GPTLOCK_INSTALLER_PATH }; $hasZone = @((Get-Item -LiteralPath $env:GPTLOCK_INSTALLER_PATH -Stream Zone.Identifier -ErrorAction SilentlyContinue)).Count -gt 0; if ($hasZone) { throw 'Zone.Identifier remains after Unblock-File' }; if ($hadZone) { 'removed' } else { 'absent' }",
        ])
        .env("GPTLOCK_INSTALLER_PATH", path)
        .output()
        .context("failed to unblock verified installer / 无法解除已校验安装器的下载阻止")?;
    if !output.status.success() {
        bail!(
            "verified installer unblock failed / 已校验安装器解除下载阻止失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "removed")
}

#[cfg(windows)]
fn windows_command_line(
    installer: &Path,
    install_root: &Path,
    installer_log: &Path,
) -> Result<String> {
    let installer = installer
        .to_str()
        .context("Windows installer path is not valid UTF-8 / Windows 安装器路径不是有效 UTF-8")?;
    let install_root = install_root
        .to_str()
        .context("Windows install root is not valid UTF-8 / Windows 安装目录不是有效 UTF-8")?;
    let installer_log = installer_log.to_str().context(
        "Windows installer log path is not valid UTF-8 / Windows 安装日志路径不是有效 UTF-8",
    )?;
    if [installer, install_root, installer_log]
        .iter()
        .any(|value| value.contains('"'))
    {
        bail!("Windows update path contains an invalid quote / Windows 更新路径包含非法引号");
    }
    Ok(format!(
        "\"{installer}\" /SUPPRESSMSGBOXES /NORESTART /VERYSILENT /DIR=\"{install_root}\" /LOG=\"{installer_log}\""
    ))
}

#[cfg(windows)]
fn launch_installer_via_wmi(
    installer: &Path,
    install_root: &Path,
    installer_log: &Path,
) -> Result<u32> {
    use std::process::Command;

    // Native Messaging hosts are owned by the browser. Any ordinary child process can
    // inherit the browser's Windows Job Object and be killed when the native port closes
    // or when Setup stops the old Core. Ask the local WMI provider to create the installer
    // instead, and explicitly request CREATE_BREAKAWAY_FROM_JOB. The installer's lifetime
    // is then independent from the short-lived Native Messaging host that prepared it.
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let command_line = windows_command_line(installer, install_root, installer_log)?;
    let install_root_text = install_root
        .to_str()
        .context("Windows install root is not valid UTF-8 / Windows 安装目录不是有效 UTF-8")?;
    let script = format!(
        "$ErrorActionPreference='Stop'; $startupClass=[WMIClass]'\\\\.\\root\\cimv2:Win32_ProcessStartup'; $startup=$startupClass.CreateInstance(); $startup.CreateFlags={CREATE_BREAKAWAY_FROM_JOB}; $startup.ShowWindow=0; $processClass=[WMIClass]'\\\\.\\root\\cimv2:Win32_Process'; $result=$processClass.Create($env:GPTLOCK_UPDATE_COMMAND_LINE,$env:GPTLOCK_INSTALL_ROOT,$startup); if ([int]$result.ReturnValue -ne 0) {{ throw ('Win32_Process.Create failed with code ' + $result.ReturnValue) }}; [Console]::Out.WriteLine([string]$result.ProcessId)"
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .env("GPTLOCK_UPDATE_COMMAND_LINE", command_line)
        .env("GPTLOCK_INSTALL_ROOT", install_root_text)
        .output()
        .context("failed to invoke WMI update launcher / 无法调用 WMI 更新启动器")?;
    if !output.status.success() {
        bail!(
            "WMI update launcher failed / WMI 更新启动器失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let process_id = stdout
        .lines()
        .rev()
        .find_map(|line| line.trim().parse::<u32>().ok())
        .context("WMI launcher did not return installer PID / WMI 启动器未返回安装器 PID")?;
    Ok(process_id)
}

#[cfg(windows)]
fn write_update_launch_log(
    helper_log_path: &Path,
    installer_log_path: &Path,
    target_version: &str,
    launcher_process_id: u32,
) -> Result<()> {
    use std::fs;

    let text = format!(
        "launcher_strategy=wmi_breakaway\ntarget_version={target_version}\ninstaller_pid={launcher_process_id}\ninstaller_log={}\n",
        installer_log_path.display()
    );
    fs::write(helper_log_path, text).with_context(|| {
        format!(
            "failed to write update launch log: {} / 无法写入更新启动日志",
            helper_log_path.display()
        )
    })
}

pub fn prepare_update(request: PrepareUpdateRequest) -> Result<PrepareUpdateResult> {
    let expected_sha256 = normalized_sha256(&request.expected_sha256)?;
    let target_version = validate_target_version(&request.target_version)?;
    let installer_path = validate_installer_path(Path::new(&request.installer_path))?;
    let install_root = install_root_from_current_exe()?;

    #[cfg(not(windows))]
    {
        let _ = (
            expected_sha256,
            installer_path,
            install_root,
            target_version,
        );
        bail!("one-click installer update is only supported on Windows / 一键安装更新目前仅支持 Windows");
    }

    #[cfg(windows)]
    {
        let actual_sha256 = powershell_hash(&installer_path)?;
        if actual_sha256 != expected_sha256 {
            bail!("installer SHA-256 mismatch / 安装器 SHA-256 校验失败");
        }

        let signature_status = powershell_signature_status(&installer_path)?;
        let download_unblocked = unblock_verified_download(&installer_path)?;
        let pid = std::process::id();
        let helper_log_path = install_root.join(UPDATE_HELPER_LOG_NAME);
        let installer_log_path = install_root.join(UPDATE_INSTALLER_LOG_NAME);
        let launcher_process_id =
            launch_installer_via_wmi(&installer_path, &install_root, &installer_log_path)?;
        write_update_launch_log(
            &helper_log_path,
            &installer_log_path,
            &target_version,
            launcher_process_id,
        )?;

        Ok(PrepareUpdateResult {
            target_version,
            installer_path: installer_path.to_string_lossy().into_owned(),
            install_root: install_root.to_string_lossy().into_owned(),
            current_pid: pid,
            signature_status,
            download_unblocked,
            helper_log_path: helper_log_path.to_string_lossy().into_owned(),
            installer_log_path: installer_log_path.to_string_lossy().into_owned(),
            launcher_strategy: "wmi_breakaway".to_owned(),
            launcher_process_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_sha256() {
        let digest = "A".repeat(64);
        assert_eq!(normalized_sha256(&digest).unwrap(), "a".repeat(64));
        assert!(normalized_sha256("abc").is_err());
    }

    #[test]
    fn validates_target_versions() {
        assert_eq!(validate_target_version("v0.4.0").unwrap(), "0.4.0");
        assert!(validate_target_version("0.4-beta").is_err());
    }

    #[test]
    fn rejects_wrong_installer_filename_before_touching_disk() {
        let error = validate_installer_path(Path::new("evil.exe")).unwrap_err();
        assert!(error.to_string().contains("filename"));
    }

    #[cfg(windows)]
    #[test]
    fn formats_silent_installer_command_line() {
        let installer = Path::new(r"C:\Users\test\Downloads\GPTLockSetup-x64.exe");
        let install_root = Path::new(r"C:\Users\test\AppData\Local\GPTLock");
        let installer_log = install_root.join(UPDATE_INSTALLER_LOG_NAME);
        let command = windows_command_line(installer, install_root, &installer_log).unwrap();
        assert!(command.starts_with("\"C:\\Users\\test\\Downloads\\GPTLockSetup-x64.exe\""));
        assert!(command.contains("/VERYSILENT"));
        assert!(command.contains("/DIR=\"C:\\Users\\test\\AppData\\Local\\GPTLock\""));
        assert!(command.contains("update-installer.log"));
    }

    #[cfg(windows)]
    #[test]
    fn unblock_verified_download_is_idempotent_without_motw() {
        let directory = tempfile::tempdir().unwrap();
        let installer = directory.path().join(INSTALLER_FILE_NAME);
        std::fs::write(&installer, b"test installer placeholder").unwrap();
        assert!(!unblock_verified_download(&installer).unwrap());
        assert!(!unblock_verified_download(&installer).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn unblock_verified_download_removes_mark_of_the_web() {
        use std::process::Command;

        let directory = tempfile::tempdir().unwrap();
        let installer = directory.path().join(INSTALLER_FILE_NAME);
        std::fs::write(&installer, b"test installer placeholder").unwrap();

        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$ErrorActionPreference='Stop'; Set-Content -LiteralPath $env:GPTLOCK_INSTALLER_PATH -Stream Zone.Identifier -Value \"[ZoneTransfer]`r`nZoneId=3\" -Encoding ASCII",
            ])
            .env("GPTLOCK_INSTALLER_PATH", &installer)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "failed to create Zone.Identifier: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        assert!(unblock_verified_download(&installer).unwrap());
        assert!(!unblock_verified_download(&installer).unwrap());
    }
}
