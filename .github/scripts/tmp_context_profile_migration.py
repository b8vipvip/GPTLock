from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{path}: expected one target, found {n}')
    p.write_text(s.replace(old, new, 1))


# Private numeric learning engine.
Path('private-engine/src/context_profile.rs').write_text(r'''use serde::{Deserialize, Serialize};

use crate::context_budget::base_safe_limit_for_model;

const LEARNING_HEADROOM_RATIO: f64 = 0.06;
const LEARNING_HEADROOM_MIN_TOKENS: u64 = 8_192;
const LEARNING_HEADROOM_MAX_TOKENS: u64 = 128_000;
const MAX_ADAPTIVE_LIMIT_TOKENS: u64 = 16_000_000;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextProfileNumbers {
    pub confirmed_conversation_tokens: Option<u64>,
    pub confirmed_characters: Option<u64>,
    pub adaptive_safe_limit_tokens: Option<u64>,
    pub successful_bypass_count: Option<u64>,
    pub hard_limit_upper_bound_tokens: Option<u64>,
    pub hard_limit_observed_count: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextProfileEvaluationInput {
    pub event: String,
    pub model: Option<String>,
    #[serde(default)]
    pub previous: ContextProfileNumbers,
    pub confirmed_conversation_tokens: Option<u64>,
    pub confirmed_characters: Option<u64>,
    pub observed_conversation_tokens: Option<u64>,
    #[serde(default)]
    pub measurement_reliable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextProfileEvaluationResult {
    pub confirmed_conversation_tokens: u64,
    pub confirmed_characters: u64,
    pub adaptive_safe_limit_tokens: u64,
    pub successful_bypass_count: u64,
    pub hard_limit_upper_bound_tokens: u64,
    pub hard_limit_observed_count: u64,
    pub hard_limit_token_cap_usable: bool,
    pub hard_limit_confidence: String,
}

fn clamp_metric(value: Option<u64>) -> u64 {
    value.unwrap_or_default().min(MAX_ADAPTIVE_LIMIT_TOKENS)
}

fn learning_headroom_tokens(confirmed: u64) -> u64 {
    ((confirmed as f64 * LEARNING_HEADROOM_RATIO).round() as u64)
        .clamp(LEARNING_HEADROOM_MIN_TOKENS, LEARNING_HEADROOM_MAX_TOKENS)
}

pub fn evaluate_context_profile(
    input: &ContextProfileEvaluationInput,
) -> Result<ContextProfileEvaluationResult, String> {
    let mut confirmed = clamp_metric(input.previous.confirmed_conversation_tokens);
    let mut confirmed_characters = input.previous.confirmed_characters.unwrap_or_default();
    let mut adaptive = clamp_metric(input.previous.adaptive_safe_limit_tokens);
    let mut successful_count = input.previous.successful_bypass_count.unwrap_or_default();
    let mut hard_upper = clamp_metric(input.previous.hard_limit_upper_bound_tokens);
    let mut hard_count = input.previous.hard_limit_observed_count.unwrap_or_default();
    let mut hard_confidence = if hard_upper > confirmed {
        "measured-upper-bound"
    } else {
        "ui-boundary-only"
    };

    match input.event.as_str() {
        "successful_bypass" => {
            let observed = clamp_metric(input.confirmed_conversation_tokens);
            if observed == 0 {
                return Err("successful bypass requires confirmedConversationTokens".to_string());
            }
            confirmed = confirmed.max(observed);
            confirmed_characters = confirmed_characters.max(input.confirmed_characters.unwrap_or_default());
            let candidate = confirmed.saturating_add(learning_headroom_tokens(confirmed));
            adaptive = adaptive
                .max(candidate.min(MAX_ADAPTIVE_LIMIT_TOKENS))
                .max(base_safe_limit_for_model(input.model.as_deref()));
            successful_count = successful_count.saturating_add(1);
        }
        "hard_limit" => {
            let observed = clamp_metric(input.observed_conversation_tokens);
            let usable = input.measurement_reliable && observed > confirmed;
            if usable {
                hard_upper = if hard_upper > confirmed {
                    hard_upper.min(observed)
                } else {
                    observed
                };
                hard_confidence = "measured-upper-bound";
            } else {
                hard_confidence = "ui-boundary-only";
            }
            hard_count = hard_count.saturating_add(1);
        }
        _ => return Err("unsupported context profile event".to_string()),
    }

    Ok(ContextProfileEvaluationResult {
        confirmed_conversation_tokens: confirmed,
        confirmed_characters,
        adaptive_safe_limit_tokens: adaptive,
        successful_bypass_count: successful_count,
        hard_limit_upper_bound_tokens: hard_upper,
        hard_limit_observed_count: hard_count,
        hard_limit_token_cap_usable: hard_upper > confirmed,
        hard_limit_confidence: hard_confidence.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_bypass_derives_adaptive_budget_privately() {
        let result = evaluate_context_profile(&ContextProfileEvaluationInput {
            event: "successful_bypass".to_string(),
            model: Some("gpt-5.6-sol".to_string()),
            confirmed_conversation_tokens: Some(950_000),
            confirmed_characters: Some(3_000_000),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(result.confirmed_conversation_tokens, 950_000);
        assert_eq!(result.adaptive_safe_limit_tokens, 1_007_000);
        assert_eq!(result.successful_bypass_count, 1);
    }

    #[test]
    fn reliable_hard_limit_tightens_only_above_confirmed_lower_bound() {
        let result = evaluate_context_profile(&ContextProfileEvaluationInput {
            event: "hard_limit".to_string(),
            previous: ContextProfileNumbers {
                confirmed_conversation_tokens: Some(900_000),
                hard_limit_upper_bound_tokens: Some(1_000_000),
                hard_limit_observed_count: Some(2),
                ..Default::default()
            },
            observed_conversation_tokens: Some(960_000),
            measurement_reliable: true,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(result.hard_limit_upper_bound_tokens, 960_000);
        assert!(result.hard_limit_token_cap_usable);
        assert_eq!(result.hard_limit_observed_count, 3);
        assert_eq!(result.hard_limit_confidence, "measured-upper-bound");
    }

    #[test]
    fn unreliable_hard_limit_does_not_create_a_numeric_cap() {
        let result = evaluate_context_profile(&ContextProfileEvaluationInput {
            event: "hard_limit".to_string(),
            observed_conversation_tokens: Some(123_456),
            measurement_reliable: false,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(result.hard_limit_upper_bound_tokens, 0);
        assert!(!result.hard_limit_token_cap_usable);
        assert_eq!(result.hard_limit_confidence, "ui-boundary-only");
    }
}
''')

