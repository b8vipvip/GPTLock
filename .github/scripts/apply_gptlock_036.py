from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_exact(path, old, new, count=1):
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} matches, found {actual}: {old[:120]!r}")
    write(path, text.replace(old, new, count))


# Versions.
replace_exact("extension/manifest.json", '"version": "0.3.5"', '"version": "0.3.6"')
replace_exact("extension/package.json", '"version": "0.3.5"', '"version": "0.3.6"')
replace_exact("native-core/Cargo.toml", 'version = "0.3.5"', 'version = "0.3.6"')
replace_exact(
    "native-core/Cargo.lock",
    'name = "gptlock-core"\nversion = "0.3.5"',
    'name = "gptlock-core"\nversion = "0.3.6"',
)

# 10 MiB of diagnostic SSE can exceed normal storage.local quota on some Chromium builds.
replace_exact(
    "extension/manifest.json",
    '"permissions": ["alarms", "debugger", "nativeMessaging", "storage", "tabs"],',
    '"permissions": ["alarms", "debugger", "nativeMessaging", "storage", "tabs", "unlimitedStorage"],',
)

runtime_helpers = r'''export const MAX_DIAGNOSTIC_SSE_BYTES = 10 * 1024 * 1024;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

export function createDiagnosticSseCapture({ tabId = null, startedAt = null } = {}) {
  return {
    schemaVersion: 1,
    captureScope: 'auto_verification_sse_only',
    maxBytes: MAX_DIAGNOSTIC_SSE_BYTES,
    tabId,
    startedAt: startedAt || new Date().toISOString(),
    completedAt: null,
    totalBytes: 0,
    includedBytes: 0,
    overflowed: false,
    omittedResponses: 0,
    omittedBytes: 0,
    entries: [],
    omitted: [],
  };
}

export function appendDiagnosticSseCapture(capture, entry, maxBytes = MAX_DIAGNOSTIC_SSE_BYTES) {
  const base = capture && typeof capture === 'object' ? capture : createDiagnosticSseCapture();
  const next = {
    ...base,
    maxBytes,
    totalBytes: Number(base.totalBytes || 0),
    includedBytes: Number(base.includedBytes || 0),
    overflowed: Boolean(base.overflowed),
    omittedResponses: Number(base.omittedResponses || 0),
    omittedBytes: Number(base.omittedBytes || 0),
    entries: Array.isArray(base.entries) ? [...base.entries] : [],
    omitted: Array.isArray(base.omitted) ? [...base.omitted] : [],
  };
  const rawSse = typeof entry?.rawSse === 'string' ? entry.rawSse : '';
  const bodyBytes = utf8ByteLength(rawSse);
  next.totalBytes += bodyBytes;
  if (!rawSse || bodyBytes === 0) return next;

  const projected = next.includedBytes + bodyBytes;
  if (projected > maxBytes) {
    next.overflowed = true;
    next.omittedResponses += 1;
    next.omittedBytes += bodyBytes;
    next.omitted.push({
      attempt: entry?.attempt ?? null,
      requestId: entry?.requestId ?? null,
      capturedAt: entry?.capturedAt ?? null,
      endpoint: entry?.endpoint ?? null,
      httpStatus: entry?.httpStatus ?? null,
      mimeType: entry?.mimeType ?? null,
      bodyFormat: entry?.bodyFormat ?? null,
      bodyBytes,
      reason: 'diagnostic_sse_size_limit',
    });
    return next;
  }

  next.entries.push({
    attempt: entry?.attempt ?? null,
    requestId: entry?.requestId ?? null,
    capturedAt: entry?.capturedAt ?? null,
    endpoint: entry?.endpoint ?? null,
    httpStatus: entry?.httpStatus ?? null,
    mimeType: entry?.mimeType ?? null,
    bodyFormat: entry?.bodyFormat ?? null,
    requestModel: entry?.requestModel ?? null,
    rewriteReason: entry?.rewriteReason ?? null,
    bodyBytes,
    rawSse,
  });
  next.includedBytes = projected;
  return next;
}

export function finalizeDiagnosticSseCapture(capture, completedAt = null) {
  if (!capture || typeof capture !== 'object') return null;
  return { ...capture, completedAt: completedAt || new Date().toISOString() };
}

'''
replace_exact(
    "extension/runtime-log.js",
    "let writeQueue = Promise.resolve();\n",
    runtime_helpers + "let writeQueue = Promise.resolve();\n",
)

