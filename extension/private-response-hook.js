import { privateCoreChannel } from './private-core-channel.js';
import { ChatGptNetworkMonitor } from './network-monitor.js';
import {
  buildPrivateResponsePayload,
  decodePrivateResponseBody,
  hasCompletePrivateResponseEvidence,
  normalizePrivateResponseEvidence,
} from './private-response-routing.js';

const PATCH_MARKER = Symbol.for('gptlock.privateResponseRouting.v2');

function debuggerCall(method, ...args) {
  return new Promise((resolve, reject) => {
    chrome.debugger[method](...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function responseBody(monitor, tabId, requestId) {
  const result = await debuggerCall(
    'sendCommand',
    monitor.target(tabId),
    'Network.getResponseBody',
    { requestId },
  );
  return decodePrivateResponseBody(result?.body ?? '', Boolean(result?.base64Encoded));
}

export function installPrivateResponseRoutingHook() {
  const prototype = ChatGptNetworkMonitor.prototype;
  if (prototype[PATCH_MARKER]) return false;
  const legacyHandleFinished = prototype.handleFinished;
  if (typeof legacyHandleFinished !== 'function') return false;

  Object.defineProperty(prototype, PATCH_MARKER, { value: true, configurable: false });
  prototype.handleFinished = async function privateHandleFinished(tabId, params = {}) {
    const key = this.key(tabId, String(params.requestId));
    const record = this.requests.get(key);
    if (!record || record.downstream || !record.responseVerificationEnabled) {
      return legacyHandleFinished.call(this, tabId, params);
    }
    if (!(await privateCoreChannel.isAvailable())) {
      return legacyHandleFinished.call(this, tabId, params);
    }

    let body = '';
    let evidence;
    try {
      body = await responseBody(this, tabId, record.requestId);
      const rawEvidence = await privateCoreChannel.request(
        'evaluate_response',
        buildPrivateResponsePayload({
          body,
          headers: record.responseHeaders,
          mimeType: record.mimeType,
        }),
        'response',
      );
      evidence = normalizePrivateResponseEvidence(rawEvidence);
    } catch {
      privateCoreChannel.invalidate();
      body = '';
      return legacyHandleFinished.call(this, tabId, params);
    }

    if (!hasCompletePrivateResponseEvidence(evidence)) {
      body = '';
      return legacyHandleFinished.call(this, tabId, params);
    }

    this.requests.delete(key);
    const bodyFormat = String(evidence.diagnostics?.bodyFormat || '');
    const keepRawForExplicitDiagnostics = /event-stream/i.test(record.mimeType || '') || bodyFormat.includes('sse');
    this.onEvidence(tabId, {
      requestId: record.requestId,
      capturedAt: new Date().toISOString(),
      status: record.status,
      model: evidence.model,
      reasoning: evidence.reasoning,
      conflicts: evidence.conflicts,
      fields: evidence.fields,
      bodyError: null,
      rawResponseBody: keepRawForExplicitDiagnostics ? body : null,
      streamContext: null,
      diagnostics: {
        endpoint: record.endpoint,
        httpStatus: record.status,
        encodedDataLength: Number.isFinite(params.encodedDataLength) ? params.encodedDataLength : null,
        transport: 'sse',
        direction: 'received',
        stage: 'initial_conversation',
        streamHandoff: null,
        privateEngine: true,
        ...evidence.diagnostics,
      },
    });
    body = '';
  };
  return true;
}

installPrivateResponseRoutingHook();