# Share only the private model-derived base budget internally between private modules.
replace_once(
    'private-engine/src/context_budget.rs',
    '''fn model_window(model: Option<&str>) -> (u64, &'static str) {\n''',
    '''fn model_window(model: Option<&str>) -> (u64, &'static str) {\n''',
)
replace_once(
    'private-engine/src/context_budget.rs',
    '''fn estimate_text_tokens(value: &str) -> u64 {\n''',
    '''pub(crate) fn base_safe_limit_for_model(model: Option<&str>) -> u64 {\n    let (nominal, _) = model_window(model);\n    (nominal.max(16_000) as f64 * SAFETY_BUDGET_RATIO).floor() as u64\n}\n\nfn estimate_text_tokens(value: &str) -> u64 {\n''',
)
replace_once(
    'private-engine/src/context_budget.rs',
    '''    let base_safe_limit_tokens = (nominal_limit_tokens as f64 * SAFETY_BUDGET_RATIO).floor() as u64;\n''',
    '''    let base_safe_limit_tokens = base_safe_limit_for_model(input.model.as_deref());\n''',
)

# Private engine protocol mode + capability.
replace_once('private-engine/src/main.rs', 'mod context_budget;\n', 'mod context_budget;\nmod context_profile;\n')
replace_once(
    'private-engine/src/main.rs',
    '''use context_budget::{evaluate_context_budget, ContextBudgetInput};\n''',
    '''use context_budget::{evaluate_context_budget, ContextBudgetInput};\nuse context_profile::{evaluate_context_profile, ContextProfileEvaluationInput};\n''',
)
replace_once(
    'private-engine/src/main.rs',
    '''fn evaluate_context_payload(payload: Value) -> Result<Value, String> {\n    if payload.get("mode").and_then(Value::as_str) == Some("budget") {\n''',
    '''fn evaluate_context_payload(payload: Value) -> Result<Value, String> {\n    if payload.get("mode").and_then(Value::as_str) == Some("profile") {\n        let profile = payload.get("profileEvaluation").cloned().unwrap_or(Value::Null);\n        return serde_json::from_value::<ContextProfileEvaluationInput>(profile)\n            .map_err(|error| error.to_string())\n            .and_then(|input| evaluate_context_profile(&input))\n            .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));\n    }\n    if payload.get("mode").and_then(Value::as_str) == Some("budget") {\n''',
)
replace_once(
    'private-engine/src/main.rs',
    '''            "contextBudgetEvaluation": true,\n            "compactRequestPatches": true\n''',
    '''            "contextBudgetEvaluation": true,\n            "contextProfileEvaluation": true,\n            "compactRequestPatches": true\n''',
)
replace_once(
    'private-engine/src/main.rs',
    '''        assert_eq!(response["data"]["contextBudgetEvaluation"], true);\n''',
    '''        assert_eq!(response["data"]["contextBudgetEvaluation"], true);\n        assert_eq!(response["data"]["contextProfileEvaluation"], true);\n''',
)
# Add protocol-level profile test before compact request test.
replace_once(
    'private-engine/src/main.rs',
    '''    #[test]\n    fn compact_request_decision_does_not_echo_the_request_body() {\n''',
    '''    #[test]\n    fn profile_mode_returns_only_numeric_learning_decision() {\n        let response = handle(json!({\n            "id": "profile-1",\n            "type": "evaluate_context",\n            "protocolVersion": 2,\n            "payload": {\n                "mode": "profile",\n                "profileEvaluation": {\n                    "event": "successful_bypass",\n                    "model": "gpt-5.6-sol",\n                    "confirmedConversationTokens": 950000,\n                    "confirmedCharacters": 3000000,\n                    "noticeText": "must never be echoed"\n                }\n            }\n        }));\n        assert_eq!(response["ok"], true);\n        assert_eq!(response["data"]["confirmedConversationTokens"], 950000);\n        assert_eq!(response["data"]["adaptiveSafeLimitTokens"], 1007000);\n        assert!(!response.to_string().contains("must never be echoed"));\n    }\n\n    #[test]\n    fn compact_request_decision_does_not_echo_the_request_body() {\n''',
)

