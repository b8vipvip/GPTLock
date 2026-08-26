from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_exact(path, old, new, count=1):
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} matches, found {actual}: {old[:100]!r}")
    write(path, text.replace(old, new, count))


def replace_regex(path, pattern, replacement, count=1):
    text = read(path)
    next_text, actual = re.subn(pattern, replacement, text, count=count, flags=re.S)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} regex matches, found {actual}: {pattern[:100]!r}")
    write(path, next_text)


# Version 0.3.7 across package/runtime sources.
replace_exact('extension/manifest.json', '"version": "0.3.6"', '"version": "0.3.7"')
replace_exact('extension/package.json', '"version": "0.3.6"', '"version": "0.3.7"')
replace_exact('native-core/Cargo.toml', 'version = "0.3.6"', 'version = "0.3.7"')
replace_exact(
    'native-core/Cargo.lock',
    'name = "gptlock-core"\nversion = "0.3.6"',
    'name = "gptlock-core"\nversion = "0.3.7"',
)

# Parse the handoff contract explicitly instead of guessing downstream model fields.
replace_exact(
    'extension/network-evidence.js',
    "export function parseSseObjects(body) {\n",
    "export function parseSseObjects(body) {\n",
)
insert_after = """export function parseSseObjects(body) {
  const objects = [];
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\\n').trim();
    dataLines = [];
    if (!data || data === '[DONE]') return;
    const parsed = parseJson(data);
    if (parsed && typeof parsed === 'object') objects.push(parsed);
  };

  for (const line of String(body).split(/\\r?\\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
  return objects;
}
"""
text = read('extension/network-evidence.js')
if text.count(insert_after) != 1:
    raise SystemExit('network-evidence.js: parseSseObjects block changed unexpectedly')
handoff_helpers = r'''

export function extractStreamHandoff(body = '') {
  const objects = parseSseObjects(body);
  let resumeToken = null;
  let conversationId = null;
  let handoff = null;
  for (const value of objects) {
    if (value?.type === 'resume_conversation_token') {
      if (typeof value.token === 'string' && value.token) resumeToken = value.token;
      if (typeof value.conversation_id === 'string' && value.conversation_id) {
        conversationId = value.conversation_id;
      }
    }
    if (value?.type === 'stream_handoff') handoff = value;
  }
  if (!handoff) return null;
  const options = Array.isArray(handoff.options) ? handoff.options : [];
  const topicIds = [...new Set(options
    .map((option) => (typeof option?.topic_id === 'string' ? option.topic_id : null))
    .filter(Boolean))];
  const transports = [...new Set(options
    .map((option) => (typeof option?.type === 'string' ? option.type : null))
    .filter(Boolean))];
  return {
    conversationId: typeof handoff.conversation_id === 'string'
      ? handoff.conversation_id
      : conversationId,
    turnExchangeId: typeof handoff.turn_exchange_id === 'string'
      ? handoff.turn_exchange_id
      : null,
    topicIds,
    transports,
    resumeToken,
    resumeTokenPresent: Boolean(resumeToken),
  };
}

export function publicStreamHandoff(handoff) {
  if (!handoff) return null;
  return {
    conversationId: handoff.conversationId ?? null,
    turnExchangeId: handoff.turnExchangeId ?? null,
    topicIds: Array.isArray(handoff.topicIds) ? handoff.topicIds : [],
    transports: Array.isArray(handoff.transports) ? handoff.transports : [],
    resumeTokenPresent: Boolean(handoff.resumeTokenPresent || handoff.resumeToken),
  };
}

export function streamPayloadMatches(payload, handoff) {
  const text = typeof payload === 'string' ? payload : String(payload ?? '');
  if (!text || !handoff) return false;
  const markers = [
    handoff.conversationId,
    handoff.turnExchangeId,
    handoff.resumeToken,
    ...(Array.isArray(handoff.topicIds) ? handoff.topicIds : []),
  ].filter((value) => typeof value === 'string' && value.length >= 8);
  return markers.some((marker) => text.includes(marker));
}
'''
write('extension/network-evidence.js', text.replace(insert_after, insert_after + handoff_helpers))

