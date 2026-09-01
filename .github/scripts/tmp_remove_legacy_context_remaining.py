from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    source = p.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one target, found {count}: {old[:100]!r}")
    p.write_text(source.replace(old, new, 1))


def replace_between(path, start, end, replacement=''):
    p = Path(path)
    source = p.read_text()
    a = source.find(start)
    if a < 0:
        raise SystemExit(f"{path}: missing start marker {start!r}")
    b = source.find(end, a)
    if b < 0:
        raise SystemExit(f"{path}: missing end marker {end!r}")
    p.write_text(source[:a] + replacement + source[b:])

# Stop loading/checking the duplicate old indicator.
replace_once('extension/manifest.json', '        "model-auto-lock.js",\n        "private-context-indicator.js"\n', '        "model-auto-lock.js"\n')
replace_once('extension/package.json', ' && node --check private-context-indicator.js', '')

# Browser capability contract no longer advertises the obsolete coarse contextEvaluation feature.
replace_once('extension/private-core-channel.js', "  'contextEvaluation',\n", '')

# Remove the old remaining bridge message and helpers; keep budget/profile modes only.
bridge = Path('extension/private-context-bridge.js')
s = bridge.read_text()
s = s.replace("const REMAINING_MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_EVALUATE';\n", '')
a = s.find('export function sanitizePrivateContextPayload(value = {}) {\n')
b = s.find('export function sanitizePrivateContextProfilePayload(value = {}) {\n', a)
if a < 0 or b < 0: raise SystemExit('bridge old payload helper markers missing')
s = s[:a] + s[b:]
a = s.find('export function normalizePrivateContextResult(value) {\n')
b = s.find('function requiredMetric(value, name) {\n', a)
if a < 0 or b < 0: raise SystemExit('bridge old result helper markers missing')
s = s[:a] + s[b:]
s = s.replace(
    "  if (![REMAINING_MESSAGE_TYPE, BUDGET_MESSAGE_TYPE, PROFILE_MESSAGE_TYPE].includes(message?.type)) return false;\n",
    "  if (![BUDGET_MESSAGE_TYPE, PROFILE_MESSAGE_TYPE].includes(message?.type)) return false;\n",
)
old = '''      if (!(await privateCoreChannel.isAvailable())) {\n        sendResponse({ ok: false, error: 'private_engine_unavailable' });\n        return;\n      }\n      const payload = sanitizePrivateContextPayload(message.payload);\n      const raw = await privateCoreChannel.request('evaluate_context', payload, 'context');\n      sendResponse({ ok: true, data: normalizePrivateContextResult(raw) });\n'''
if s.count(old) != 1: raise SystemExit('bridge old remaining listener branch missing')
s = s.replace(old, '', 1)
s = s.replace('  REMAINING_MESSAGE_TYPE as PRIVATE_CONTEXT_MESSAGE_TYPE,\n', '')
bridge.write_text(s)

# Native bridge feature whitelist follows the new explicit context modes.
native = Path('native-core/src/private_engine.rs')
s = native.read_text()
s = s.replace('        "contextEvaluation": false,\n', '')
s = s.replace('        "contextEvaluation",\n', '')
s = s.replace('                "contextEvaluation": true,\n', '')
old = '''    #[test]\n    fn capability_probe_is_backward_compatible_with_an_older_engine() {\n        let response = serde_json::json!({\n            "id": "cap",\n            "ok": true,\n            "protocolVersion": 2,\n            "data": { "contextEvaluation": true }\n        });\n        let capability = capability_from_probe(true, Some(&response));\n        assert_eq!(capability["available"], true);\n        assert_eq!(capability["contextEvaluation"], true);\n        assert_eq!(capability["contextBudgetEvaluation"], false);\n    }\n\n'''
if s.count(old) != 1: raise SystemExit('native old-engine capability test missing')
s = s.replace(old, '''    #[test]\n    fn capability_probe_treats_older_engines_as_missing_mode_specific_context_features() {\n        let response = serde_json::json!({\n            "id": "cap",\n            "ok": true,\n            "protocolVersion": 2,\n            "data": { "contextEvaluation": true }\n        });\n        let capability = capability_from_probe(true, Some(&response));\n        assert_eq!(capability["available"], true);\n        assert_eq!(capability["contextBudgetEvaluation"], false);\n        assert_eq!(capability["contextProfileEvaluation"], false);\n        assert!(capability.get("contextEvaluation").is_none());\n    }\n\n''', 1)
native.write_text(s)

