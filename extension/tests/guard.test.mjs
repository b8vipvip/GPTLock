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

test('normal initial state is request-lock ready without a probe gate', () => {
  const guard = evaluateGuard({ state: state(), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'locked');
  assert.equal(guard.status, 'lock_ready');
});

test('page selection mismatch is warning-only because the formal request is locked later', () => {
  const guard = evaluateGuard({
    state: state({ pageObservation: { model: 'gpt-5.5', reasoning: 'high' } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'warning');
  assert.equal(guard.status, 'preflight_mismatch');
  assert.equal(guard.reason, 'page_selection_not_allowed');
});

test('missing page fields keep the network request lock ready', () => {
  const guard = evaluateGuard({
    state: state({ pageObservation: { model: null, reasoning: null } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'locked');
  assert.equal(guard.status, 'lock_ready');
  assert.equal(guard.reason, 'page_selection_missing');
});

test('waiting, unverified and verification errors do not interrupt chat', () => {
  for (const phase of ['waiting', 'unverified', 'error']) {
    const guard = evaluateGuard({ state: state({ phase }), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
    assert.equal(guard.canSend, true, phase);
  }
});

test('strict mode blocks only a confirmed response model mismatch', () => {
  const guard = evaluateGuard({
    state: state({
      phase: 'mismatch',
      lastVerification: { reason: 'model_not_allowed', reasons: ['model_not_allowed', 'reasoning_missing'] },
    }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, false);
  assert.equal(guard.allowKind, 'blocked');
  assert.equal(guard.status, 'mismatch');
  assert.equal(guard.reason, 'model_not_allowed');
});

test('reasoning-only mismatch remains warning-only even in strict mode', () => {
  const guard = evaluateGuard({
    state: state({
      phase: 'mismatch',
      lastVerification: { reason: 'reasoning_not_allowed', reasons: ['reasoning_not_allowed'] },
    }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'warning');
});

test('verified response remains sendable', () => {
  const guard = evaluateGuard({ state: state({ phase: 'verified' }), policy: DEFAULT_POLICY, settings: DEFAULT_SETTINGS });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'locked');
  assert.equal(guard.status, 'verified');
});

test('monitor or Native Core outage warns but does not block normal chat', () => {
  const monitor = evaluateGuard({
    state: state({ monitor: { attached: false, error: 'detached' } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(monitor.canSend, true);
  assert.equal(monitor.status, 'monitor_offline');

  const core = evaluateGuard({
    state: state({ core: { connected: false, error: 'host missing' } }),
    policy: DEFAULT_POLICY,
    settings: DEFAULT_SETTINGS,
  });
  assert.equal(core.canSend, true);
  assert.equal(core.status, 'core_offline');
});

test('response verification can be disabled while request locking remains active', () => {
  const guard = evaluateGuard({
    state: state(),
    policy: DEFAULT_POLICY,
    settings: { ...DEFAULT_SETTINGS, networkVerificationEnabled: false },
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'locked');
  assert.equal(guard.status, 'verification_disabled');
});

test('global disable bypasses enforcement and reports an explicit disabled state', () => {
  const guard = evaluateGuard({
    state: state({ core: { connected: false, error: 'host missing' } }),
    policy: DEFAULT_POLICY,
    settings: { ...DEFAULT_SETTINGS, enabled: false },
  });
  assert.equal(guard.canSend, true);
  assert.equal(guard.allowKind, 'disabled');
  assert.equal(guard.status, 'disabled');
  assert.equal(guard.reason, 'gptlock_disabled');
});