# Replace the CDP monitor with explicit handoff/downstream HTTP and WebSocket tracking.
network_monitor = r'''import {
  decodeCdpBody,
  extractRequestEvidence,
  extractResponseEvidence,
  extractStreamHandoff,
  isChatGptConversationRequest,
  publicStreamHandoff,
  rewriteConversationPostData,
  streamPayloadMatches,
} from './network-evidence.js';

const CDP_VERSION = '1.3';
const REQUEST_TTL_MS = 15 * 60 * 1000;
const STREAM_TTL_MS = 2 * 60 * 1000;
const PROVISIONAL_STREAM_WINDOW_MS = 12 * 1000;
const MATCHED_SOCKET_WINDOW_MS = 45 * 1000;
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

function isChatGptHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch {
    return false;
  }
}

function looksLikeStreamEndpoint(value) {
  try {
    const url = new URL(value);
    return /(?:conversation|stream|events|sse|topic|turn)/i.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
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
  constructor({ onStatus, onRequest, onEvidence, onFailure, onRewrite, onStreamData, getLockConfiguration }) {
    this.onStatus = onStatus;
    this.onRequest = onRequest;
    this.onEvidence = onEvidence;
    this.onFailure = onFailure;
    this.onRewrite = onRewrite;
    this.onStreamData = onStreamData;
    this.getLockConfiguration = getLockConfiguration;
    this.attachedTabs = new Set();
    this.requests = new Map();
    this.handoffs = new Map();
    this.webSockets = new Map();
    this.lastFormalRequestByTab = new Map();
    this.webSocketSequence = 0;
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
      await debuggerCall('sendCommand', target, 'Fetch.enable', { patterns: FETCH_PATTERNS });
      this.attachedTabs.add(tabId);
      this.onStatus(tabId, { attached: true, error: null });
      return true;
    } catch (error) {
      try { await debuggerCall('sendCommand', target, 'Fetch.disable', {}); } catch {}
      try { await debuggerCall('detach', target); } catch {}
      const detail = safeError(error);
      this.onStatus(tabId, { attached: false, error: detail });
      return false;
    }
  }

  async detach(tabId) {
    this.attachedTabs.delete(tabId);
    this.dropTabRequests(tabId);
    try { await debuggerCall('sendCommand', this.target(tabId), 'Fetch.disable', {}); } catch {}
    try { await debuggerCall('detach', this.target(tabId)); } catch {}
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
    for (const key of this.requests.keys()) if (key.startsWith(prefix)) this.requests.delete(key);
    for (const key of this.handoffs.keys()) if (key.startsWith(prefix)) this.handoffs.delete(key);
    for (const key of this.webSockets.keys()) if (key.startsWith(prefix)) this.webSockets.delete(key);
    this.lastFormalRequestByTab.delete(tabId);
  }

  purgeOldRequests() {
    const requestCutoff = Date.now() - REQUEST_TTL_MS;
    for (const [key, request] of this.requests) {
      if (request.startedAt < requestCutoff) this.requests.delete(key);
    }
    const streamCutoff = Date.now() - STREAM_TTL_MS;
    for (const [key, handoff] of this.handoffs) {
      if (handoff.startedAt < streamCutoff) this.handoffs.delete(key);
    }
    for (const [key, socket] of this.webSockets) {
      if ((socket.lastActivityAt || socket.startedAt || 0) < streamCutoff) this.webSockets.delete(key);
    }
  }

  activeHandoffs(tabId) {
    const now = Date.now();
    return [...this.handoffs.values()]
      .filter((handoff) => handoff.tabId === tabId && now - handoff.startedAt <= STREAM_TTL_MS)
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  newestHandoff(tabId) {
    return this.activeHandoffs(tabId)[0] ?? null;
  }

  matchHandoff(tabId, payload) {
    return this.activeHandoffs(tabId).find((handoff) => streamPayloadMatches(payload, handoff)) ?? null;
  }

  registerHandoff(tabId, initialRequestId, parsed) {
    if (!parsed) return null;
    const key = this.key(tabId, initialRequestId);
    const handoff = {
      ...parsed,
      id: key,
      tabId,
      initialRequestId,
      startedAt: Date.now(),
    };
    this.handoffs.set(key, handoff);
    this.onStreamData?.(tabId, {
      requestId: initialRequestId,
      capturedAt: new Date().toISOString(),
      rawStreamData: null,
      diagnostics: {
        transport: 'handoff',
        direction: 'received',
        stage: 'handoff_detected',
        streamHandoff: publicStreamHandoff(handoff),
      },
      streamContext: this.streamContext(handoff, { transport: 'handoff', stage: 'handoff_detected' }),
    });
    return handoff;
  }

  streamContext(handoff, extra = {}) {
    return {
      isDownstream: extra.isDownstream !== false,
      initialRequestId: handoff?.initialRequestId ?? null,
      conversationId: handoff?.conversationId ?? null,
      turnExchangeId: handoff?.turnExchangeId ?? null,
      topicIds: Array.isArray(handoff?.topicIds) ? handoff.topicIds : [],
      transport: extra.transport ?? null,
      direction: extra.direction ?? 'received',
      stage: extra.stage ?? 'downstream',
      matchBasis: extra.matchBasis ?? null,
    };
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
    } else if (method === 'Network.webSocketCreated') {
      this.handleWebSocketCreated(tabId, params);
    } else if (method === 'Network.webSocketFrameSent') {
      this.handleWebSocketFrame(tabId, params, 'sent');
    } else if (method === 'Network.webSocketFrameReceived') {
      this.handleWebSocketFrame(tabId, params, 'received');
    } else if (method === 'Network.webSocketClosed') {
      this.webSockets.delete(this.key(tabId, String(params.requestId)));
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
        this.onRewrite?.(tabId, { endpoint, changed: false, reason: 'continue_failed', error: safeError(error) });
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

  async requestPostData(tabId, requestId, request) {
    if (typeof request?.postData === 'string') return request.postData;
    try {
      const result = await debuggerCall(
        'sendCommand',
        this.target(tabId),
        'Network.getRequestPostData',
        { requestId },
      );
      return result?.postData ?? '';
    } catch {
      return '';
    }
  }

  async handleRequest(tabId, params) {
    const request = params.request ?? {};
    const requestId = String(params.requestId);
    if (isChatGptConversationRequest(request.url, request.method)) {
      const configuration = this.configuration();
      const record = {
        tabId,
        requestId,
        startedAt: Date.now(),
        url: request.url,
        endpoint: diagnosticEndpoint(request.url),
        mimeType: '',
        responseHeaders: {},
        responseVerificationEnabled: configuration.responseVerificationEnabled !== false,
        downstream: false,
      };
      this.requests.set(this.key(tabId, requestId), record);
      this.lastFormalRequestByTab.set(tabId, { requestId, startedAt: record.startedAt });

      const postData = await this.requestPostData(tabId, requestId, request);
      const requested = extractRequestEvidence(postData);
      this.onRequest(tabId, {
        requestId,
        capturedAt: new Date().toISOString(),
        model: requested.model,
        reasoning: requested.reasoning,
        conflicts: requested.conflicts,
        fields: requested.fields,
        diagnostics: { endpoint: record.endpoint, ...requested.diagnostics },
      });
      return;
    }

    if (!isChatGptHttps(request.url) || !this.activeHandoffs(tabId).length) {
      const recent = this.lastFormalRequestByTab.get(tabId);
      if (!recent || Date.now() - recent.startedAt > PROVISIONAL_STREAM_WINDOW_MS) return;
      if (!isChatGptHttps(request.url) || !looksLikeStreamEndpoint(request.url)) return;
    }

    const postData = await this.requestPostData(tabId, requestId, request);
    const handoff = this.matchHandoff(tabId, `${request.url}\n${postData}`);
    const recent = this.lastFormalRequestByTab.get(tabId);
    const provisional = !handoff && recent && Date.now() - recent.startedAt <= PROVISIONAL_STREAM_WINDOW_MS
      && looksLikeStreamEndpoint(request.url);
    if (!handoff && !provisional) return;
    this.requests.set(this.key(tabId, requestId), {
      tabId,
      requestId,
      startedAt: Date.now(),
      url: request.url,
      endpoint: diagnosticEndpoint(request.url),
      mimeType: '',
      responseHeaders: {},
      responseVerificationEnabled: true,
      downstream: true,
      downstreamCandidate: provisional,
      handoffId: handoff?.id ?? null,
      matchBasis: handoff ? 'request_marker' : 'provisional_after_formal_request',
    });
  }

  handleResponse(tabId, params) {
    const key = this.key(tabId, String(params.requestId));
    let record = this.requests.get(key);
    const mimeType = params.response?.mimeType ?? '';
    if (!record && /event-stream/i.test(mimeType) && isChatGptHttps(params.response?.url || '')) {
      const handoff = this.newestHandoff(tabId);
      if (handoff && looksLikeStreamEndpoint(params.response?.url || '')) {
        record = {
          tabId,
          requestId: String(params.requestId),
          startedAt: Date.now(),
          url: params.response?.url || '',
          endpoint: diagnosticEndpoint(params.response?.url || ''),
          mimeType: '',
          responseHeaders: {},
          responseVerificationEnabled: true,
          downstream: true,
          downstreamCandidate: true,
          handoffId: handoff.id,
          matchBasis: 'event_stream_response_after_handoff',
        };
        this.requests.set(key, record);
      }
    }
    if (!record) return;
    record.mimeType = mimeType;
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

    let handoff = record.handoffId ? this.handoffs.get(record.handoffId) : null;
    if (!record.downstream) {
      const parsedHandoff = extractStreamHandoff(body);
      if (parsedHandoff) handoff = this.registerHandoff(tabId, record.requestId, parsedHandoff);
    } else if (!handoff) {
      handoff = this.matchHandoff(tabId, `${record.url}\n${body}`) || this.newestHandoff(tabId);
    }

    if (record.downstream && !handoff) return;
    if (record.downstreamCandidate && handoff && !streamPayloadMatches(`${record.url}\n${body}`, handoff)) {
      const age = Date.now() - handoff.startedAt;
      if (age > PROVISIONAL_STREAM_WINDOW_MS || !/event-stream/i.test(record.mimeType)) return;
    }

    const evidence = extractResponseEvidence({
      body,
      headers: record.responseHeaders,
      mimeType: record.mimeType,
    });
    const streamHandoff = !record.downstream && handoff ? publicStreamHandoff(handoff) : null;
    this.onEvidence(tabId, {
      requestId: record.requestId,
      capturedAt: new Date().toISOString(),
      status: record.status,
      model: evidence.model,
      reasoning: evidence.reasoning,
      conflicts: evidence.conflicts,
      fields: evidence.fields,
      bodyError,
      rawResponseBody: (/event-stream/i.test(record.mimeType) || String(evidence.diagnostics?.bodyFormat || '').includes('sse'))
        ? body
        : null,
      streamContext: handoff
        ? this.streamContext(handoff, {
          isDownstream: Boolean(record.downstream),
          transport: 'sse',
          direction: 'received',
          stage: record.downstream ? 'downstream_http' : 'initial_conversation',
          matchBasis: record.matchBasis ?? (record.downstream ? 'handoff_marker' : 'formal_request'),
        })
        : null,
      diagnostics: {
        endpoint: record.endpoint,
        httpStatus: record.status,
        encodedDataLength: Number.isFinite(params.encodedDataLength) ? params.encodedDataLength : null,
        transport: 'sse',
        direction: 'received',
        stage: record.downstream ? 'downstream_http' : 'initial_conversation',
        streamHandoff,
        ...evidence.diagnostics,
      },
    });
    body = '';
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
      downstream: Boolean(record.downstream),
    });
  }

  handleWebSocketCreated(tabId, params) {
    const requestId = String(params.requestId);
    const handoff = this.matchHandoff(tabId, params.url || '');
    this.webSockets.set(this.key(tabId, requestId), {
      tabId,
      requestId,
      url: params.url || '',
      endpoint: diagnosticEndpoint(params.url || ''),
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      handoffId: handoff?.id ?? null,
      matchedAt: handoff ? Date.now() : null,
      matchBasis: handoff ? 'websocket_url_marker' : null,
    });
  }

  handleWebSocketFrame(tabId, params, direction) {
    const requestId = String(params.requestId);
    const key = this.key(tabId, requestId);
    let socket = this.webSockets.get(key);
    if (!socket) {
      socket = {
        tabId,
        requestId,
        url: '',
        endpoint: 'websocket',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        handoffId: null,
        matchedAt: null,
        matchBasis: null,
      };
      this.webSockets.set(key, socket);
    }
    socket.lastActivityAt = Date.now();
    const payload = typeof params.response?.payloadData === 'string' ? params.response.payloadData : '';
    let handoff = socket.handoffId ? this.handoffs.get(socket.handoffId) : null;
    const exact = this.matchHandoff(tabId, payload);
    if (exact) {
      handoff = exact;
      socket.handoffId = exact.id;
      socket.matchedAt = Date.now();
      socket.matchBasis = direction === 'sent' ? 'subscription_frame_marker' : 'received_frame_marker';
    }
    const inheritedMatch = handoff && socket.matchedAt && Date.now() - socket.matchedAt <= MATCHED_SOCKET_WINDOW_MS;
    if (!handoff || (!exact && !inheritedMatch)) return;

    const streamContext = this.streamContext(handoff, {
      transport: 'websocket',
      direction,
      stage: 'downstream_websocket',
      matchBasis: exact ? socket.matchBasis : 'matched_socket_window',
    });
    const frameId = `ws-${requestId}-${++this.webSocketSequence}`;
    if (direction === 'sent') {
      if (!exact) return;
      this.onStreamData?.(tabId, {
        requestId: frameId,
        capturedAt: new Date().toISOString(),
        rawStreamData: payload,
        streamContext,
        diagnostics: {
          endpoint: socket.endpoint,
          httpStatus: 101,
          mimeType: 'application/websocket',
          bodyFormat: 'websocket_frame',
          transport: 'websocket',
          direction,
          stage: 'downstream_websocket',
        },
      });
      return;
    }

    const evidence = extractResponseEvidence({ body: payload, headers: {}, mimeType: 'application/json' });
    this.onEvidence(tabId, {
      requestId: frameId,
      capturedAt: new Date().toISOString(),
      status: 101,
      model: evidence.model,
      reasoning: evidence.reasoning,
      conflicts: evidence.conflicts,
      fields: evidence.fields,
      bodyError: null,
      rawResponseBody: payload,
      streamContext,
      diagnostics: {
        endpoint: socket.endpoint,
        httpStatus: 101,
        transport: 'websocket',
        direction,
        stage: 'downstream_websocket',
        ...evidence.diagnostics,
        bodyFormat: evidence.diagnostics?.bodyFormat === 'unparsed'
          ? 'websocket_frame'
          : evidence.diagnostics?.bodyFormat,
      },
    });
  }
}
'''
write('extension/network-monitor.js', network_monitor)