# Private engine requires explicit mode and no longer includes the obsolete remaining calculator.
main = Path('private-engine/src/main.rs')
s = main.read_text()
old = '''use gptlock_private_engine::{\n    context_remaining, evaluate_request, evaluate_response, ContextProfile, ContextSnapshot,\n    RequestDecision, RequestEnvelope, ResponseEnvelope,\n};\n'''
new = '''use gptlock_private_engine::{\n    evaluate_request, evaluate_response, RequestDecision, RequestEnvelope, ResponseEnvelope,\n};\n'''
if s.count(old) != 1: raise SystemExit('main legacy imports missing')
s = s.replace(old, new, 1)
old = '''    let snapshot = payload.get("snapshot").cloned().unwrap_or(Value::Null);\n    let profile = payload.get("profile").cloned().unwrap_or_else(|| json!({}));\n    serde_json::from_value::<ContextSnapshot>(snapshot)\n        .and_then(|snapshot| {\n            serde_json::from_value::<ContextProfile>(profile)\n                .map(|profile| json!(context_remaining(&snapshot, &profile)))\n        })\n        .map_err(|error| error.to_string())\n'''
new = '''    Err("unsupported context evaluation mode".to_string())\n'''
if s.count(old) != 1: raise SystemExit('main legacy context fallback missing')
s = s.replace(old, new, 1)
s = s.replace('            "contextEvaluation": true,\n', '')
s = s.replace('        assert_eq!(response["data"]["contextEvaluation"], true);\n', '')
start = s.find('    #[test]\n    fn context_evaluation_returns_only_compact_remaining_result() {\n')
end = s.find('    #[test]\n    fn budget_mode_keeps_model_window_and_token_math_private() {\n', start)
if start < 0 or end < 0: raise SystemExit('main old context test markers missing')
replacement = '''    #[test]\n    fn context_evaluation_requires_an_explicit_private_mode() {\n        let response = handle(json!({\n            "id": "ctx-1",\n            "type": "evaluate_context",\n            "protocolVersion": 2,\n            "payload": {\n                "snapshot": { "fallbackRemainingTokens": 800000 },\n                "profile": {}\n            }\n        }));\n        assert_eq!(response["ok"], false);\n        assert_eq!(response["error"]["code"], "invalid_payload");\n        assert!(response["error"]["message"]\n            .as_str()\n            .unwrap_or_default()\n            .contains("unsupported context evaluation mode"));\n    }\n\n'''
s = s[:start] + replacement + s[end:]
main.write_text(s)

# Delete the obsolete private-engine library structs/calculator/tests.
lib = Path('private-engine/src/lib.rs')
s = lib.read_text()
a = s.find('#[derive(Debug, Clone, Serialize, Deserialize, Default)]\n#[serde(rename_all = "camelCase")]\npub struct ContextSnapshot {\n')
b = s.find('#[derive(Debug, Clone)]\nstruct Candidate {\n', a)
if a < 0 or b < 0: raise SystemExit('lib context structs markers missing')
s = s[:a] + s[b:]
a = s.find('fn ratio_remaining(current: Option<u64>, observed_limit: Option<u64>) -> Option<f64> {\n')
b = s.find('#[cfg(test)]\nmod tests {\n', a)
if a < 0 or b < 0: raise SystemExit('lib context calculator markers missing')
s = s[:a] + s[b:]
# Drop the two legacy remaining tests at the end of the test module.
a = s.find('    #[test]\n    fn visible_hard_limit_forces_zero_remaining() {\n')
if a < 0: raise SystemExit('lib legacy remaining tests start missing')
# They are the final two tests; keep the module closing brace.
s = s[:a] + '}\n'
lib.write_text(s)

# Update JS tests for the narrowed bridge/capability contract.
Path('extension/tests/private-context-bridge.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';

const listeners = [];
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) { listeners.push(listener); },
    },
  },
};

const bridge = await import(`../private-context-bridge.js?test=${Date.now()}`);

test('private context bridge registers one runtime listener', () => {
  assert.equal(listeners.length, 1);
});

test('legacy coarse context remaining bridge surface is removed', () => {
  assert.equal(Object.hasOwn(bridge, 'sanitizePrivateContextPayload'), false);
  assert.equal(Object.hasOwn(bridge, 'normalizePrivateContextResult'), false);
  assert.equal(Object.hasOwn(bridge, 'PRIVATE_CONTEXT_MESSAGE_TYPE'), false);
});