replace_exact(
    "extension/tests/runtime-log.test.mjs",
    "import { boundRuntimeLogs, sanitizeLogValue } from '../runtime-log.js';",
    "import {\n  appendDiagnosticSseCapture,\n  boundRuntimeLogs,\n  createDiagnosticSseCapture,\n  sanitizeLogValue,\n} from '../runtime-log.js';",
)
runtime_tests = r'''

test('keeps auto-verification SSE byte-for-byte when the aggregate stays under the cap', () => {
  const body = 'event: message\ndata: {"type":"debug","model_slug":"gpt-5.6-sol"}\n\n';
  const capture = appendDiagnosticSseCapture(
    createDiagnosticSseCapture({ tabId: 7, startedAt: '2026-08-26T00:00:00.000Z' }),
    {
      attempt: 1,
      requestId: 'req-1',
      endpoint: '/backend-api/f/conversation',
      mimeType: 'text/event-stream',
      bodyFormat: 'sse',
      rawSse: body,
    },
    1024,
  );
  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].rawSse, body);
  assert.equal(capture.entries[0].bodyBytes, Buffer.byteLength(body));
  assert.equal(capture.includedBytes, Buffer.byteLength(body));
  assert.equal(capture.overflowed, false);
});

test('does not persist a partial raw SSE body when the aggregate size limit would be exceeded', () => {
  let capture = createDiagnosticSseCapture({ tabId: 7 });
  capture = appendDiagnosticSseCapture(capture, { attempt: 1, requestId: 'a', rawSse: '123456' }, 10);
  capture = appendDiagnosticSseCapture(capture, { attempt: 2, requestId: 'b', rawSse: 'abcdef' }, 10);
  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].rawSse, '123456');
  assert.equal(capture.overflowed, true);
  assert.equal(capture.omittedResponses, 1);
  assert.equal(capture.omittedBytes, 6);
  assert.equal(capture.omitted[0].requestId, 'b');
  assert.equal(capture.omitted[0].reason, 'diagnostic_sse_size_limit');
});
'''
path = "extension/tests/runtime-log.test.mjs"
write(path, read(path).rstrip() + runtime_tests + "\n")

# Pass the exact SSE body transiently to background; it is released immediately after the callback.
replace_exact(
    "extension/network-monitor.js",
    "    body = '';\n    this.onEvidence(tabId, {",
    "    this.onEvidence(tabId, {",
)
replace_exact(
    "extension/network-monitor.js",
    "      bodyError,\n      diagnostics: {",
    "      bodyError,\n      rawResponseBody: (/event-stream/i.test(record.mimeType) || String(evidence.diagnostics?.bodyFormat || '').includes('sse'))\n        ? body\n        : null,\n      diagnostics: {",
)
replace_exact(
    "extension/network-monitor.js",
    "      },\n    });\n  }\n\n  handleFailed(tabId, params) {",
    "      },\n    });\n    body = '';\n  }\n\n  handleFailed(tabId, params) {",
)

replace_exact(
    "extension/background.js",
    "import {\n  appendRuntimeLog,\n  clearRuntimeLogs,\n  getRuntimeLogs,\n  sanitizeLogValue,\n} from './runtime-log.js';",
    "import {\n  appendDiagnosticSseCapture,\n  appendRuntimeLog,\n  clearRuntimeLogs,\n  createDiagnosticSseCapture,\n  finalizeDiagnosticSseCapture,\n  getRuntimeLogs,\n  sanitizeLogValue,\n} from './runtime-log.js';",
)
replace_exact(
    "extension/background.js",
    "const AUTO_VERIFY_FALLBACK_DELAY_MS = 700;",
    "const AUTO_VERIFY_FALLBACK_DELAY_MS = 700;\nconst DIAGNOSTIC_SSE_STORAGE_KEY = 'autoVerificationSseCapture';",
)