# Generalize the 10 MiB diagnostic capture so one budget covers initial SSE + downstream SSE + matched WebSocket frames.
runtime = read('extension/runtime-log.js')
start = runtime.index('export const MAX_DIAGNOSTIC_SSE_BYTES')
end = runtime.index('\nlet writeQueue = Promise.resolve();')
stream_helpers = r'''export const MAX_DIAGNOSTIC_SSE_BYTES = 10 * 1024 * 1024;
export const MAX_DIAGNOSTIC_STREAM_BYTES = MAX_DIAGNOSTIC_SSE_BYTES;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

export function createDiagnosticSseCapture({ tabId = null, startedAt = null } = {}) {
  return {
    schemaVersion: 2,
    captureScope: 'auto_verification_stream_only',
    maxBytes: MAX_DIAGNOSTIC_STREAM_BYTES,
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

export function appendDiagnosticSseCapture(capture, entry, maxBytes = MAX_DIAGNOSTIC_STREAM_BYTES) {
  const base = capture && typeof capture === 'object' ? capture : createDiagnosticSseCapture();
  const next = {
    ...base,
    schemaVersion: 2,
    captureScope: 'auto_verification_stream_only',
    maxBytes,
    totalBytes: Number(base.totalBytes || 0),
    includedBytes: Number(base.includedBytes || 0),
    overflowed: Boolean(base.overflowed),
    omittedResponses: Number(base.omittedResponses || 0),
    omittedBytes: Number(base.omittedBytes || 0),
    entries: Array.isArray(base.entries) ? [...base.entries] : [],
    omitted: Array.isArray(base.omitted) ? [...base.omitted] : [],
  };
  const rawData = typeof entry?.rawData === 'string'
    ? entry.rawData
    : typeof entry?.rawSse === 'string'
      ? entry.rawSse
      : typeof entry?.rawFrame === 'string'
        ? entry.rawFrame
        : '';
  const bodyBytes = utf8ByteLength(rawData);
  next.totalBytes += bodyBytes;
  if (!rawData || bodyBytes === 0) return next;

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
      transport: entry?.transport ?? null,
      direction: entry?.direction ?? null,
      stage: entry?.stage ?? null,
      bodyBytes,
      reason: 'diagnostic_stream_size_limit',
    });
    return next;
  }

  const transport = entry?.transport || (/event-stream/i.test(entry?.mimeType || '') ? 'sse' : 'unknown');
  const stored = {
    attempt: entry?.attempt ?? null,
    requestId: entry?.requestId ?? null,
    capturedAt: entry?.capturedAt ?? null,
    endpoint: entry?.endpoint ?? null,
    httpStatus: entry?.httpStatus ?? null,
    mimeType: entry?.mimeType ?? null,
    bodyFormat: entry?.bodyFormat ?? null,
    transport,
    direction: entry?.direction ?? 'received',
    stage: entry?.stage ?? null,
    requestModel: entry?.requestModel ?? null,
    rewriteReason: entry?.rewriteReason ?? null,
    streamContext: entry?.streamContext ?? null,
    bodyBytes,
  };
  if (transport === 'websocket') stored.rawFrame = rawData;
  else stored.rawSse = rawData;
  next.entries.push(stored);
  next.includedBytes = projected;
  return next;
}

export function finalizeDiagnosticSseCapture(capture, completedAt = null) {
  if (!capture || typeof capture !== 'object') return null;
  return { ...capture, completedAt: completedAt || new Date().toISOString() };
}
'''
write('extension/runtime-log.js', runtime[:start] + stream_helpers + runtime[end:])

