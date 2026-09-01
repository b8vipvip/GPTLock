export const CORE_BRIDGE_PROTOCOL_VERSION = 2;

export const CORE_BRIDGE_TYPES = Object.freeze([
  'evaluate_request',
  'evaluate_response',
  'evaluate_context',
  'get_capabilities',
]);

const TYPE_SET = new Set(CORE_BRIDGE_TYPES);

export function createCoreBridgeRequest(id, type, payload = {}) {
  const requestId = String(id ?? '').trim();
  if (!requestId || requestId.length > 128) throw new TypeError('invalid core bridge request id');
  if (!TYPE_SET.has(type)) throw new TypeError('unsupported core bridge request type');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('core bridge payload must be an object');
  }
  return {
    id: requestId,
    type,
    protocolVersion: CORE_BRIDGE_PROTOCOL_VERSION,
    payload,
  };
}

export function parseCoreBridgeResponse(value, expectedId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('invalid core bridge response');
  }
  if (value.protocolVersion !== CORE_BRIDGE_PROTOCOL_VERSION) {
    throw new Error('unsupported core bridge protocol version');
  }
  const id = String(value.id ?? '');
  if (expectedId !== null && id !== String(expectedId)) {
    throw new Error('core bridge response id mismatch');
  }
  if (value.ok === true) return { ok: true, id, data: value.data ?? {} };
  if (value.ok === false) {
    return {
      ok: false,
      id,
      error: {
        code: String(value.error?.code || 'core_error'),
        message: String(value.error?.message || 'Core request failed'),
      },
    };
  }
  throw new TypeError('core bridge response is missing ok');
}