# Native-core capability whitelist.
replace_once(
    'native-core/src/private_engine.rs',
    '''        "contextBudgetEvaluation": false,\n        "compactRequestPatches": false,\n''',
    '''        "contextBudgetEvaluation": false,\n        "contextProfileEvaluation": false,\n        "compactRequestPatches": false,\n''',
)
replace_once(
    'native-core/src/private_engine.rs',
    '''        "contextBudgetEvaluation",\n        "compactRequestPatches",\n''',
    '''        "contextBudgetEvaluation",\n        "contextProfileEvaluation",\n        "compactRequestPatches",\n''',
)

# Browser capability whitelist.
replace_once(
    'extension/private-core-channel.js',
    '''  'contextBudgetEvaluation',\n  'compactRequestPatches',\n''',
    '''  'contextBudgetEvaluation',\n  'contextProfileEvaluation',\n  'compactRequestPatches',\n''',
)

# Extension bridge: numeric-only profile event/result.
path = 'extension/private-context-bridge.js'
replace_once(
    path,
    '''const BUDGET_MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_BUDGET';\n''',
    '''const BUDGET_MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_BUDGET';\nconst PROFILE_MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_PROFILE';\n''',
)
insert_after = '''export function sanitizePrivateContextBudgetPayload(value = {}) {\n'''
idx_path = Path(path)
s = idx_path.read_text()
pos = s.index(insert_after)
# place profile helpers before budget sanitizer
profile_helpers = r'''export function sanitizePrivateContextProfilePayload(value = {}) {
  const event = String(value?.event ?? '').trim();
  if (!['successful_bypass', 'hard_limit'].includes(event)) {
    throw new TypeError('private context profile event is invalid');
  }
  const previous = value?.previous && typeof value.previous === 'object' ? value.previous : {};
  return {
    event,
    model: normalizeModel(value?.model),
    previous: {
      confirmedConversationTokens: boundedMetric(previous.confirmedConversationTokens),
      confirmedCharacters: boundedMetric(previous.confirmedCharacters),
      adaptiveSafeLimitTokens: boundedMetric(previous.adaptiveSafeLimitTokens),
      successfulBypassCount: boundedMetric(previous.successfulBypassCount),
      hardLimitUpperBoundTokens: boundedMetric(previous.hardLimitUpperBoundTokens),
      hardLimitObservedCount: boundedMetric(previous.hardLimitObservedCount),
    },
    confirmedConversationTokens: boundedMetric(value?.confirmedConversationTokens),
    confirmedCharacters: boundedMetric(value?.confirmedCharacters),
    observedConversationTokens: boundedMetric(value?.observedConversationTokens),
    measurementReliable: value?.measurementReliable === true,
  };
}

export function normalizePrivateContextProfileResult(value) {
  const confidence = String(value?.hardLimitConfidence ?? '').trim();
  if (!['measured-upper-bound', 'ui-boundary-only'].includes(confidence)) {
    throw new TypeError('private context profile confidence is invalid');
  }
  return {
    confirmedConversationTokens: requiredMetric(value?.confirmedConversationTokens, 'confirmedConversationTokens'),
    confirmedCharacters: requiredMetric(value?.confirmedCharacters, 'confirmedCharacters'),
    adaptiveSafeLimitTokens: requiredMetric(value?.adaptiveSafeLimitTokens, 'adaptiveSafeLimitTokens'),
    successfulBypassCount: requiredMetric(value?.successfulBypassCount, 'successfulBypassCount'),
    hardLimitUpperBoundTokens: requiredMetric(value?.hardLimitUpperBoundTokens, 'hardLimitUpperBoundTokens'),
    hardLimitObservedCount: requiredMetric(value?.hardLimitObservedCount, 'hardLimitObservedCount'),
    hardLimitTokenCapUsable: value?.hardLimitTokenCapUsable === true,
    hardLimitConfidence: confidence,
  };
}

'''
s = s[:pos] + profile_helpers + s[pos:]
idx_path.write_text(s)
replace_once(
    path,
    '''  if (![REMAINING_MESSAGE_TYPE, BUDGET_MESSAGE_TYPE].includes(message?.type)) return false;\n''',
    '''  if (![REMAINING_MESSAGE_TYPE, BUDGET_MESSAGE_TYPE, PROFILE_MESSAGE_TYPE].includes(message?.type)) return false;\n''',
)
replace_once(
    path,
    '''    try {\n      if (message.type === BUDGET_MESSAGE_TYPE) {\n''',
    '''    try {\n      if (message.type === PROFILE_MESSAGE_TYPE) {\n        if (!(await privateCoreChannel.supports('contextProfileEvaluation'))) {\n          sendResponse({ ok: false, error: 'private_context_profile_unsupported' });\n          return;\n        }\n        const profileEvaluation = sanitizePrivateContextProfilePayload(message.payload);\n        const raw = await privateCoreChannel.request(\n          'evaluate_context',\n          { mode: 'profile', profileEvaluation },\n          'context-profile',\n        );\n        sendResponse({ ok: true, data: normalizePrivateContextProfileResult(raw) });\n        return;\n      }\n      if (message.type === BUDGET_MESSAGE_TYPE) {\n''',
)
replace_once(
    path,
    '''  BUDGET_MESSAGE_TYPE as PRIVATE_CONTEXT_BUDGET_MESSAGE_TYPE,\n};\n''',
    '''  BUDGET_MESSAGE_TYPE as PRIVATE_CONTEXT_BUDGET_MESSAGE_TYPE,\n  PROFILE_MESSAGE_TYPE as PRIVATE_CONTEXT_PROFILE_MESSAGE_TYPE,\n};\n''',
)

