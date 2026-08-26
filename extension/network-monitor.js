import {
  decodeCdpBody,
  extractRequestEvidence,
  extractResponseEvidence,
  isChatGptConversationRequest,
  rewriteConversationPostData,
} from './network-evidence.js';

const CDP_VERSION = '1.3';
const REQUEST_TTL_MS = 15 * 60 * 1000;
const FETCH_PATTERNS = [
  { urlPattern: 'https://chatgpt.com/backend-api/conversation*', requestStage: 'Request' },
  { urlPattern: 'https://chatgpt.com/backend-api/f/conversation*', requestStage: 'Request' },
];

function debuggerCall(method, ...args) {
  return new Promise((resolve, reject) => {
    chrome.debugger[method](...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticEndpoint(value) {
  try {
    return new URL(value).pathname
      .split('/')
      .map((segment) => (/^[a-z0-9_-]{20,}$/i.test(segment) ? ':id' : segment))
      .join('/');
  } catch {
    return 'invalid-url';
  }
}

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export class ChatGptNetworkMonitor {
  constructor({ onStatus, onRequest, onEvidence, onFailure, onRewrite, getLockConfiguration }) {
    this.onStatus = onStatus;
    this.onRequest = onRequest;
    this.onEvidence = onEvidence;
    this.onFailure = onFailure;
    this.onRewrite = onRewrite;
    this.getLockConfiguration = getLockConfiguration;
    this.attachedTabs = new Set();
    this.requests = new Map();
    chrome.debugger.onEvent.addListener((source, method, params) => {
      void this.handleEvent(source, method, params);
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (!source.tabId) return;
      this.attachedTabs.delete(source.tabId);
      this.dropTabRequests(source.tabId);
      this.onStatus(source.tabId, { attached: false, error: `detached:${reason}` });
    });
  }

  target(tabId) {
    return { tabId };
  }

  configuration() {
    try {
      return this.getLockConfiguration?.() ?? {};
    } catch {
      return {};
    }
  }

  async attach(tabId) {
    if (this.attachedTabs.has(tabId)) return true;
    const target = this.target(tabId);
    try {
      await debuggerCall('attach', target, CDP_VERSION);
    } catch (attachError) {
      try {
        await debuggerCall('sendCommand', target, 'Network.enable', {});
      } catch {
        const detail = safeError(attachError);
        this.onStatus(tabId, { attached: false, error: detail });
        return false;
      }
    }

    try {
      await debuggerCall('sendCommand', target, 'Network.enable', {
        maxTotalBufferSize: 32 * 1024 * 1024,
        maxResourceBufferSize: 16 * 1024 * 1024,
        maxPostDataSize: 2 * 1024 * 1024,
      });
      await debuggerCall('sendCommand', target, 'Fetch.enable', {
        patterns: FETCH_PATTERNS,
      });
      this.attachedTabs.add(tabId);
      this.onStatus(tabId, { attached: true, error: null });
      return true;
    } catch (error) {
      try {
        await debuggerCall('sendCommand', target, 'Fetch.disable', {});
      } catch {
        // Fetch may not have been enabled.
      }
      try {
        await debuggerCall('detach', target);
      } catch {
        // The target may already have closed.
      }
      const detail = safeError(error);
      this.onStatus(tabId, { attached: false, error: detail });
      return false;
    }
  }

  async detach(tabId) {
    this.attachedTabs.delete(tabId);
    this.dropTabRequests(tabId);
    try {
      await debuggerCall('sendCommand', this.target(tabId), 'Fetch.disable', {});
    } catch {
      // Fetch may already be disabled or the target may have closed.
    }
    try {
      await debuggerCall('detach', this.target(tabId));
    } catch {
      // Detaching an already closed/non-attached target is harmless.
    }
    this.onStatus(tabId, { attached: false, error: null });
  }

  isAttached(tabId) {
    return this.attachedTabs.has(tabId);
  }

  key(tabId, requestId) {
    return `${tabId}:${requestId}`;
  }

  dropTabRequests(tabId) {
    const prefix = `${tabId}:`;
    for (const key of this.requests.keys()) {
      if (key.startsWith(prefix)) this.requests.delete(key);
    }
  }

  purgeOldRequests() {
    const cutoff = Date.now() - REQUEST_TTL_MS;
    for (const [key, request] of this.requests) {
      if (request.startedAt < cutoff) this.requests.delete(key);
    }
  }

  async handleEvent(source, method, params = {}) {
    const tabId = source.tabId;
    if (!tabId || !this.attachedTabs.has(tabId)) return;
    this.purgeOldRequests();

    if (method === 'Fetch.requestPaused') {
      await this.handlePausedRequest(tabId, params);
    } else if (method === 'Network.requestWillBeSent') {
      await this.handleRequest(tabId, params);
    } else if (method === 'Network.responseReceived') {
      this.handleResponse(tabId, params);
    } else if (method === 'Network.loadingFinished') {
      await this.handleFinished(tabId, params);
    } else if (method === 'Network.loadingFailed') {
      this.handleFailed(tabId, params);
    }
  }

  async continuePaused(tabId, requestId, postData = null) {
    const parameters = { requestId };
    if (typeof postData === 'string') parameters.postData = encodeUtf8Base64(postData);
    await debuggerCall('sendCommand', this.target(tabId), 'Fetch.continueRequest', parameters);
  }

  async pausedPostData(tabId, params) {
    if (typeof params.request?.postData === 'string') return params.request.postData;
    if (!params.networkId) return '';
    try {
      const result = await debuggerCall(
        'sendCommand',
        this.target(tabId),
        'Network.getRequestPostData',
        { requestId: String(params.networkId) },
      );
      return result?.postData ?? '';
    } catch {
      return '';
    }
  }

  async handlePausedRequest(tabId, params) {
    const requestId = String(params.requestId);
    const request = params.request ?? {};
    const endpoint = diagnosticEndpoint(request.url);
    if (!isChatGptConversationRequest(request.url, request.method)) {
      try {
        await this.continuePaused(tabId, requestId);
      } catch (error) {
        this.onRewrite?.(tabId, {
          endpoint,
          changed: false,
          reason: 'continue_failed',
          error: safeError(error),
        });
      }
      return;
    }

    let rewrite = null;
    try {
      const postData = await this.pausedPostData(tabId, params);
      rewrite = rewriteConversationPostData(postData, this.configuration());
      await this.continuePaused(tabId, requestId, rewrite.changed ? rewrite.postData : null);
      this.onRewrite?.(tabId, {
        endpoint,
        changed: rewrite.changed,
        reason: rewrite.reason,
        modelBefore: rewrite.modelBefore,
        modelAfter: rewrite.modelAfter,
        transportModelBefore: rewrite.transportModelBefore,
        transportModelAfter: rewrite.transportModelAfter,
        reasoningBefore: rewrite.reasoningBefore,
        reasoningAfter: rewrite.reasoningAfter,
        reasoningFields: rewrite.reasoningFields,
      });
    } catch (error) {
      const detail = safeError(error);
      this.onRewrite?.(tabId, {
        endpoint,
        changed: false,
        reason: 'rewrite_failed_open',
        modelBefore: rewrite?.modelBefore ?? null,
        modelAfter: rewrite?.modelAfter ?? null,
        error: detail,
      });
      try {
        await this.continuePaused(tabId, requestId);
      } catch (continueError) {
        this.onRewrite?.(tabId, {
          endpoint,
          changed: false,
          reason: 'continue_after_rewrite_failure_failed',
          error: safeError(continueError),
        });
      }
    }
  }

  async handleRequest(tabId, params) {
    const request = params.request ?? {};
    if (!isChatGptConversationRequest(request.url, request.method)) return;
    const configuration = this.configuration();
    const record = {
      tabId,
      requestId: String(params.requestId),
      startedAt: Date.now(),
      url: request.url,
      endpoint: diagnosticEndpoint(request.url),
      mimeType: '',
      responseHeaders: {},
      responseVerificationEnabled: configuration.responseVerificationEnabled !== false,
    };
    this.requests.set(this.key(tabId, record.requestId), record);

    let postData = typeof request.postData === 'string' ? request.postData : '';
    if (!postData) {
      try {
        const result = await debuggerCall(
          'sendCommand',
          this.target(tabId),
          'Network.getRequestPostData',
          { requestId: record.requestId },
        );
        postData = result?.postData ?? '';
      } catch {
        // Some request types do not expose post data.
      }
    }
    const requested = extractRequestEvidence(postData);
    this.onRequest(tabId, {
      requestId: record.requestId,
      capturedAt: new Date().toISOString(),
      model: requested.model,
      reasoning: requested.reasoning,
      conflicts: requested.conflicts,
      fields: requested.fields,
      diagnostics: {
        endpoint: record.endpoint,
        ...requested.diagnostics,
      },
    });
    postData = '';
  }

  handleResponse(tabId, params) {
    const record = this.requests.get(this.key(tabId, String(params.requestId)));
    if (!record) return;
    record.mimeType = params.response?.mimeType ?? '';
    record.responseHeaders = params.response?.headers ?? {};
    record.status = params.response?.status ?? null;
  }

  async handleFinished(tabId, params) {
    const key = this.key(tabId, String(params.requestId));
    const record = this.requests.get(key);
    if (!record) return;
    this.requests.delete(key);
    if (!record.responseVerificationEnabled) return;

    let body = '';
    let bodyError = null;
    try {
      const result = await debuggerCall(
        'sendCommand',
        this.target(tabId),
        'Network.getResponseBody',
        { requestId: record.requestId },
      );
      body = decodeCdpBody(result?.body ?? '', Boolean(result?.base64Encoded));
    } catch (error) {
      bodyError = safeError(error);
    }

    const evidence = extractResponseEvidence({
      body,
      headers: record.responseHeaders,
      mimeType: record.mimeType,
    });
    body = '';
    this.onEvidence(tabId, {
      requestId: record.requestId,
      capturedAt: new Date().toISOString(),
      status: record.status,
      model: evidence.model,
      reasoning: evidence.reasoning,
      conflicts: evidence.conflicts,
      fields: evidence.fields,
      bodyError,
      diagnostics: {
        endpoint: record.endpoint,
        httpStatus: record.status,
        encodedDataLength: Number.isFinite(params.encodedDataLength) ? params.encodedDataLength : null,
        ...evidence.diagnostics,
      },
    });
  }

  handleFailed(tabId, params) {
    const key = this.key(tabId, String(params.requestId));
    const record = this.requests.get(key);
    if (!record) return;
    this.requests.delete(key);
    if (!record.responseVerificationEnabled) return;
    this.onFailure(tabId, {
      requestId: record.requestId,
      error: params.errorText || 'network_loading_failed',
      canceled: Boolean(params.canceled),
      endpoint: record.endpoint,
      httpStatus: record.status,
    });
  }
}
