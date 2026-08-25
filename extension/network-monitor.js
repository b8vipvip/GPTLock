import {
  decodeCdpBody,
  extractRequestEvidence,
  extractResponseEvidence,
  isChatGptConversationRequest,
} from './network-evidence.js';

const CDP_VERSION = '1.3';
const REQUEST_TTL_MS = 15 * 60 * 1000;

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

export class ChatGptNetworkMonitor {
  constructor({ onStatus, onRequest, onEvidence, onFailure }) {
    this.onStatus = onStatus;
    this.onRequest = onRequest;
    this.onEvidence = onEvidence;
    this.onFailure = onFailure;
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
      this.attachedTabs.add(tabId);
      this.onStatus(tabId, { attached: true, error: null });
      return true;
    } catch (error) {
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

    if (method === 'Network.requestWillBeSent') {
      await this.handleRequest(tabId, params);
    } else if (method === 'Network.responseReceived') {
      this.handleResponse(tabId, params);
    } else if (method === 'Network.loadingFinished') {
      await this.handleFinished(tabId, params);
    } else if (method === 'Network.loadingFailed') {
      this.handleFailed(tabId, params);
    }
  }

  async handleRequest(tabId, params) {
    const request = params.request ?? {};
    if (!isChatGptConversationRequest(request.url, request.method)) return;
    const record = {
      tabId,
      requestId: String(params.requestId),
      startedAt: Date.now(),
      url: request.url,
      endpoint: diagnosticEndpoint(request.url),
      mimeType: '',
      responseHeaders: {},
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
    this.onFailure(tabId, {
      requestId: record.requestId,
      error: params.errorText || 'network_loading_failed',
      canceled: Boolean(params.canceled),
      endpoint: record.endpoint,
      httpStatus: record.status,
    });
  }
}