# Legacy collector uses private numeric learning first, keeping old math only as fallback.
path = 'extension/context-budget.js'
replace_once(
    path,
    '''  const AUTO_PROBE_PREFIX = 'GPTLock 自动验证';\n''',
    '''  const AUTO_PROBE_PREFIX = 'GPTLock 自动验证';\n  const PRIVATE_CONTEXT_PROFILE_MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_PROFILE';\n''',
)
# helper before persistHardLimitObservation
replace_once(
    path,
    '''  async function persistHardLimitObservation(snapshot, notice) {\n''',
    '''  async function evaluatePrivateContextProfile(event, payload = {}) {\n    try {\n      const response = await chrome.runtime.sendMessage({\n        type: PRIVATE_CONTEXT_PROFILE_MESSAGE_TYPE,\n        payload: { event, ...payload },\n      });\n      return response?.ok && response.data ? response.data : null;\n    } catch {\n      return null;\n    }\n  }\n\n  async function persistHardLimitObservation(snapshot, notice) {\n''',
)
old_hard = '''      const stored = await chrome.storage.local.get(key);\n      const previous = stored[key] ?? null;\n      const measurementReliable = ['conversation-tree+dom-reconcile', 'checkpoint+dom-restore'].includes(snapshot.historyMeasurementSource);\n      const next = nextHardLimitProfile({\n        previous,\n        accountScope: currentAccountScope,\n        accountScopeSource: currentAccountScopeSource || 'unknown',\n        model,\n        observedConversationTokens: observedTokens,\n        observedCharacters: Math.max(snapshot.fullConversationCharacters || 0, snapshot.cumulativeConversationCharacters || 0),\n        observedMessages: Math.max(snapshot.messageCount || 0, snapshot.cumulativeMessageCount || 0),\n        conversationKey: snapshot.conversationKey,\n        measuredAt: new Date().toISOString(),\n        measurementSource: snapshot.historyMeasurementSource,\n        measurementReliable,\n        noticeText: notice.text,\n        actionText: notice.actionText,\n      });\n'''
new_hard = '''      const stored = await chrome.storage.local.get(key);\n      const previous = stored[key] ?? null;\n      const measurementReliable = ['conversation-tree+dom-reconcile', 'checkpoint+dom-restore'].includes(snapshot.historyMeasurementSource);\n      const observedCharacters = Math.max(snapshot.fullConversationCharacters || 0, snapshot.cumulativeConversationCharacters || 0);\n      const observedMessages = Math.max(snapshot.messageCount || 0, snapshot.cumulativeMessageCount || 0);\n      const measuredAt = new Date().toISOString();\n      const privateNumbers = await evaluatePrivateContextProfile('hard_limit', {\n        model,\n        previous,\n        observedConversationTokens: observedTokens,\n        measurementReliable,\n      });\n      const next = privateNumbers ? {\n        ...(previous && typeof previous === 'object' ? previous : {}),\n        schemaVersion: 1,\n        accountScope: currentAccountScope,\n        accountScopeSource: currentAccountScopeSource || 'unknown',\n        model,\n        hardLimitObserved: true,\n        hardLimitObservedCount: privateNumbers.hardLimitObservedCount,\n        hardLimitObservedTokens: observedTokens,\n        hardLimitObservedCharacters: Math.max(0, Math.ceil(Number(observedCharacters) || 0)),\n        hardLimitObservedMessages: Math.max(0, Math.ceil(Number(observedMessages) || 0)),\n        hardLimitUpperBoundTokens: privateNumbers.hardLimitUpperBoundTokens,\n        hardLimitTokenCapUsable: privateNumbers.hardLimitTokenCapUsable,\n        hardLimitConfidence: privateNumbers.hardLimitConfidence,\n        hardLimitMeasurementSource: String(snapshot.historyMeasurementSource || 'unknown').slice(0, 80),\n        hardLimitLastObservedAt: measuredAt,\n        hardLimitLastConversationKey: String(snapshot.conversationKey || 'unknown').slice(0, 256),\n        hardLimitLastText: String(notice.text || '').replace(/\\s+/g, ' ').trim().slice(0, 500),\n        hardLimitActionText: String(notice.actionText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),\n        hardLimitEvidence: 'chatgpt-visible-conversation-length-limit',\n        numericDerivation: 'private-engine',\n      } : nextHardLimitProfile({\n        previous,\n        accountScope: currentAccountScope,\n        accountScopeSource: currentAccountScopeSource || 'unknown',\n        model,\n        observedConversationTokens: observedTokens,\n        observedCharacters,\n        observedMessages,\n        conversationKey: snapshot.conversationKey,\n        measuredAt,\n        measurementSource: snapshot.historyMeasurementSource,\n        measurementReliable,\n        noticeText: notice.text,\n        actionText: notice.actionText,\n      });\n'''
replace_once(path, old_hard, new_hard)
old_learn = '''    // A successful answer proves the input accepted at send time, not the answer-inclusive post state.\n    const confirmedConversationTokens = Math.ceil(pendingBypass.preSnapshot?.usedTokens || 0);\n    const windowProfile = contextWindowForModel(model);\n    const baseSafeLimitTokens = Math.floor(windowProfile.tokens * SAFETY_BUDGET_RATIO);\n    try {\n      const stored = await chrome.storage.local.get(key);\n      const previous = stored[key] ?? null;\n      const next = nextLearnedProfile({\n        previous,\n        accountScope,\n        accountScopeSource,\n        model,\n        confirmedConversationTokens,\n        confirmedCharacters: pendingBypass.preSnapshot?.fullConversationCharacters || 0,\n        conversationKey: postSnapshot.conversationKey,\n        measuredAt: new Date().toISOString(),\n        baseSafeLimitTokens,\n      });\n'''
new_learn = '''    // A successful answer proves the input accepted at send time, not the answer-inclusive post state.\n    const confirmedConversationTokens = Math.ceil(pendingBypass.preSnapshot?.usedTokens || 0);\n    const confirmedCharacters = pendingBypass.preSnapshot?.fullConversationCharacters || 0;\n    const measuredAt = new Date().toISOString();\n    try {\n      const stored = await chrome.storage.local.get(key);\n      const previous = stored[key] ?? null;\n      const privateNumbers = await evaluatePrivateContextProfile('successful_bypass', {\n        model,\n        previous,\n        confirmedConversationTokens,\n        confirmedCharacters,\n      });\n      let next = null;\n      if (privateNumbers) {\n        next = {\n          ...(previous && typeof previous === 'object' ? previous : {}),\n          schemaVersion: 1,\n          accountScope,\n          accountScopeSource,\n          model,\n          confirmedConversationTokens: privateNumbers.confirmedConversationTokens,\n          confirmedCharacters: privateNumbers.confirmedCharacters,\n          adaptiveSafeLimitTokens: privateNumbers.adaptiveSafeLimitTokens,\n          successfulBypassCount: privateNumbers.successfulBypassCount,\n          firstConfirmedAt: previous?.firstConfirmedAt || measuredAt,\n          lastConfirmedAt: measuredAt,\n          lastConversationKey: String(postSnapshot.conversationKey || 'unknown').slice(0, 256),\n          evidence: 'explicit-over-limit-send+formal-request+settled-assistant-turn',\n          numericDerivation: 'private-engine',\n        };\n      } else {\n        const windowProfile = contextWindowForModel(model);\n        const baseSafeLimitTokens = Math.floor(windowProfile.tokens * SAFETY_BUDGET_RATIO);\n        next = nextLearnedProfile({\n          previous,\n          accountScope,\n          accountScopeSource,\n          model,\n          confirmedConversationTokens,\n          confirmedCharacters,\n          conversationKey: postSnapshot.conversationKey,\n          measuredAt,\n          baseSafeLimitTokens,\n        });\n      }\n'''
replace_once(path, old_learn, new_learn)

