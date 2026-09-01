import { createCoreBridgeRequest, parseCoreBridgeResponse } from './core-bridge.js';

const NATIVE_HOST = 'com.gptlock.core';
const REQUEST_TIMEOUT_MS = 4500;
const CAPABILITY_TTL_MS = 30_000;

export class PrivateCoreChannel {
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
      const detail = chrome.runtime.lastError?.message || 'Private core channel disconnected';
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

  nextId(prefix = 'private') {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  requestRaw(message) {
    const id = String(message?.id ?? '');
    if (!id) return Promise.reject(new TypeError('private core channel message id is required'));
    const port = this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Private core channel timed out'));
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

  async request(type, payload, prefix = 'private') {
    const id = this.nextId(prefix);
    const message = createCoreBridgeRequest(id, type, payload);
    const raw = await this.requestRaw(message);
    const parsed = parseCoreBridgeResponse(raw, id);
    if (!parsed.ok) {
      this.capabilityCache = null;
      const error = new Error(parsed.error.message);
      error.code = parsed.error.code;
      throw error;
    }
    return parsed.data;
  }

  invalidate() {
    this.capabilityCache = null;
  }
}

export const privateCoreChannel = new PrivateCoreChannel();