# Harden UI alignment: never probe generic buttons and never click when the current UI value is unknown.
replace_regex(
    'extension/content.js',
    r"  const MODEL_SELECTORS = \[.*?\n  \];\n  const REASONING_SELECTORS = \[.*?\n  \];",
    r'''  const MODEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[data-testid*="model-switcher"]',
    'button[aria-label*="model" i][aria-haspopup="menu"]',
    'button[aria-label*="模型"][aria-haspopup="menu"]',
  ];
  const REASONING_SELECTORS = [
    '[data-testid*="reasoning"] button',
    'button[data-testid*="reasoning"]',
    'button[data-testid*="thinking"]',
    'button[aria-label*="reasoning" i][aria-haspopup]',
    'button[aria-label*="thinking" i][aria-haspopup]',
    'button[aria-label*="推理"][aria-haspopup]',
    'button[aria-label*="思考"][aria-haspopup]',
  ];''',
)
replace_exact('extension/content.js', "  const MAX_CONVERSATION_MAPPING_NODES = 5000;\n", '')
replace_exact(
    'extension/content.js',
    "    if (!trigger) return false;\n    trigger.click();",
    "    if (!trigger) return false;\n    const triggerValue = elementTexts(trigger).map(normalize).find(Boolean);\n    if (!triggerValue) return false;\n    trigger.click();",
)
replace_exact(
    'extension/content.js',
    "    if (desiredModel && (force || (observation.model && observation.model !== desiredModel))) {\n      if (observation.model !== desiredModel) {\n        changed = await chooseExact(MODEL_SELECTORS, desiredModel, normalizeDisplayedModel);\n      }\n    }",
    "    if (desiredModel && observation.model && observation.model !== desiredModel) {\n      changed = await chooseExact(MODEL_SELECTORS, desiredModel, normalizeDisplayedModel);\n    }",
)
replace_exact(
    'extension/content.js',
    "    if (preferred && !changed && (force || (afterModel.reasoning && afterModel.reasoning !== preferred))) {\n      if (afterModel.reasoning !== preferred) {\n        changed = await chooseExact(REASONING_SELECTORS, preferred, normalizeDisplayedReasoning);\n      }\n    }",
    "    if (preferred && !changed && afterModel.reasoning && afterModel.reasoning !== preferred) {\n      changed = await chooseExact(REASONING_SELECTORS, preferred, normalizeDisplayedReasoning);\n    }",
)
# Remove the obsolete /backend-api/conversation/:id GET fallback implementation and handler.
replace_regex(
    'extension/content.js',
    r"\n  function currentConversationId\(\) \{.*?\n  async function autoSendProbe\(options = \{\}\) \{",
    "\n  async function autoSendProbe(options = {}) {",
)
replace_regex(
    'extension/content.js',
    r"\n    if \(message\?\.type === 'GPTLOCK_FETCH_CONVERSATION_EVIDENCE'\) \{.*?\n      return true;\n    \}",
    '',
)