background_helpers = r'''

async function startAutoVerificationSseCapture(tabId, startedAt) {
  const capture = createDiagnosticSseCapture({ tabId, startedAt });
  await chrome.storage.local.set({ [DIAGNOSTIC_SSE_STORAGE_KEY]: capture });
  return capture;
}

async function captureAutoVerificationSse(tabId, state, evidence) {
  const rawSse = evidence?.rawResponseBody;
  const mimeType = String(evidence?.diagnostics?.mimeType || '');
  const bodyFormat = String(evidence?.diagnostics?.bodyFormat || '');
  if (!state.autoVerification?.running || typeof rawSse !== 'string' || !rawSse) return null;
  if (!/event-stream/i.test(mimeType) && !bodyFormat.includes('sse')) return null;
  if (state.lastRequest?.requestId && state.lastRequest.requestId !== evidence.requestId) return null;

  const stored = await chrome.storage.local.get(DIAGNOSTIC_SSE_STORAGE_KEY);
  let capture = stored[DIAGNOSTIC_SSE_STORAGE_KEY];
  if (!capture || capture.tabId !== tabId || capture.startedAt !== state.autoVerification.startedAt) {
    capture = createDiagnosticSseCapture({ tabId, startedAt: state.autoVerification.startedAt });
  }
  const beforeIncludedBytes = Number(capture.includedBytes || 0);
  const next = appendDiagnosticSseCapture(capture, {
    attempt: state.autoVerification.attempt ?? null,
    requestId: evidence.requestId ?? null,
    capturedAt: evidence.capturedAt ?? new Date().toISOString(),
    endpoint: evidence.diagnostics?.endpoint ?? null,
    httpStatus: evidence.diagnostics?.httpStatus ?? evidence.status ?? null,
    mimeType,
    bodyFormat,
    requestModel: state.lastRequest?.model ?? null,
    rewriteReason: state.lastRewrite?.reason ?? null,
    rawSse,
  });
  await chrome.storage.local.set({ [DIAGNOSTIC_SSE_STORAGE_KEY]: next });
  logRuntime(next.overflowed ? 'warn' : 'info', 'diagnostics', 'auto_verify_sse_captured', {
    tabId,
    attempt: state.autoVerification.attempt ?? null,
    requestId: evidence.requestId ?? null,
    addedBytes: Math.max(0, Number(next.includedBytes || 0) - beforeIncludedBytes),
    includedBytes: next.includedBytes,
    totalBytes: next.totalBytes,
    maxBytes: next.maxBytes,
    overflowed: next.overflowed,
    omittedResponses: next.omittedResponses,
  });
  return next;
}

async function finalizeAutoVerificationSseCapture(tabId, completedAt) {
  const stored = await chrome.storage.local.get(DIAGNOSTIC_SSE_STORAGE_KEY);
  let capture = stored[DIAGNOSTIC_SSE_STORAGE_KEY];
  const state = tabStates.get(tabId);
  if (!capture || capture.tabId !== tabId) {
    capture = createDiagnosticSseCapture({ tabId, startedAt: state?.autoVerification?.startedAt ?? null });
  }
  const finalized = finalizeDiagnosticSseCapture(capture, completedAt);
  await chrome.storage.local.set({ [DIAGNOSTIC_SSE_STORAGE_KEY]: finalized });
  return finalized;
}

async function clearAutoVerificationSseCapture() {
  await chrome.storage.local.remove(DIAGNOSTIC_SSE_STORAGE_KEY);
}
'''
replace_exact(
    "extension/background.js",
    "function logRuntime(level, component, event, details = {}) {\n  void appendRuntimeLog(level, component, event, details).catch(() => {});\n}\n",
    "function logRuntime(level, component, event, details = {}) {\n  void appendRuntimeLog(level, component, event, details).catch(() => {});\n}" + background_helpers + "\n",
)

