mod context_budget;
mod context_profile;

use std::collections::BTreeSet;
use std::io::{self, ErrorKind, Read, Write};

use context_budget::{evaluate_context_budget, ContextBudgetInput};
use context_profile::{evaluate_context_profile, ContextProfileEvaluationInput};
use gptlock_private_engine::{
    evaluate_request, evaluate_response, RequestDecision, RequestEnvelope, ResponseEnvelope,
};
use serde_json::{json, Value};

const PROTOCOL_VERSION: u64 = 2;
const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0_u8; 4];
    match reader.read_exact(&mut length) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame<W: Write>(writer: &mut W, value: &Value) -> io::Result<()> {
    let payload = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error.to_string()))?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "response frame too large",
        ));
    }
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()
}

fn error(id: Value, code: &str, message: impl Into<String>) -> Value {
    json!({
        "id": id,
        "ok": false,
        "protocolVersion": PROTOCOL_VERSION,
        "error": { "code": code, "message": message.into() }
    })
}

fn request_patches(before: &str, after: &str) -> Vec<Value> {
    let Ok(Value::Object(before)) = serde_json::from_str::<Value>(before) else {
        return Vec::new();
    };
    let Ok(Value::Object(after)) = serde_json::from_str::<Value>(after) else {
        return Vec::new();
    };

    let mut keys = BTreeSet::new();
    keys.extend(before.keys().cloned());
    keys.extend(after.keys().cloned());
    let mut patches = Vec::new();
    for key in keys {
        match (before.get(&key), after.get(&key)) {
            (Some(left), Some(right)) if left == right => {}
            (None, Some(value)) => patches.push(json!({
                "op": "add",
                "path": [key],
                "value": value,
            })),
            (Some(_), None) => patches.push(json!({
                "op": "remove",
                "path": [key],
            })),
            (Some(_), Some(value)) => patches.push(json!({
                "op": "replace",
                "path": [key],
                "value": value,
            })),
            (None, None) => {}
        }
    }
    patches
}

fn compact_request_decision(input: &RequestEnvelope, decision: RequestDecision) -> Value {
    let patches = if decision.changed {
        request_patches(&input.post_data, &decision.post_data)
    } else {
        Vec::new()
    };
    let mut value = serde_json::to_value(decision).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.remove("postData");
        object.insert("patches".to_string(), Value::Array(patches));
    }
    value
}

fn evaluate_context_payload(payload: Value) -> Result<Value, String> {
    if payload.get("mode").and_then(Value::as_str) == Some("profile") {
        let profile = payload
            .get("profileEvaluation")
            .cloned()
            .unwrap_or(Value::Null);
        return serde_json::from_value::<ContextProfileEvaluationInput>(profile)
            .map_err(|error| error.to_string())
            .and_then(|input| evaluate_context_profile(&input))
            .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));
    }
    if payload.get("mode").and_then(Value::as_str) == Some("budget") {
        let budget = payload.get("budget").cloned().unwrap_or(Value::Null);
        return serde_json::from_value::<ContextBudgetInput>(budget)
            .map_err(|error| error.to_string())
            .and_then(|input| evaluate_context_budget(&input))
            .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));
    }

    Err("unsupported context evaluation mode".to_string())
}