# Background: rename capture flow to stream capture and preserve downstream evidence instead of rejecting it by request id.
replace_exact('extension/background.js', "const AUTO_VERIFY_FALLBACK_DELAY_MS = 700;\n", "const AUTO_VERIFY_HANDOFF_MIN_WAIT_MS = 9000;\nconst AUTO_VERIFY_HANDOFF_IDLE_MS = 1200;\n")
replace_exact('extension/background.js', 'startAutoVerificationSseCapture', 'startAutoVerificationStreamCapture', count=2)
replace_exact('extension/background.js', 'finalizeAutoVerificationSseCapture', 'finalizeAutoVerificationStreamCapture', count=2)
replace_exact('extension/background.js', 'clearAutoVerificationSseCapture', 'clearAutoVerificationStreamCapture', count=2)
replace_exact('extension/background.js', 'captureAutoVerificationSse', 'captureAutoVerificationStream', count=2)
replace_exact('extension/background.js', "logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_failed'", "logRuntime('warn', 'diagnostics', 'auto_verify_stream_capture_failed'")
replace_exact('extension/background.js', "logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_start_failed'", "logRuntime('warn', 'diagnostics', 'auto_verify_stream_capture_start_failed'")
replace_exact('extension/background.js', "logRuntime('warn', 'diagnostics', 'auto_verify_sse_capture_finalize_failed'", "logRuntime('warn', 'diagnostics', 'auto_verify_stream_capture_finalize_failed'")

replace_regex(
    'extension/background.js',
    r"async function captureAutoVerificationStream\(tabId, state, evidence\) \{.*?\n\}\n\nasync function finalizeAutoVerificationStreamCapture",
    r'''async function captureAutoVerificationStream(tabId, state, evidence) {
  const rawData = typeof evidence?.rawStreamData === 'string'
    ? evidence.rawStreamData
    : evidence?.rawResponseBody;
  const mimeType = String(evidence?.diagnostics?.mimeType || '');
  const bodyFormat = String(evidence?.diagnostics?.bodyFormat || '');
  const transport = evidence?.streamContext?.transport
    || evidence?.diagnostics?.transport
    || (/event-stream/i.test(mimeType) || bodyFormat.includes('sse') ? 'sse' : 'unknown');
  const isDownstream = Boolean(evidence?.streamContext?.isDownstream);
  if (!state.autoVerification?.running || typeof rawData !== 'string' || !rawData) return null;
  if (transport === 'unknown' && !isDownstream) return null;
  if (!isDownstream && state.lastRequest?.requestId && state.lastRequest.requestId !== evidence.requestId) return null;

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
    transport,
    direction: evidence?.streamContext?.direction ?? evidence?.diagnostics?.direction ?? 'received',
    stage: evidence?.streamContext?.stage ?? evidence?.diagnostics?.stage ?? null,
    streamContext: evidence?.streamContext ?? null,
    requestModel: state.lastRequest?.model ?? null,
    rewriteReason: state.lastRewrite?.reason ?? null,
    rawData,
  });
  await chrome.storage.local.set({ [DIAGNOSTIC_SSE_STORAGE_KEY]: next });
  logRuntime(next.overflowed ? 'warn' : 'info', 'diagnostics', 'auto_verify_stream_captured', {
    tabId,
    attempt: state.autoVerification.attempt ?? null,
    requestId: evidence.requestId ?? null,
    transport,
    direction: evidence?.streamContext?.direction ?? evidence?.diagnostics?.direction ?? 'received',
    stage: evidence?.streamContext?.stage ?? evidence?.diagnostics?.stage ?? null,
    addedBytes: Math.max(0, Number(next.includedBytes || 0) - beforeIncludedBytes),
    includedBytes: next.includedBytes,
    totalBytes: next.totalBytes,
    maxBytes: next.maxBytes,
    overflowed: next.overflowed,
    omittedResponses: next.omittedResponses,
  });
  return next;
}

async function finalizeAutoVerificationStreamCapture''',
)

replace_exact(
    'extension/background.js',
    "    lastEvidenceDiagnostics: null,\n    evidenceIssue: null,",
    "    lastEvidenceDiagnostics: null,\n    streamTracking: null,\n    evidenceIssue: null,",
)
replace_exact(
    'extension/background.js',
    "  state.lastEvidenceDiagnostics = null;\n  state.evidenceIssue = null;",
    "  state.lastEvidenceDiagnostics = null;\n  state.streamTracking = null;\n  state.evidenceIssue = null;",
)

# Teach applyNetworkEvidence about handoff/downstream activity before evaluation.
replace_exact(
    'extension/background.js',
    "async function applyNetworkEvidence(tabId, evidence) {\n  const state = ensureTabState(tabId);\n  try {\n    await captureAutoVerificationStream(tabId, state, evidence);",
    "async function applyNetworkEvidence(tabId, evidence) {\n  const state = ensureTabState(tabId);\n  const handoff = evidence?.diagnostics?.streamHandoff;\n  if (handoff) {\n    state.streamTracking = {\n      detectedAt: Date.now(),\n      lastActivityAt: Date.now(),\n      downstreamEvidenceCount: 0,\n      transports: [],\n      handoff,\n    };\n    logRuntime('info', 'network', 'stream_handoff_detected', { tabId, handoff });\n  }\n  if (evidence?.streamContext?.isDownstream) {\n    const tracking = state.streamTracking || {\n      detectedAt: Date.now(),\n      lastActivityAt: Date.now(),\n      downstreamEvidenceCount: 0,\n      transports: [],\n      handoff: null,\n    };\n    tracking.lastActivityAt = Date.now();\n    tracking.downstreamEvidenceCount += 1;\n    const transport = evidence.streamContext.transport || evidence?.diagnostics?.transport || 'unknown';\n    if (!tracking.transports.includes(transport)) tracking.transports.push(transport);\n    state.streamTracking = tracking;\n  }\n  try {\n    await captureAutoVerificationStream(tabId, state, evidence);",
)