# JS bridge tests gain profile sanitization/result assertions.
path = 'extension/tests/private-context-bridge.test.mjs'
s = Path(path).read_text()
s = s.replace(
    '''  normalizePrivateContextBudgetResult,\n''',
    '''  normalizePrivateContextBudgetResult,\n  sanitizePrivateContextProfilePayload,\n  normalizePrivateContextProfileResult,\n''',
    1,
)
s += r'''

test('private context profile bridge strips metadata and keeps numeric learning facts', () => {
  const payload = sanitizePrivateContextProfilePayload({
    event: 'successful_bypass',
    model: 'GPT-5.6-SOL',
    previous: {
      confirmedConversationTokens: 900000,
      adaptiveSafeLimitTokens: 950000,
      successfulBypassCount: 2,
      noticeText: 'secret',
    },
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    accountScope: 'must-not-cross',
  });
  assert.deepEqual(payload, {
    event: 'successful_bypass',
    model: 'gpt-5.6-sol',
    previous: {
      confirmedConversationTokens: 900000,
      confirmedCharacters: null,
      adaptiveSafeLimitTokens: 950000,
      successfulBypassCount: 2,
      hardLimitUpperBoundTokens: null,
      hardLimitObservedCount: null,
    },
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    observedConversationTokens: null,
    measurementReliable: false,
  });
  assert.doesNotMatch(JSON.stringify(payload), /accountScope|noticeText|secret|must-not-cross/);
});

test('private context profile result accepts only compact numeric decisions', () => {
  const result = normalizePrivateContextProfileResult({
    confirmedConversationTokens: 960000,
    confirmedCharacters: 3000000,
    adaptiveSafeLimitTokens: 1017600,
    successfulBypassCount: 3,
    hardLimitUpperBoundTokens: 0,
    hardLimitObservedCount: 0,
    hardLimitTokenCapUsable: false,
    hardLimitConfidence: 'ui-boundary-only',
    privateFormula: 'must-not-survive',
  });
  assert.equal(result.adaptiveSafeLimitTokens, 1017600);
  assert.equal(result.successfulBypassCount, 3);
  assert.equal(Object.hasOwn(result, 'privateFormula'), false);
});
'''
Path(path).write_text(s)