# Preserve one state object across / -> /c/:id while auto verification is running.
replace_exact(
    "extension/background.js",
    "function ensureTabState(tabId, url = '') {\n  let state = tabStates.get(tabId);\n  if (!state) {\n    state = createTabState(tabId, url);\n    tabStates.set(tabId, state);\n  } else if (url && state.contextKey !== contextKey(url)) {\n    const monitor = state.monitor;\n    state = createTabState(tabId, url);\n    state.monitor = monitor;\n    tabStates.set(tabId, state);\n  } else if (url) {\n    state.url = url;\n  }\n  return state;\n}",
    "function ensureTabState(tabId, url = '') {\n  let state = tabStates.get(tabId);\n  if (!state) {\n    state = createTabState(tabId, url);\n    tabStates.set(tabId, state);\n  } else if (url && state.contextKey !== contextKey(url)) {\n    const nextContextKey = contextKey(url);\n    const preserveVerificationState = Boolean(\n      state.autoVerification?.running\n        || (state.autoVerification && !state.contextKey.startsWith('conversation:') && nextContextKey.startsWith('conversation:')),\n    );\n    if (preserveVerificationState) {\n      const previousContextKey = state.contextKey;\n      state.url = url;\n      state.contextKey = nextContextKey;\n      logRuntime('info', 'verification', 'auto_verify_context_migrated', {\n        tabId,\n        previousContextKey,\n        nextContextKey,\n        running: Boolean(state.autoVerification?.running),\n      });\n    } else {\n      const monitor = state.monitor;\n      state = createTabState(tabId, url);\n      state.monitor = monitor;\n      tabStates.set(tabId, state);\n    }\n  } else if (url) {\n    state.url = url;\n  }\n  return state;\n}",
)

replace_exact(
    "extension/background.js",
    "async function applyNetworkEvidence(tabId, evidence) {\n  const state = ensureTabState(tabId);\n  state.lastEvidenceDiagnostics = evidence.diagnostics ?? null;",
    "async function applyNetworkEvidence(tabId, evidence) {\n  const state = ensureTabState(tabId);\n  try {\n    await captureAutoVerificationSse(tabId, state, evidence);\n  } catch (error) {\n    logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_failed', { tabId, error: errorText(error) });\n  } finally {\n    evidence.rawResponseBody = null;\n  }\n  state.lastEvidenceDiagnostics = evidence.diagnostics ?? null;",
)

replace_exact(
    "extension/background.js",
    "  };\n  resetVerificationAttempt(state);\n  state.lastError = page.error;\n  await broadcastTabState(tabId);\n\n  if (!monitorAttached) {",
    "  };\n  try {\n    await startAutoVerificationSseCapture(tabId, startedAt);\n  } catch (error) {\n    logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_start_failed', { tabId, error: errorText(error) });\n  }\n  resetVerificationAttempt(state);\n  state.lastError = page.error;\n  await broadcastTabState(tabId);\n\n  if (!monitorAttached) {",
)

replace_exact(
    "extension/background.js",
    "  state.autoVerification.responseReasoning = lastAttempt?.responseReasoning ?? null;\n  state.autoVerification.evidenceSource = lastAttempt?.evidenceSource ?? null;\n  await broadcastTabState(tabId);",
    "  state.autoVerification.responseReasoning = lastAttempt?.responseReasoning ?? null;\n  state.autoVerification.evidenceSource = lastAttempt?.evidenceSource ?? null;\n  try {\n    await finalizeAutoVerificationSseCapture(tabId, state.autoVerification.completedAt);\n  } catch (error) {\n    logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_finalize_failed', { tabId, error: errorText(error) });\n  }\n  await broadcastTabState(tabId);",
)