# Add raw stream-only callback and prevent downstream transport failures from poisoning the formal request state.
replace_exact(
    'extension/background.js',
    "  onEvidence(tabId, evidence) {\n    void applyNetworkEvidence(tabId, evidence);\n  },\n  onFailure(tabId, failure) {",
    "  onEvidence(tabId, evidence) {\n    void applyNetworkEvidence(tabId, evidence);\n  },\n  onStreamData(tabId, streamData) {\n    const state = ensureTabState(tabId);\n    if (streamData?.streamContext?.isDownstream) {\n      const tracking = state.streamTracking || {\n        detectedAt: Date.now(),\n        lastActivityAt: Date.now(),\n        downstreamEvidenceCount: 0,\n        transports: [],\n        handoff: null,\n      };\n      tracking.lastActivityAt = Date.now();\n      const transport = streamData.streamContext.transport || streamData?.diagnostics?.transport || 'unknown';\n      if (!tracking.transports.includes(transport)) tracking.transports.push(transport);\n      state.streamTracking = tracking;\n    }\n    void captureAutoVerificationStream(tabId, state, streamData).catch((error) => {\n      logRuntime('warn', 'diagnostics', 'auto_verify_stream_capture_failed', { tabId, error: errorText(error) });\n    });\n  },\n  onFailure(tabId, failure) {",
)
replace_exact(
    'extension/background.js',
    "    void applyNetworkEvidence(tabId, {\n      requestId: failure.requestId,",
    "    if (failure.downstream) return;\n    void applyNetworkEvidence(tabId, {\n      requestId: failure.requestId,",
)

# Outcome and wait logic now waits for handoff follow-up activity instead of the obsolete detail GET.
replace_regex(
    'extension/background.js',
    r"function verificationOutcome\(state, \{ timedOut = false, fallbackError = null \} = \{\}\) \{.*?\n\}\n\nasync function waitForAttemptVerification",
    r'''function verificationOutcome(state, { timedOut = false } = {}) {
  const verification = state.lastVerification;
  const reasons = Array.isArray(verification?.reasons) ? verification.reasons : [];
  const modelAllowed = Boolean(
    verification?.model && currentPolicy.lockedModels.includes(verification.model),
  );
  if (verification?.verdict === 'verified') return { outcome: 'verified', reason: null };
  if (reasons.includes('model_not_allowed')) {
    return { outcome: 'model_mismatch', reason: 'confirmed_model_mismatch' };
  }
  if (modelAllowed && reasons.includes('reasoning_missing')) {
    return { outcome: 'model_verified_reasoning_unconfirmed', reason: 'reasoning_not_exposed' };
  }
  if (timedOut) return { outcome: 'unverified', reason: 'response_verification_timeout' };
  if (state.evidenceIssue === 'response_body_read_failed') {
    return { outcome: 'unverified', reason: 'response_body_read_failed' };
  }
  if (state.streamTracking?.handoff) {
    if ((state.streamTracking.downstreamEvidenceCount || 0) === 0) {
      return { outcome: 'unverified', reason: 'stream_handoff_followup_not_observed' };
    }
    if (state.evidenceIssue === 'response_model_not_exposed' || reasons.includes('model_missing')) {
      return { outcome: 'unverified', reason: 'downstream_model_not_exposed' };
    }
  }
  if (state.evidenceIssue === 'response_model_not_exposed' || reasons.includes('model_missing')) {
    return { outcome: 'unverified', reason: 'model_not_exposed' };
  }
  if (state.evidenceIssue === 'response_reasoning_not_exposed' || reasons.includes('reasoning_missing')) {
    return { outcome: 'unverified', reason: 'reasoning_not_exposed' };
  }
  if (state.phase === 'error') return { outcome: 'error', reason: state.lastError || 'verification_error' };
  return { outcome: 'unverified', reason: state.evidenceIssue || verification?.reason || 'metadata_incomplete' };
}

async function waitForAttemptVerification''',
)
replace_regex(
    'extension/background.js',
    r"async function waitForAttemptVerification\(tabId, startedAtMs\) \{.*?\n\}\n\nasync function collectConversationEvidence.*?\n\}\n\nfunction probeText",
    r'''async function waitForAttemptVerification(tabId, startedAtMs) {
  const deadline = Date.now() + AUTO_VERIFY_RESPONSE_TIMEOUT_MS;
  let requestId = null;
  while (Date.now() < deadline) {
    const state = ensureTabState(tabId);
    const requestTime = Date.parse(state.lastRequest?.capturedAt || '');
    if (
      state.lastRequest?.requestId
      && Number.isFinite(requestTime)
      && requestTime >= startedAtMs - 1500
    ) requestId = state.lastRequest.requestId;

    if (requestId && state.lastVerification?.verdict === 'verified') {
      return { timedOut: false, requestId, verified: true };
    }
    const tracking = state.streamTracking;
    if (requestId && tracking?.handoff) {
      const detectedAt = Number(tracking.detectedAt || 0);
      const lastActivityAt = Number(tracking.lastActivityAt || detectedAt);
      if (
        detectedAt
        && Date.now() - detectedAt >= AUTO_VERIFY_HANDOFF_MIN_WAIT_MS
        && Date.now() - lastActivityAt >= AUTO_VERIFY_HANDOFF_IDLE_MS
      ) {
        return {
          timedOut: false,
          requestId,
          handoffSettled: true,
          downstreamEvidenceCount: tracking.downstreamEvidenceCount || 0,
        };
      }
    } else if (
      requestId
      && state.lastVerification?.requestId === `cdp-${tabId}-${requestId}`
    ) {
      return { timedOut: false, requestId };
    }
    if (state.phase === 'error' && state.lastError) {
      return { timedOut: false, requestId, error: state.lastError };
    }
    await sleep(AUTO_VERIFY_POLL_MS);
  }
  return { timedOut: true, requestId };
}

function probeText''',
)

