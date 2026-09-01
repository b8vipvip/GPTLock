import { createCoreBridgeRequest, parseCoreBridgeResponse } from './core-bridge.js';
import { ChatGptNetworkMonitor } from './network-monitor.js';
import {
  applyPrivateRequestPatches,
  buildPrivateRequestPayload,
  normalizePrivateRequestDecision,
  safeRequestEndpoint,
} from './private-request-routing.js';

const NATIVE_HOST = 'com.gptlock.core';
const REQUEST_TIMEOUT_MS = 4500;
const CAPABILITY_TTL_MS = 30_000;
const PATCH_MARKER = Symbol.for('gptlock.privateRequestRouting.v2');

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

class PrivateRequestChannel {
  constructor() {
    this.port = null;
    this.sequence = 0;
    this.pending = new Map();
    this.capabilityCache = null;
  }

  connect() {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    this.port = port;
    port.onMessage.addListener((message) => {
      const id = String(message?.id ?? '');
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      const detail = chrome.runtime.lastError?.message || 'Private request channel disconnected';
      this.port = null;
      this.capabilityCache = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(detail));
      }
      this.pending.clear();
    });
    return port;
  }

  requestRaw(message) {
    const id = String(message?.id ?? '');
    if (!id) return Promise.reject(new TypeError('private request channel message id is required'));
    const port = this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Private request channel timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  nextId(prefix = 'private') {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  async isAvailable() {
    const now = Date.now();
    if (this.capabilityCache && this.capabilityCache.expiresAt > now) {
      return this.capabilityCache.available;
    }
    try {
      const response = await this.requestRaw({ id: this.nextId('cap'), type: 'get_capabilities' });
      const available = Boolean(
        response?.ok === true
          && response?.data?.privateEngine?.available === true
          && response?.data?.privateEngine?.protocolVersion === 2,
      );
      this.capabilityCache = { available, expiresAt: now + CAPABILITY_TTL_MS };
      return available;
    } catch {
      this.capabilityCache = { available: false, expiresAt: now + Math.min(CAPABILITY_TTL_MS, 5000) };
      return false;
    }
  }

  async evaluateRequest(payload) {
    const id = this.nextId('request');
    const request = createCoreBridgeRequest(id, 'evaluate_request', payload);
    const raw = await this.requestRaw(request);
    const parsed = parseCoreBridgeResponse(raw, id);
    if (!parsed.ok) {
      this.capabilityCache = null;
      const error = new Error(parsed.error.message);
      error.code = parsed.error.code;
      throw error;
    }
    return normalizePrivateRequestDecision(parsed.data);
  }

  invalidate() {
    this.capabilityCache = null;
  }
}

const channel = new PrivateRequestChannel();

async function continueFailOpen(monitor, tabId, requestId, endpoint, decision, initialError) {
  monitor.onRewrite?.(tabId, {
    endpoint,
    changed: false,
    reason: 'private_request_continue_failed_open',
    modelBefore: decision?.modelBefore ?? null,
    modelAfter: decision?.modelAfter ?? null,
    error: errorText(initialError),
  });
  try {
    await monitor.continuePaused(tabId, requestId);
  } catch (continueError) {
    monitor.onRewrite?.(tabId, {
      endpoint,
      changed: false,
      reason: 'private_request_fail_open_continue_failed',
      error: errorText(continueError),
    });
  }
}

export function installPrivateRequestRoutingHook() {
  const prototype = ChatGptNetworkMonitor.prototype;
  if (prototype[PATCH_MARKER]) return false;
  const legacyHandlePausedRequest = prototype.handlePausedRequest;
  if (typeof legacyHandlePausedRequest !== 'function') return false;

  Object.defineProperty(prototype, PATCH_MARKER, { value: true, configurable: false });
  prototype.handlePausedRequest = async function privateHandlePausedRequest(tabId, params = {}) {
    if (!(await channel.isAvailable())) {
      return legacyHandlePausedRequest.call(this, tabId, params);
    }

    const requestId = String(params.requestId ?? '');
    const request = params.request ?? {};
    const endpoint = safeRequestEndpoint(request.url);
    let decision;
    let postData;
    try {
      postData = await this.pausedPostData(tabId, params);
      const payload = buildPrivateRequestPayload(request, postData, this.configuration());
      decision = await channel.evaluateRequest(payload);
    } catch {
      channel.invalidate();
      return legacyHandlePausedRequest.call(this, tabId, params);
    }

    if (!decision.officialConversation) {
      try {
        await this.continuePaused(tabId, requestId);
      } catch (error) {
        this.onRewrite?.(tabId, {
          endpoint,
          changed: false,
          reason: 'continue_failed',
          error: errorText(error),
        });
      }
      return;
    }

    let rewrittenPostData = null;
    if (decision.changed) {
      try {
        rewrittenPostData = applyPrivateRequestPatches(postData, decision.patches);
      } catch {
        channel.invalidate();
        return legacyHandlePausedRequest.call(this, tabId, params);
      }
    }

    try {
      await this.continuePaused(tabId, requestId, rewrittenPostData);
      this.onRewrite?.(tabId, {
        endpoint,
        changed: decision.changed,
        reason: decision.reason,
        modelBefore: decision.modelBefore,
        modelAfter: decision.modelAfter,
        transportModelBefore: decision.transportModelBefore,
        transportModelAfter: decision.transportModelAfter,
        reasoningBefore: decision.reasoningBefore,
        reasoningAfter: decision.reasoningAfter,
        reasoningFields: decision.reasoningFields,
      });
    } catch (error) {
      await continueFailOpen(this, tabId, requestId, endpoint, decision, error);
    } finally {
      rewrittenPostData = null;
      postData = null;
    }
  };
  return true;
}

installPrivateRequestRoutingHook();