old_bundle = r'''async function createDiagnosticBundle() {
  const [stored, runtimeLogs, platform] = await Promise.all([
    chrome.storage.local.get('nativeStatus'),
    getRuntimeLogs(),
    getPlatformInfo(),
  ]);
  let nativeDiagnostics = null;
  let nativeDiagnosticsError = null;
  try {
    nativeDiagnostics = await sendNative('get_diagnostics', { auditLimit: 1000 });
  } catch (error) {
    nativeDiagnosticsError = errorText(error);
  }
  return sanitizeLogValue({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    privacy: {
      chatContentIncluded: false,
      credentialsIncluded: false,
      noteZhCn: '诊断包保留端点、请求锁定结果、模型/推理标识、状态码、字段路径和错误，但不包含提示词、回答正文、Cookie、授权头或令牌。',
      noteEn: 'The bundle keeps technical request-lock and verification metadata, but excludes prompts, answer bodies, cookies, authorization headers, and tokens.',
    },
    extension: {
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      platform,
      userAgent: navigator.userAgent,
    },
    policy: currentPolicy,
    settings: currentSettings,
    nativeStatus: stored.nativeStatus ?? { connected: false },
    tabs: [...tabStates.values()].map(diagnosticTabState),
    runtimeLogs,
    nativeDiagnostics,
    nativeDiagnosticsError,
  });
}'''
new_bundle = r'''async function createDiagnosticBundle() {
  const [stored, runtimeLogs, platform] = await Promise.all([
    chrome.storage.local.get(['nativeStatus', DIAGNOSTIC_SSE_STORAGE_KEY]),
    getRuntimeLogs(),
    getPlatformInfo(),
  ]);
  let nativeDiagnostics = null;
  let nativeDiagnosticsError = null;
  try {
    nativeDiagnostics = await sendNative('get_diagnostics', { auditLimit: 1000 });
  } catch (error) {
    nativeDiagnosticsError = errorText(error);
  }
  const rawSseCapture = stored[DIAGNOSTIC_SSE_STORAGE_KEY] ?? null;
  const safeBundle = sanitizeLogValue({
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    extension: {
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      platform,
      userAgent: navigator.userAgent,
    },
    policy: currentPolicy,
    settings: currentSettings,
    nativeStatus: stored.nativeStatus ?? { connected: false },
    tabs: [...tabStates.values()].map(diagnosticTabState),
    runtimeLogs,
    nativeDiagnostics,
    nativeDiagnosticsError,
  });
  return {
    ...safeBundle,
    privacy: {
      chatContentIncluded: Boolean(rawSseCapture?.entries?.length),
      autoVerificationSseIncluded: Boolean(rawSseCapture?.entries?.length),
      autoVerificationSseOnly: true,
      credentialsIncluded: false,
      requestHeadersIncluded: false,
      responseHeadersIncluded: false,
      noteZhCn: '普通聊天仍不打包请求/响应正文。仅自动验证固定测试消息对应的原始 SSE 响应可进入诊断包，合计上限 10 MiB；其中可能包含测试回答、消息 ID、会话 ID 和服务器元数据。Cookie、Authorization、请求头、响应头和浏览器凭据不采集。',
      noteEn: 'Ordinary chat request/response bodies remain excluded. Only raw SSE responses for the fixed automatic-verification probes may be included, capped at 10 MiB total; those streams can contain probe answers, message/conversation IDs, and server metadata. Cookies, Authorization, request/response headers, and browser credentials are not captured.',
    },
    autoVerificationSse: rawSseCapture,
  };
}'''
replace_exact("extension/background.js", old_bundle, new_bundle)

replace_exact(
    "extension/background.js",
    "      case 'GPTLOCK_CLEAR_RUNTIME_LOGS':\n        await clearRuntimeLogs();\n        logRuntime('info', 'diagnostics', 'runtime_logs_cleared');\n        return { cleared: true };",
    "      case 'GPTLOCK_CLEAR_RUNTIME_LOGS':\n        await Promise.all([clearRuntimeLogs(), clearAutoVerificationSseCapture()]);\n        logRuntime('info', 'diagnostics', 'runtime_logs_cleared');\n        return { cleared: true };",
)
replace_exact(
    "extension/background.js",
    "          nativeDiagnosticsError: bundle.nativeDiagnosticsError,\n        });",
    "          nativeDiagnosticsError: bundle.nativeDiagnosticsError,\n          rawSseEntryCount: bundle.autoVerificationSse?.entries?.length ?? 0,\n          rawSseIncludedBytes: bundle.autoVerificationSse?.includedBytes ?? 0,\n          rawSseOverflowed: Boolean(bundle.autoVerificationSse?.overflowed),\n        });",
)