fn handle(message: Value) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    if message.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return error(
            id,
            "unsupported_protocol",
            "unsupported core bridge protocol version",
        );
    }
    let Some(kind) = message.get("type").and_then(Value::as_str) else {
        return error(id, "invalid_message", "missing message type");
    };
    let payload = message.get("payload").cloned().unwrap_or_else(|| json!({}));

    let result = match kind {
        "get_capabilities" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "requestEvaluation": true,
            "responseEvaluation": true,
            "contextBudgetEvaluation": true,
            "contextProfileEvaluation": true,
            "compactRequestPatches": true
        })),
        "evaluate_request" => serde_json::from_value::<RequestEnvelope>(payload)
            .map(|input| {
                let decision = evaluate_request(&input);
                compact_request_decision(&input, decision)
            })
            .map_err(|error| error.to_string()),
        "evaluate_response" => serde_json::from_value::<ResponseEnvelope>(payload)
            .map(|input| json!(evaluate_response(&input)))
            .map_err(|error| error.to_string()),
        "evaluate_context" => evaluate_context_payload(payload),
        _ => return error(id, "unsupported_message", "unsupported core bridge message"),
    };

    match result {
        Ok(data) => json!({
            "id": id,
            "ok": true,
            "protocolVersion": PROTOCOL_VERSION,
            "data": data
        }),
        Err(message) => error(id, "invalid_payload", message),
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    while let Some(frame) = read_frame(&mut reader)? {
        let message = match serde_json::from_slice::<Value>(&frame) {
            Ok(value) => value,
            Err(error_value) => {
                write_frame(
                    &mut writer,
                    &error(Value::Null, "invalid_json", error_value.to_string()),
                )?;
                continue;
            }
        };
        write_frame(&mut writer, &handle(message))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_protocol_v2() {
        let response = handle(json!({
            "id": "1",
            "type": "get_capabilities",
            "protocolVersion": 2,
            "payload": {}
        }));
        assert_eq!(response["ok"], true);
        assert_eq!(response["protocolVersion"], 2);
        assert_eq!(response["data"]["compactRequestPatches"], true);
        assert_eq!(response["data"]["contextBudgetEvaluation"], true);
        assert_eq!(response["data"]["contextProfileEvaluation"], true);
    }

    #[test]
    fn profile_mode_returns_only_numeric_learning_decision() {
        let response = handle(json!({
            "id": "profile-1",
            "type": "evaluate_context",
            "protocolVersion": 2,
            "payload": {
                "mode": "profile",
                "profileEvaluation": {
                    "event": "successful_bypass",
                    "model": "gpt-5.6-sol",
                    "confirmedConversationTokens": 950000,
                    "confirmedCharacters": 3000000,
                    "noticeText": "must never be echoed"
                }
            }
        }));
        assert_eq!(response["ok"], true);
        assert_eq!(response["data"]["confirmedConversationTokens"], 950000);
        assert_eq!(response["data"]["adaptiveSafeLimitTokens"], 1007000);
        assert!(!response.to_string().contains("must never be echoed"));
    }

    #[test]
    fn compact_request_decision_does_not_echo_the_request_body() {
        let response = handle(json!({
            "id": "2",
            "type": "evaluate_request",
            "protocolVersion": 2,
            "payload": {
                "host": "example.invalid",
                "path": "/ignored",
                "method": "POST",
                "postData": "{\"message\":\"secret text\"}",
                "lockedModels": [],
                "allowedReasoningLevels": [],
                "preferredReasoning": null
            }
        }));
        assert_eq!(response["ok"], true);
        assert!(response["data"].get("postData").is_none());
        assert_eq!(response["data"]["patches"], json!([]));
        assert!(!response.to_string().contains("secret text"));
    }

    #[test]
    fn context_evaluation_requires_an_explicit_private_mode() {
        let response = handle(json!({
            "id": "ctx-1",
            "type": "evaluate_context",
            "protocolVersion": 2,
            "payload": {
                "snapshot": { "fallbackRemainingTokens": 800000 },
                "profile": {}
            }
        }));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "invalid_payload");
        assert!(response["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("unsupported context evaluation mode"));
    }

    #[test]
    fn budget_mode_keeps_model_window_and_token_math_private() {
        let response = handle(json!({
            "id": "ctx-budget-1",
            "type": "evaluate_context",
            "protocolVersion": 2,
            "payload": {
                "mode": "budget",
                "budget": {
                    "model": "gpt-5.6-sol",
                    "history": [{"text": "hello world", "images": 0, "attachments": 0}],
                    "draft": {"text": "你好", "images": 0, "attachments": 0},
                    "profile": {}
                }
            }
        }));
        assert_eq!(response["ok"], true);
        assert_eq!(response["data"]["nominalLimitTokens"], 1_050_000);
        assert_eq!(response["data"]["baseSafeLimitTokens"], 924_000);
        assert!(response["data"]["remainingPercent"].as_f64().unwrap() > 90.0);
        assert!(response["data"].get("history").is_none());
        assert!(!response.to_string().contains("hello world"));
        assert!(!response.to_string().contains("你好"));
    }

    #[test]
    fn top_level_patch_diff_is_generic() {
        let patches = request_patches("{\"a\":1,\"b\":2}", "{\"a\":3,\"c\":4}");
        assert_eq!(patches.len(), 3);
        assert!(patches
            .iter()
            .any(|patch| patch["op"] == "replace" && patch["path"] == json!(["a"])));
        assert!(patches
            .iter()
            .any(|patch| patch["op"] == "remove" && patch["path"] == json!(["b"])));
        assert!(patches
            .iter()
            .any(|patch| patch["op"] == "add" && patch["path"] == json!(["c"])));
    }
}
