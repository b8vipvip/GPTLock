use std::env;
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
const PRIVATE_ENGINE_ENV: &str = "GPTLOCK_PRIVATE_ENGINE";
const PRIVATE_ENGINE_PROTOCOL: u64 = 2;

struct EngineProcess {
    path: PathBuf,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl EngineProcess {
    fn start(path: PathBuf) -> Result<Self> {
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("start private engine: {}", path.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("private engine stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("private engine stdout unavailable")?;
        Ok(Self {
            path,
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn request(&mut self, message: &Value) -> Result<Value> {
        let payload = serde_json::to_vec(message).context("serialize private engine request")?;
        if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
            anyhow::bail!("private engine request frame size is invalid");
        }
        self.stdin
            .write_all(&(payload.len() as u32).to_le_bytes())
            .context("write private engine request length")?;
        self.stdin
            .write_all(&payload)
            .context("write private engine request body")?;
        self.stdin.flush().context("flush private engine request")?;

        let mut length = [0_u8; 4];
        self.stdout
            .read_exact(&mut length)
            .context("read private engine response length")?;
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > MAX_FRAME_BYTES {
            anyhow::bail!("private engine response frame size is invalid");
        }
        let mut response = vec![0_u8; length];
        self.stdout
            .read_exact(&mut response)
            .context("read private engine response body")?;
        serde_json::from_slice(&response).context("parse private engine response")
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct EngineState {
    process: Option<EngineProcess>,
}

static ENGINE: OnceLock<Mutex<EngineState>> = OnceLock::new();

fn state() -> &'static Mutex<EngineState> {
    ENGINE.get_or_init(|| Mutex::new(EngineState::default()))
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "gptlock-engine.exe"
    } else {
        "gptlock-engine"
    }
}

fn default_engine_path() -> Result<PathBuf> {
    let current = env::current_exe().context("resolve current executable")?;
    let directory = current.parent().context("resolve executable directory")?;
    Ok(directory.join(executable_name()))
}

pub fn configured_path() -> Result<PathBuf> {
    if let Some(value) = env::var_os(PRIVATE_ENGINE_ENV) {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() {
            anyhow::bail!("{PRIVATE_ENGINE_ENV} is empty");
        }
        return Ok(path);
    }
    default_engine_path()
}

fn usable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

pub fn available() -> bool {
    configured_path()
        .map(|path| usable_file(&path))
        .unwrap_or(false)
}

fn capability_from_probe(installed: bool, response: Option<&Value>) -> Value {
    let mut capability = serde_json::json!({
        "available": installed,
        "protocolVersion": PRIVATE_ENGINE_PROTOCOL,
        "capabilityProbe": false,
        "requestEvaluation": false,
        "responseEvaluation": false,
        "contextBudgetEvaluation": false,
        "contextProfileEvaluation": false,
        "compactRequestPatches": false,
    });
    if !installed {
        return capability;
    }
    let Some(response) = response else {
        return capability;
    };
    if response.get("ok").and_then(Value::as_bool) != Some(true)
        || response.get("protocolVersion").and_then(Value::as_u64) != Some(PRIVATE_ENGINE_PROTOCOL)
    {
        return capability;
    }
    let Some(data) = response.get("data").and_then(Value::as_object) else {
        return capability;
    };
    let Some(object) = capability.as_object_mut() else {
        return capability;
    };
    object.insert("capabilityProbe".to_string(), Value::Bool(true));
    for feature in [
        "requestEvaluation",
        "responseEvaluation",
        "contextBudgetEvaluation",
        "contextProfileEvaluation",
        "compactRequestPatches",
    ] {
        object.insert(
            feature.to_string(),
            Value::Bool(data.get(feature).and_then(Value::as_bool) == Some(true)),
        );
    }
    capability
}

pub fn capability() -> Value {
    let installed = configured_path()
        .map(|path| usable_file(&path))
        .unwrap_or(false);
    if !installed {
        return capability_from_probe(false, None);
    }
    let probe = serde_json::json!({
        "id": "native-capability-probe",
        "type": "get_capabilities",
        "protocolVersion": PRIVATE_ENGINE_PROTOCOL,
        "payload": {},
    });
    let response = request(probe).ok();
    capability_from_probe(true, response.as_ref())
}

fn ensure_process(engine: &mut EngineState, path: &Path) -> Result<()> {
    let needs_start = match engine.process.as_mut() {
        Some(process) if process.path == path => match process.child.try_wait() {
            Ok(None) => false,
            Ok(Some(_)) | Err(_) => true,
        },
        Some(_) => true,
        None => true,
    };
    if !needs_start {
        return Ok(());
    }
    engine.process.take();
    if !usable_file(path) {
        anyhow::bail!("private engine artifact is not installed");
    }
    engine.process = Some(EngineProcess::start(path.to_path_buf())?);
    Ok(())
}

fn validate_message(message: &Value) -> Result<()> {
    if message.get("protocolVersion").and_then(Value::as_u64) != Some(PRIVATE_ENGINE_PROTOCOL) {
        anyhow::bail!("private engine protocol version must be {PRIVATE_ENGINE_PROTOCOL}");
    }
    let Some(kind) = message.get("type").and_then(Value::as_str) else {
        anyhow::bail!("private engine request type is missing");
    };
    if !matches!(
        kind,
        "evaluate_request" | "evaluate_response" | "evaluate_context" | "get_capabilities"
    ) {
        anyhow::bail!("private engine request type is not allowed");
    }
    Ok(())
}

pub fn request(message: Value) -> Result<Value> {
    validate_message(&message)?;
    let path = configured_path()?;
    let mut guard = state()
        .lock()
        .map_err(|_| anyhow!("private engine state lock is poisoned"))?;
    ensure_process(&mut guard, &path)?;

    let first = guard
        .process
        .as_mut()
        .context("private engine process unavailable")?
        .request(&message);
    match first {
        Ok(response) => Ok(response),
        Err(first_error) => {
            // A crashed or stale child is restarted once. The caller still gets a
            // normal error if the replacement cannot answer the same bounded request.
            guard.process.take();
            ensure_process(&mut guard, &path).context("restart private engine")?;
            guard
                .process
                .as_mut()
                .context("private engine process unavailable after restart")?
                .request(&message)
                .with_context(|| {
                    format!("private engine request failed after restart: {first_error}")
                })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_bridge_accepts_only_protocol_v2_operation_names() {
        assert!(validate_message(&serde_json::json!({
            "id": "1",
            "type": "evaluate_request",
            "protocolVersion": 2,
            "payload": {}
        }))
        .is_ok());
        assert!(validate_message(&serde_json::json!({
            "id": "1",
            "type": "dump_private_rules",
            "protocolVersion": 2,
            "payload": {}
        }))
        .is_err());
        assert!(validate_message(&serde_json::json!({
            "id": "1",
            "type": "evaluate_request",
            "protocolVersion": 1,
            "payload": {}
        }))
        .is_err());
    }

    #[test]
    fn capability_probe_exposes_only_declared_feature_flags() {
        let response = serde_json::json!({
            "id": "cap",
            "ok": true,
            "protocolVersion": 2,
            "data": {
                "requestEvaluation": true,
                "responseEvaluation": true,
                "contextBudgetEvaluation": true,
                "compactRequestPatches": true,
                "privateRuleDump": true
            }
        });
        let capability = capability_from_probe(true, Some(&response));
        assert_eq!(capability["available"], true);
        assert_eq!(capability["capabilityProbe"], true);
        assert_eq!(capability["contextBudgetEvaluation"], true);
        assert!(capability.get("privateRuleDump").is_none());
    }

    #[test]
    fn capability_probe_treats_older_engines_as_missing_mode_specific_context_features() {
        let response = serde_json::json!({
            "id": "cap",
            "ok": true,
            "protocolVersion": 2,
            "data": { "contextEvaluation": true }
        });
        let capability = capability_from_probe(true, Some(&response));
        assert_eq!(capability["available"], true);
        assert_eq!(capability["contextBudgetEvaluation"], false);
        assert_eq!(capability["contextProfileEvaluation"], false);
        assert!(capability.get("contextEvaluation").is_none());
    }

    #[test]
    fn default_artifact_name_is_stable() {
        assert!(executable_name().starts_with("gptlock-engine"));
    }
}