replace_exact(
    "extension/diagnostics.js",
    "    elements.message.textContent = '诊断包已导出 / Diagnostic bundle exported.';",
    "    const sse = bundle.autoVerificationSse;\n    elements.message.textContent = sse?.entries?.length\n      ? `诊断包已导出；包含 ${sse.entries.length} 条自动验证原始 SSE，共 ${sse.includedBytes || 0} 字节${sse.overflowed ? '，另有超限响应未完整打包' : ''}。`\n      : '诊断包已导出；本次没有可打包的自动验证原始 SSE / Diagnostic bundle exported.';",
)
replace_exact(
    "extension/diagnostics.js",
    "  if (!window.confirm('确认清空扩展运行日志？本地核心 audit.jsonl 不会被删除。\\nClear extension runtime logs? Native audit.jsonl will be kept.')) return;",
    "  if (!window.confirm('确认清空扩展运行日志和自动验证 SSE 诊断缓存？本地核心 audit.jsonl 不会被删除。\\nClear extension runtime logs and auto-verification SSE cache? Native audit.jsonl will be kept.')) return;",
)

replace_exact(
    "extension/tests/manifest.test.mjs",
    "  assert.match(packagedId, /^[a-p]{32}$/);",
    "  assert.match(packagedId, /^[a-p]{32}$/);\n  assert.ok(manifest.permissions.includes('unlimitedStorage'));",
)

for doc in ["README.md", "docs/USAGE.md", "docs/SECURITY.md"]:
    write(doc, read(doc).replace("0.3.5", "0.3.6"))