# Remove old fallback from the attempt body; waitForAttemptVerification now lets downstream traffic settle.
replace_regex(
    'extension/background.js',
    r"    const waited = await waitForAttemptVerification\(tabId, attemptStartedMs\);\n    let fallbackAttempted = false;\n    let fallbackError = null;\n    if \(waited.timedOut\) \{.*?\n    \}\n\n    const requestLocked = requestLockConfirmed\(state\);\n    const outcome = verificationOutcome\(state, \{\n      timedOut: waited.timedOut,\n      fallbackError,\n    \}\);",
    r'''    const waited = await waitForAttemptVerification(tabId, attemptStartedMs);
    if (waited.timedOut) {
      state.phase = 'unverified';
      state.evidenceIssue = 'auto_verify_response_timeout';
      state.lastError = 'response_verification_timeout';
      logRuntime('warn', 'verification', 'auto_verify_response_timeout', {
        tabId,
        attempt,
        requestId: waited.requestId,
        timeoutMs: AUTO_VERIFY_RESPONSE_TIMEOUT_MS,
      });
      await broadcastTabState(tabId);
    } else if (state.lastVerification?.verdict !== 'verified') {
      logRuntime('info', 'verification', 'conversation_fallback_skipped', {
        tabId,
        attempt,
        reason: 'deprecated_after_stream_handoff_tracking',
        handoffSettled: Boolean(waited.handoffSettled),
        downstreamEvidenceCount: state.streamTracking?.downstreamEvidenceCount || 0,
      });
    }

    const requestLocked = requestLockConfirmed(state);
    const outcome = verificationOutcome(state, { timedOut: waited.timedOut });''',
)
replace_exact('extension/background.js', "      fallbackAttempted,\n      fallbackError,\n", "      streamTracking: state.streamTracking ? { ...state.streamTracking } : null,\n")

# Finalize renamed capture calls.
replace_exact('extension/background.js', "await finalizeAutoVerificationStreamCapture(tabId, state.autoVerification.completedAt);", "await finalizeAutoVerificationStreamCapture(tabId, state.autoVerification.completedAt);")

# Diagnostics bundle schema v4 and truthful stream privacy metadata.
replace_exact('extension/background.js', '    schemaVersion: 3,', '    schemaVersion: 4,')
replace_exact('extension/background.js', '  const rawSseCapture = stored[DIAGNOSTIC_SSE_STORAGE_KEY] ?? null;', '  const rawStreamCapture = stored[DIAGNOSTIC_SSE_STORAGE_KEY] ?? null;')
replace_regex(
    'extension/background.js',
    r"    privacy: \{.*?\n    autoVerificationSse: rawSseCapture,",
    r'''    privacy: {
      chatContentIncluded: Boolean(rawStreamCapture?.entries?.length),
      autoVerificationStreamIncluded: Boolean(rawStreamCapture?.entries?.length),
      autoVerificationSseIncluded: Boolean(rawStreamCapture?.entries?.some((entry) => entry.transport === 'sse')),
      autoVerificationWebSocketIncluded: Boolean(rawStreamCapture?.entries?.some((entry) => entry.transport === 'websocket')),
      autoVerificationOnly: true,
      accountCredentialsIncluded: false,
      requestHeadersIncluded: false,
      responseHeadersIncluded: false,
      streamResumeTokensMayBeIncluded: Boolean(rawStreamCapture?.entries?.some((entry) => typeof entry.rawSse === 'string' && entry.rawSse.includes('resume_conversation_token'))),
      noteZhCn: '普通聊天仍不打包请求/响应正文。仅自动验证固定测试消息对应的初始 SSE、handoff 后续 SSE 与已匹配 topic 的 WebSocket 帧进入诊断包，合计上限 10 MiB。原始 handoff SSE 可能包含短期 resume token、消息/会话 ID 和服务器元数据；不采集 Cookie、Authorization、请求头、响应头或浏览器账号凭据。',
      noteEn: 'Ordinary chat bodies remain excluded. Only the fixed auto-verification probes may contribute initial SSE, post-handoff SSE, and WebSocket frames matched to the handoff topic, with one 10 MiB aggregate cap. Raw handoff SSE can contain short-lived resume tokens, message/conversation IDs, and server metadata; cookies, Authorization, request/response headers, and browser account credentials are not captured.',
    },
    autoVerificationStream: rawStreamCapture,''',
)

# Ensure diagnostic state includes stream tracking.
replace_exact(
    'extension/background.js',
    "    lastEvidenceDiagnostics: state.lastEvidenceDiagnostics,\n    evidenceIssue: state.evidenceIssue,",
    "    lastEvidenceDiagnostics: state.lastEvidenceDiagnostics,\n    streamTracking: state.streamTracking,\n    evidenceIssue: state.evidenceIssue,",
)

# Diagnostics page now reports all captured transports.
replace_regex(
    'extension/diagnostics.js',
    r"    const sse = bundle.autoVerificationSse;\n    elements.message.textContent = sse\?\.entries\?\.length\n      \? `诊断包已导出；包含 \$\{sse.entries.length\} 条自动验证原始 SSE，共 \$\{sse.includedBytes \|\| 0\} 字节\$\{sse.overflowed \? '，另有超限响应未完整打包' : ''\}。`\n      : '诊断包已导出；本次没有可打包的自动验证原始 SSE / Diagnostic bundle exported.';",
    r'''    const stream = bundle.autoVerificationStream;
    const entries = Array.isArray(stream?.entries) ? stream.entries : [];
    const sseCount = entries.filter((entry) => entry.transport === 'sse').length;
    const wsCount = entries.filter((entry) => entry.transport === 'websocket').length;
    elements.message.textContent = entries.length
      ? `诊断包已导出；自动验证流共 ${entries.length} 条（SSE ${sseCount} / WebSocket ${wsCount}），${stream.includedBytes || 0} 字节${stream.overflowed ? '，另有超限数据未完整打包' : ''}。`
      : '诊断包已导出；本次没有可打包的自动验证流数据 / Diagnostic bundle exported.';''',
)
replace_exact(
    'extension/diagnostics.js',
    "确认清空扩展运行日志和自动验证 SSE 诊断缓存？本地核心 audit.jsonl 不会被删除。\\nClear extension runtime logs and auto-verification SSE cache? Native audit.jsonl will be kept.",
    "确认清空扩展运行日志和自动验证流诊断缓存？本地核心 audit.jsonl 不会被删除。\\nClear extension runtime logs and auto-verification stream cache? Native audit.jsonl will be kept.",
)