# Capability test includes new feature.
path = 'extension/tests/private-core-channel-capability.test.mjs'
s = Path(path).read_text()
s = s.replace(
    '''        contextBudgetEvaluation: true,\n        contextEvaluation: true,\n''',
    '''        contextBudgetEvaluation: true,\n        contextProfileEvaluation: true,\n        contextEvaluation: true,\n''',
    1,
)
s = s.replace(
    '''  assert.equal(capability.contextBudgetEvaluation, true);\n  assert.equal(capability.contextEvaluation, true);\n''',
    '''  assert.equal(capability.contextBudgetEvaluation, true);\n  assert.equal(capability.contextProfileEvaluation, true);\n  assert.equal(capability.contextEvaluation, true);\n''',
    1,
)
Path(path).write_text(s)

# Static integration: private learning must be attempted before legacy formula fallback.
Path('extension/tests/private-context-profile-integration.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../context-budget.js', import.meta.url), 'utf8');

test('successful bypass learning is private-first with legacy compatibility fallback', () => {
  const start = source.indexOf('async function persistLearnedProfile');
  const end = source.indexOf('async function maybeFinalizeBypassLearning', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('successful_bypass'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /nextLearnedProfile\(/);
  assert.ok(block.indexOf("evaluatePrivateContextProfile('successful_bypass'") < block.indexOf('nextLearnedProfile('));
});

test('hard-limit learning is private-first with legacy compatibility fallback', () => {
  const start = source.indexOf('async function persistHardLimitObservation');
  const end = source.indexOf('async function refreshAccountScope', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('hard_limit'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /nextHardLimitProfile\(/);
  assert.ok(block.indexOf("evaluatePrivateContextProfile('hard_limit'") < block.indexOf('nextHardLimitProfile('));
});
''')