test('budget bridge transports chat text locally but strips unrelated metadata', () => {
  const payload = bridge.sanitizePrivateContextBudgetPayload({
    model: 'GPT-5.6-Sol',
    history: [
      { text: 'first turn', images: 2, attachments: 1, authorEmail: 'secret@example.com' },
      { text: 'second turn', images: 100, attachments: -5 },
    ],
    draft: { text: 'draft', images: 1 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: null,
      confirmedConversationTokens: 900000,
      accountScope: 'must-not-cross',
    },
  });
  assert.deepEqual(payload, {
    model: 'gpt-5.6-sol',
    history: [
      { text: 'first turn', images: 2, attachments: 1 },
      { text: 'second turn', images: 32, attachments: 0 },
    ],
    draft: { text: 'draft', images: 1, attachments: 0 },
    profile: {
      adaptiveSafeLimitTokens: 930000,
      hardLimitUpperBoundTokens: null,
      confirmedConversationTokens: 900000,
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret@example|must-not-cross/);
});

test('budget bridge rejects oversized local context before native messaging', () => {
  assert.throws(() => bridge.sanitizePrivateContextBudgetPayload({
    history: [{ text: 'x'.repeat((16 * 1024 * 1024) + 1) }],
  }), /exceeds local evaluation limit/);
});

test('private context budget result is whitelisted and bounded', () => {
  const normalized = bridge.normalizePrivateContextBudgetResult({
    nominalLimitTokens: 1050000,
    baseSafeLimitTokens: 924000,
    adaptiveSafeLimitTokens: 0,
    hardLimitUpperBoundTokens: 0,
    confirmedLowerBoundTokens: 0,
    safeLimitTokens: 924000,
    reserveTokens: 42000,
    historyTokens: 1000,
    draftTokens: 20,
    usedTokens: 1020,
    projectedTokens: 43020,
    percentUsed: 0.11,
    projectedPercent: 4.65,
    remainingPercent: 99.89,
    remainingTokens: 922980,
    warning: false,
    wouldExceed: false,
    adaptiveActive: false,
    hardLimitActive: false,
    contextWindowSource: 'model-window',
    chatText: 'must not survive normalization',
  });
  assert.equal(normalized.safeLimitTokens, 924000);
  assert.equal(normalized.remainingPercent, 99.89);
  assert.equal(normalized.contextWindowSource, 'model-window');
  assert.equal(Object.hasOwn(normalized, 'chatText'), false);
});

test('private context profile bridge strips metadata and keeps numeric learning facts', () => {
  const payload = bridge.sanitizePrivateContextProfilePayload({
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
  const result = bridge.normalizePrivateContextProfileResult({
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
''')

Path('extension/tests/private-core-channel-capability.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';

const channelModule = await import(`../private-core-channel.js?test=${Date.now()}`);
const { PrivateCoreChannel, normalizePrivateEngineCapabilities } = channelModule;

test('capability normalization whitelists only current compiled-engine features', () => {
  const capability = normalizePrivateEngineCapabilities({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextBudgetEvaluation: true,
        contextProfileEvaluation: true,
        contextEvaluation: true,
        privateRuleDump: true,
      },
    },
  });
  assert.equal(capability.available, true);
  assert.equal(capability.contextBudgetEvaluation, true);
  assert.equal(capability.contextProfileEvaluation, true);
  assert.equal(Object.hasOwn(capability, 'contextEvaluation'), false);
  assert.equal(Object.hasOwn(capability, 'privateRuleDump'), false);
});

test('supports requires both an executable probe and a current mode-specific feature', async () => {
  const channel = new PrivateCoreChannel();
  channel.requestRaw = async () => ({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextEvaluation: true,
        contextBudgetEvaluation: false,
        contextProfileEvaluation: true,
      },
    },
  });
  assert.equal(await channel.supports('contextEvaluation'), false);
  assert.equal(await channel.supports('contextBudgetEvaluation'), false);
  assert.equal(await channel.supports('contextProfileEvaluation'), true);
  assert.equal(await channel.supports('unknownFeature'), false);
});
''')

# Boundary file list follows deletion.
replace_once(
    'extension/tests/private-request-public-boundary.test.mjs',
    "  new URL('../private-context-indicator.js', import.meta.url),\n",
    '',
)

# Add a focused regression guard proving there is one context UI/bridge path only.
Path('extension/tests/private-context-legacy-removal.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const bridge = await readFile(new URL('../private-context-bridge.js', import.meta.url), 'utf8');
const channel = await readFile(new URL('../private-core-channel.js', import.meta.url), 'utf8');

test('manifest loads only the authoritative context budget renderer', () => {
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.equal(scripts.includes('private-context-budget-authority.js'), true);
  assert.equal(scripts.includes('context-budget.js'), true);
  assert.equal(scripts.includes('private-context-indicator.js'), false);
});

test('legacy coarse remaining message and capability are absent from browser runtime', () => {
  assert.doesNotMatch(bridge, /GPTLOCK_PRIVATE_CONTEXT_EVALUATE/);
  assert.doesNotMatch(bridge, /sanitizePrivateContextPayload|normalizePrivateContextResult/);
  assert.doesNotMatch(channel, /['\"]contextEvaluation['\"]/);
});
''')

# Final static guards.
for path in ['extension/private-context-bridge.js', 'extension/private-core-channel.js']:
    source = Path(path).read_text()
    if 'GPTLOCK_PRIVATE_CONTEXT_EVALUATE' in source:
        raise SystemExit(f'{path}: legacy remaining message survived')
if 'contextEvaluation' in Path('extension/private-core-channel.js').read_text():
    raise SystemExit('browser capability still contains contextEvaluation')
if 'contextEvaluation' in Path('native-core/src/private_engine.rs').read_text().split('#[cfg(test)]')[0]:
    raise SystemExit('native capability still contains contextEvaluation')
if 'contextEvaluation' in Path('private-engine/src/main.rs').read_text().split('#[cfg(test)]')[0]:
    raise SystemExit('private capability still contains contextEvaluation')
