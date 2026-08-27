use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const INSTALLER_FILE_NAME: &str = "GPTLockSetup-x64.exe";

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
fn powershell_literal(value: &Path) -> Result<String> {
    let text = value
        .to_str()
        .context("Windows update path is not valid UTF-8 / Windows 更新路径不是有效 UTF-8")?;
    Ok(text.replace('\'', "''"))
}

#[cfg(windows)]
fn launch_installer_helper(installer: &Path, install_root: &Path) -> Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let installer = powershell_literal(installer)?;
    let install_root = powershell_literal(install_root)?;
    let command = format!(
        "$ErrorActionPreference='Stop'; Start-Sleep -Milliseconds 1500; Get-Process -Name 'gptlock-core' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 400; $arguments=@('/SUPPRESSMSGBOXES','/NORESTART','/VERYSILENT','/DIR=\"{install_root}\"'); $process=Start-Process -FilePath '{installer}' -ArgumentList $arguments -Wait -PassThru; exit $process.ExitCode"
    );

    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .context("failed to start update helper / 无法启动更新辅助进程")?;
    Ok(())
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
        let pid = std::process::id();
        launch_installer_helper(&installer_path, &install_root)?;
        Ok(PrepareUpdateResult {
            target_version,
            installer_path: installer_path.to_string_lossy().into_owned(),
            install_root: install_root.to_string_lossy().into_owned(),
            current_pid: pid,
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
}