replace_exact(
    "README.md",
    "如果输入框中已有草稿，自动验证会先保存草稿，并在测试消息发出后尽力恢复。",
    "如果输入框中已有草稿，自动验证会先保存草稿，并在测试消息发出后尽力恢复。\n\n0.3.6 还会在**自动验证期间**保存固定测试请求对应的原始 SSE 响应，按 UTF-8 字节合计最多 10 MiB，并随“导出诊断包”写入 `autoVerificationSse.entries[].rawSse`。这样当 ChatGPT 没有被现有解析器识别出模型/推理字段时，可以直接查看服务器实际返回了哪些字段，而不是继续猜字段名。普通聊天的响应正文仍不会被打包；原始 SSE 可能包含测试回答、消息/会话 ID 和服务器元数据，因此分享诊断包前应按包含聊天内容的文件处理。",
)
replace_exact(
    "docs/USAGE.md",
    "如果输入框已有草稿，程序会先保留草稿，并在测试消息成功发出后尽力恢复。自动验证不会发送隐藏请求，也不会把页面文字伪造为 `verified`。",
    "如果输入框已有草稿，程序会先保留草稿，并在测试消息成功发出后尽力恢复。自动验证不会发送隐藏请求，也不会把页面文字伪造为 `verified`。\n\n从 0.3.6 起，自动验证还会把这两次固定测试请求对应的**原始 SSE 响应**临时保存在扩展本地存储中，并在导出诊断包时写入 `autoVerificationSse`。原始 SSE 按 UTF-8 字节合计最多 10 MiB；超过上限的响应只保留大小/请求 ID 等省略记录，不伪装成完整抓包。该机制只针对自动验证，不抓取普通聊天响应正文。",
)
replace_exact(
    "docs/USAGE.md",
    "日志脱敏器会去除 `postData`、请求/响应正文、提示词、回答、Cookie、Authorization、Token、密码等敏感字段，同时保留 `postDataLength`、端点、字段路径和错误等技术诊断信息。",
    "运行日志脱敏器仍会去除 `postData`、请求/响应正文、提示词、回答、Cookie、Authorization、Token、密码等敏感字段，同时保留 `postDataLength`、端点、字段路径和错误等技术诊断信息。**诊断包中的 `autoVerificationSse` 是唯一正文例外**：它只保存自动验证固定测试消息对应的原始 SSE，合计最多 10 MiB，用于分析 ChatGPT 实际返回字段。",
)
replace_exact(
    "docs/SECURITY.md",
    "- `debugger` 权限用于该站点标签页的 CDP `Fetch` 和 `Network` 域。Chromium 不允许把该权限设为普通站点 optional 权限，因此安装时会明确展示调试权限告警；",
    "- `debugger` 权限用于该站点标签页的 CDP `Fetch` 和 `Network` 域。Chromium 不允许把该权限设为普通站点 optional 权限，因此安装时会明确展示调试权限告警；\n- `unlimitedStorage` 仅用于可靠保存一次自动验证最多 10 MiB 的原始 SSE 诊断缓存，避免与正常运行日志共同占用 `storage.local` 默认配额；",
)
replace_exact(
    "docs/SECURITY.md",
    "- 不持久化完整请求体、响应体、Cookie、Authorization 或 token；\n- 提取完成后立即释放响应正文引用；",
    "- 普通聊天不持久化完整请求体、响应体、Cookie、Authorization 或 token；\n- **唯一正文例外是自动验证**：仅固定测试消息对应的原始 SSE response body 可临时保存并随诊断包导出，按 UTF-8 字节合计最多 10 MiB；\n- 自动验证之外的响应在元数据提取完成后立即释放正文引用；自动验证原始 SSE 在完成有界复制后也立即释放网络事件中的正文引用；",
)
replace_exact(
    "docs/SECURITY.md",
    "- 不把测试消息或回答正文写入诊断日志。",
    "- 运行日志和 Native Core audit 仍不写测试消息/回答正文；\n- 用户主动导出的诊断包可以包含自动验证固定测试请求的原始 SSE，这是用于协议分析的显式例外，最多 10 MiB，并在 `privacy` 字段明确标记。",
)
replace_exact(
    "docs/SECURITY.md",
    "Full request postData and response bodies are transient. They are not persisted in runtime logs, diagnostics, or Native Core audit files. Redaction removes request/response payloads, prompts, answers, cookies, authorization data, tokens, passwords, and secrets while preserving technical metadata such as endpoint, lengths, normalized model IDs, candidate field paths, HTTP status, and errors.",
    "Ordinary-chat request postData and response bodies remain transient and are not persisted in runtime logs or Native Core audit files. GPTLock 0.3.6 adds one explicit diagnostic exception: raw SSE response bodies for the fixed automatic-verification probes may be retained locally and exported under `autoVerificationSse`, capped at 10 MiB total. Runtime-log redaction still removes request/response payloads, prompts, answers, cookies, authorization data, tokens, passwords, and secrets. The raw SSE export never includes browser cookies, Authorization headers, request headers, or response headers, but the SSE body itself may contain the probe answer, message/conversation IDs, and server metadata.",
)

# Correct the release summary rather than inheriting 0.3.5's text.
lines = read("README.md").splitlines()
for index, line in enumerate(lines):
    if line.startswith("当前版本：`0.3.6`。"):
        lines[index] = "当前版本：`0.3.6`。本版修复自动验证在新聊天跳转到 `/c/<conversation-id>` 时丢失状态、把已经成功的请求锁定误报为 `requestLockConfirmed=false` 的问题；同时为自动验证加入最多 10 MiB 的原始 SSE 诊断捕获。请求锁定与响应确认仍然分层：模型请求锁定可以成功，而服务端若未暴露可验证模型/推理元数据，响应状态仍保持 `unverified`，不会伪造成功。"
        break
else:
    raise SystemExit("README current-version line not found")
write("README.md", "\n".join(lines) + "\n")
