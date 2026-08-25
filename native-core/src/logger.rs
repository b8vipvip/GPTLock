use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::verifier::{
    Confidence, EvidenceSource, PolicyDecision, ReasonCode, Verdict, VerificationResult,
};

const AUDIT_FILE_NAME: &str = "audit.jsonl";
const ROTATED_AUDIT_FILE_NAME: &str = "audit.1.jsonl";
const MAX_AUDIT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct AuditLogger {
    path: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

impl AuditLogger {
    pub fn new(logs_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&logs_dir).context("create GPTLock audit directory")?;
        Ok(Self {
            path: logs_dir.join(AUDIT_FILE_NAME),
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record_verification(&self, result: &VerificationResult) -> Result<()> {
        self.append(&VerificationAuditRecord {
            timestamp: result.verified_at,
            event: "verification",
            request_id: result.request_id.as_deref(),
            model: result.model.as_deref(),
            reasoning: result.reasoning.as_deref(),
            evidence_source: result.evidence_source,
            confidence: result.confidence,
            verdict: result.verdict,
            decision: result.decision,
            reasons: &result.reasons,
            policy_revision: &result.policy_revision,
        })
    }

    pub fn record_policy_update(&self, revision: &str, source: &str) -> Result<()> {
        self.append(&PolicyAuditRecord {
            timestamp: Utc::now(),
            event: "policy_update",
            source,
            policy_revision: revision,
        })
    }

    fn append<T: Serialize>(&self, record: &T) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("audit log lock is poisoned"))?;
        self.rotate_if_needed()?;

        let mut options = OpenOptions::new();
        options.create(true).append(true);
        set_private_file_options(&mut options);
        let mut file = options.open(&self.path).context("open GPTLock audit log")?;
        set_private_file_permissions(&file)?;
        serde_json::to_writer(&mut file, record).context("serialize GPTLock audit record")?;
        file.write_all(b"\n")
            .context("append GPTLock audit record")?;
        file.flush().context("flush GPTLock audit log")?;
        Ok(())
    }

    fn rotate_if_needed(&self) -> Result<()> {
        let Ok(metadata) = fs::metadata(&self.path) else {
            return Ok(());
        };
        if metadata.len() < MAX_AUDIT_BYTES {
            return Ok(());
        }

        let rotated = self.path.with_file_name(ROTATED_AUDIT_FILE_NAME);
        if rotated.exists() {
            fs::remove_file(&rotated).context("remove old GPTLock audit archive")?;
        }
        fs::rename(&self.path, &rotated).context("rotate GPTLock audit log")?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationAuditRecord<'a> {
    timestamp: DateTime<Utc>,
    event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<&'a str>,
    evidence_source: EvidenceSource,
    confidence: Confidence,
    verdict: Verdict,
    decision: PolicyDecision,
    reasons: &'a [ReasonCode],
    policy_revision: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyAuditRecord<'a> {
    timestamp: DateTime<Utc>,
    event: &'static str,
    source: &'a str,
    policy_revision: &'a str,
}

#[cfg(unix)]
fn set_private_file_options(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn set_private_file_options(_options: &mut OpenOptions) {}

#[cfg(unix)]
fn set_private_file_permissions(file: &std::fs::File) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .context("secure GPTLock audit log")
}

#[cfg(not(unix))]
fn set_private_file_permissions(_file: &std::fs::File) -> Result<()> {
    Ok(())
}
