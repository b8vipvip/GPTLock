import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGuard } from '../guard.js';
import { DEFAULT_POLICY, DEFAULT_SETTINGS } from '../policy.js';

function state(patch = {}) {
  return {
    phase: 'initial',
    core: { connected: true, error: null },
    monitor: { attached: true, error: null },
    pageObservation: { model: 'gpt-5.6-sol', reasoning: 'high' },
    probeUsed: false,
    probeArmed: false,
    lastVerification: null,
    lastError: null,
    ...patch,
  };
}

test('allows exactly the configured initial probe precondition', () => {
  const guard = evaluateGuard({ state: state(), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'probe');
});

test('blocks a probe when the page selection is explicitly disallowed', () => {
  const guard = evaluateGuard({
    state: state({ pageObservation: { model: 'gpt-5.5', reasoning: 'high' } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, false);
  assert.equal(guard.status, 'preflight_mismatch');
  assert.equal(guard.reason, 'page_selection_not_allowed');
});

test('reports missing page fields as unknown instead of an explicit mismatch', () => {
  const guard = evaluateGuard({
    state: state({ pageObservation: { model: null, reasoning: null } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, false);
  assert.equal(guard.status, 'preflight_unknown');
  assert.equal(guard.reason, 'page_selection_missing');
});

test('blocks while waiting and after unverified response metadata', () => {
  for (const phase of ['waiting', 'unverified', 'mismatch', 'error']) {
    const guard = evaluateGuard({ state: state({ phase }), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
    assert.equal(guard.canSend, false, phase);
  }
});

test('allows one send from a verified state', () => {
  const guard = evaluateGuard({ state: state({ phase: 'verified' }), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'verified');
});

test('manual first-request mode requires an armed probe', () => {
  const settings = { ...DEFAULT_SETTINGS, firstRequestMode: 'block' };
  assert.equal(evaluateGuard({ state: state(), policy: DEFAULT_POLICY, settings }).canSend, false);
  assert.equal(evaluateGuard({ state: state({ probeArmed: true }), policy: DEFAULT_POLICY, settings }).canSend, true);
});

test('manual probe can recover from missing DOM fields but never overrides an explicit mismatch', () => {
  const missing = state({ probeArmed: true, pageObservation: { model: 'gpt-5.6-sol', reasoning: null } });
  assert.equal(evaluateGuard({ state: missing, policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS }).canSend, true);
  const mismatch = state({ probeArmed: true, pageObservation: { model: 'gpt-5.5', reasoning: null } });
  assert.equal(evaluateGuard({ state: mismatch, policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS }).canSend, false);
});

test('warning mode never blocks but still reports monitor state', () => {
  const policy = { ...DEFAULT_POLICY, strictMode: false };
  const guard = evaluateGuard({
    state: state({ monitor: { attached: false, error: 'detached' } }),
    policy,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.status, 'monitor_offline');
});

test('strict mode blocks when the Native Core is offline', () => {
  const guard = evaluateGuard({
    state: state({ core: { connected: false, error: 'host missing' } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, false);
  assert.equal(guard.status, 'core_offline');
});
