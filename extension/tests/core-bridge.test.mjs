import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORE_BRIDGE_PROTOCOL_VERSION,
  CORE_BRIDGE_TYPES,
  createCoreBridgeRequest,
  parseCoreBridgeResponse,
} from '../core-bridge.js';

test('core bridge exposes only the minimal versioned public operations', () => {
  assert.equal(CORE_BRIDGE_PROTOCOL_VERSION, 2);
  assert.deepEqual(CORE_BRIDGE_TYPES, [
    'evaluate_request',
    'evaluate_response',
    'evaluate_context',
    'get_capabilities',
  ]);
});

test('core bridge request helper rejects arbitrary operation names', () => {
  const request = createCoreBridgeRequest('req-1', 'evaluate_request', { sample: true });
  assert.equal(request.protocolVersion, 2);
  assert.equal(request.id, 'req-1');
  assert.throws(() => createCoreBridgeRequest('req-2', 'dump_private_rules', {}));
});

test('core bridge response parser enforces version and request correlation', () => {
  assert.deepEqual(
    parseCoreBridgeResponse({ id: 'req-1', ok: true, protocolVersion: 2, data: { decision: 'ok' } }, 'req-1'),
    { ok: true, id: 'req-1', data: { decision: 'ok' } },
  );
  assert.throws(() => parseCoreBridgeResponse({ id: 'wrong', ok: true, protocolVersion: 2, data: {} }, 'req-1'));
  assert.throws(() => parseCoreBridgeResponse({ id: 'req-1', ok: true, protocolVersion: 1, data: {} }, 'req-1'));
});