# Unit tests for handoff parsing/matching and generic stream capture.
replace_exact(
    'extension/tests/network-evidence.test.mjs',
    "  extractResponseEvidence,\n  isChatGptConversationRequest,",
    "  extractResponseEvidence,\n  extractStreamHandoff,\n  isChatGptConversationRequest,\n  publicStreamHandoff,",
)
replace_exact(
    'extension/tests/network-evidence.test.mjs',
    "  rewriteConversationPostData,\n} from '../network-evidence.js';",
    "  rewriteConversationPostData,\n  streamPayloadMatches,\n} from '../network-evidence.js';",
)
network_test = r'''

test('extracts ChatGPT stream handoff and matches downstream topic or resume token', () => {
  const token = 'resume-token-1234567890';
  const body = [
    'event: delta_encoding',
    'data: "v1"',
    '',
    `data: {"type":"resume_conversation_token","kind":"topic","token":"${token}","conversation_id":"conv-12345678"}`,
    '',
    'data: {"type":"stream_handoff","conversation_id":"conv-12345678","turn_exchange_id":"turn-12345678","options":[{"type":"resume_sse_endpoint","topic_id":"conversation-turn-topic-12345678"},{"type":"subscribe_ws_topic","topic_id":"conversation-turn-topic-12345678"}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const handoff = extractStreamHandoff(body);
  assert.equal(handoff.conversationId, 'conv-12345678');
  assert.equal(handoff.turnExchangeId, 'turn-12345678');
  assert.deepEqual(handoff.topicIds, ['conversation-turn-topic-12345678']);
  assert.equal(handoff.resumeToken, token);
  assert.equal(streamPayloadMatches(`subscribe:${handoff.topicIds[0]}`, handoff), true);
  assert.equal(streamPayloadMatches(`https://chatgpt.com/stream?token=${token}`, handoff), true);
  assert.equal(streamPayloadMatches('unrelated-topic', handoff), false);
  assert.deepEqual(publicStreamHandoff(handoff), {
    conversationId: 'conv-12345678',
    turnExchangeId: 'turn-12345678',
    topicIds: ['conversation-turn-topic-12345678'],
    transports: ['resume_sse_endpoint', 'subscribe_ws_topic'],
    resumeTokenPresent: true,
  });
});
'''
text = read('extension/tests/network-evidence.test.mjs')
write('extension/tests/network-evidence.test.mjs', text + network_test)

replace_exact(
    'extension/tests/runtime-log.test.mjs',
    "      rawSse: body,\n",
    "      transport: 'sse',\n      rawData: body,\n",
)
replace_exact('extension/tests/runtime-log.test.mjs', "  assert.equal(capture.entries[0].rawSse, body);", "  assert.equal(capture.entries[0].rawSse, body);\n  assert.equal(capture.entries[0].transport, 'sse');")
replace_exact(
    'extension/tests/runtime-log.test.mjs',
    "  capture = appendDiagnosticSseCapture(capture, { attempt: 1, requestId: 'a', rawSse: '123456' }, 10);\n  capture = appendDiagnosticSseCapture(capture, { attempt: 2, requestId: 'b', rawSse: 'abcdef' }, 10);",
    "  capture = appendDiagnosticSseCapture(capture, { attempt: 1, requestId: 'a', transport: 'sse', rawData: '123456' }, 10);\n  capture = appendDiagnosticSseCapture(capture, { attempt: 2, requestId: 'b', transport: 'websocket', rawData: 'abcdef' }, 10);",
)
replace_exact('extension/tests/runtime-log.test.mjs', "  assert.equal(capture.omitted[0].reason, 'diagnostic_sse_size_limit');", "  assert.equal(capture.omitted[0].reason, 'diagnostic_stream_size_limit');\n  assert.equal(capture.captureScope, 'auto_verification_stream_only');")
stream_test = r'''

test('stores matched WebSocket frames under the same aggregate stream budget', () => {
  const capture = appendDiagnosticSseCapture(
    createDiagnosticSseCapture({ tabId: 9 }),
    {
      attempt: 1,
      requestId: 'ws-1',
      transport: 'websocket',
      direction: 'received',
      stage: 'downstream_websocket',
      rawData: '{"type":"message","metadata":{"model_slug":"gpt-5.6-sol"}}',
    },
    1024,
  );
  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].transport, 'websocket');
  assert.match(capture.entries[0].rawFrame, /model_slug/);
  assert.equal(capture.entries[0].rawSse, undefined);
});
'''
text = read('extension/tests/runtime-log.test.mjs')
write('extension/tests/runtime-log.test.mjs', text + stream_test)

# Static regression test: broad page buttons must never return to auto-alignment selectors.
content_safety_test = r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

test('auto alignment does not probe generic ChatGPT menu/composer/form buttons', () => {
  assert.doesNotMatch(content, /\[role="banner"\] button\[aria-haspopup\]/);
  assert.doesNotMatch(content, /header button\[aria-haspopup\]/);
  assert.doesNotMatch(content, /\[data-testid\*="composer"\] button/);
  assert.doesNotMatch(content, /'form button'/);
});

test('unknown page model/reasoning values are never force-clicked', () => {
  assert.match(content, /desiredModel && observation\.model && observation\.model !== desiredModel/);
  assert.match(content, /preferred && !changed && afterModel\.reasoning && afterModel\.reasoning !== preferred/);
});
'''
write('extension/tests/content-safety.test.mjs', content_safety_test)

# Small docs update without rewriting historical release notes.
with Path('README.md').open('a', encoding='utf-8') as handle:
    handle.write('\n\n### v0.3.7 stream handoff diagnostics\nAutomatic verification now follows ChatGPT `stream_handoff` metadata into matched downstream SSE/WebSocket traffic, shares one 10 MiB diagnostic budget across the chain, and no longer probes generic page buttons when the model/reasoning UI value is unknown. The obsolete conversation-detail GET fallback is disabled.\n')
with Path('docs/SECURITY.md').open('a', encoding='utf-8') as handle:
    handle.write('\n\n## v0.3.7 automatic-verification stream capture\nOnly the fixed automatic-verification probes may capture post-handoff SSE or WebSocket frames, and WebSocket capture begins only after an exact handoff topic/token marker matches the socket subscription. The aggregate raw stream budget remains 10 MiB. Raw handoff SSE can contain short-lived resume tokens; account cookies, Authorization headers, request/response headers, and ordinary chat bodies remain excluded.\n')
with Path('docs/USAGE.md').open('a', encoding='utf-8') as handle:
    handle.write('\n\n## v0.3.7 diagnostics\nAfter automatic verification, export diagnostics and inspect `autoVerificationStream.entries`. Entries identify `transport` (`sse` or `websocket`), direction/stage, handoff context, byte count, and the raw matched stream payload. If the page does not expose a model/reasoning selector, GPTLock does not click unknown UI controls; request locking remains network-layer based.\n')

print('GPTLock 0.3.7 patch applied')
