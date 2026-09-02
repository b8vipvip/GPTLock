import assert from 'node:assert/strict';
import test from 'node:test';

await import(`../model-status-history.js?test=${Date.now()}`);
const history = globalThis.__GPTLOCK_MODEL_STATUS_HISTORY__;

test('trusted request and response survive a new chat without pretending to be current evidence', () => {
  const previous = history.mergeTrustedEvidence(null, {
    updatedAt: '2026-09-02T03:00:02.000Z',
    lastRequest: {
      model: 'gpt-5.6-sol-wm',
      capturedAt: '2026-09-02T03:00:00.000Z',
    },
    lastVerification: {
      model: 'gpt-5.6-sol',
      evidenceSource: 'network_response_metadata',
      verifiedAt: '2026-09-02T03:00:02.000Z',
      reasons: [],
      verdict: 'verified',
    },
  }, '2026-09-02T03:00:02.000Z');

  const selected = history.selectStatus({
    state: { contextKey: 'page:/' },
    history: previous,
    policy: { lockedModels: ['gpt-5.6-sol'] },
    nowMs: Date.parse('2026-09-02T03:05:00.000Z'),
  });

  assert.equal(selected.request.id, 'gpt-5.6-sol');
  assert.equal(selected.request.current, false);
  assert.equal(selected.request.historical, true);
  assert.equal(selected.response.id, 'gpt-5.6-sol');
  assert.equal(selected.response.current, false);
  assert.equal(selected.response.historical, true);
  assert.equal(selected.response.confirmed, true);
});

test('a new current request immediately replaces historical request and suppresses old response', () => {
  const trusted = {
    schemaVersion: 1,
    request: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:00:00.000Z' },
    response: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:00:02.000Z', confirmed: true },
  };
  const selected = history.selectStatus({
    state: {
      lastRequest: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:10:00.000Z' },
      lastVerification: null,
    },
    history: trusted,
    policy: { lockedModels: ['gpt-5.6-sol'] },
    nowMs: Date.parse('2026-09-02T03:10:01.000Z'),
  });
  assert.equal(selected.request.current, true);
  assert.equal(selected.response.id, null);
  assert.equal(selected.response.historical, false);
});

test('automatic verification can seed trusted model evidence', () => {
  const trusted = history.mergeTrustedEvidence(null, {
    updatedAt: '2026-09-02T03:00:02.000Z',
    autoVerification: {
      completedAt: '2026-09-02T03:00:02.000Z',
      outcome: 'model_verified_reasoning_unconfirmed',
      requestLockConfirmed: true,
      requestModel: 'gpt-5.6-sol',
      responseModel: 'gpt-5.6-sol',
      evidenceSource: 'network_response_metadata',
    },
  });
  assert.equal(trusted.request.model, 'gpt-5.6-sol');
  assert.equal(trusted.response.model, 'gpt-5.6-sol');
  assert.equal(trusted.response.confirmed, true);
});

test('historical evidence is hidden after the lock policy changes to another model', () => {
  const selected = history.selectStatus({
    state: {},
    history: {
      schemaVersion: 1,
      request: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:00:00.000Z' },
      response: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:00:02.000Z', confirmed: true },
    },
    policy: { lockedModels: ['gpt-5.5'] },
    nowMs: Date.parse('2026-09-02T03:05:00.000Z'),
  });
  assert.equal(selected.request.id, null);
  assert.equal(selected.response.id, null);
});

test('repeated delivery of identical evidence does not churn the persisted history timestamp', () => {
  const state = {
    lastRequest: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:00:00.000Z' },
    lastVerification: {
      model: 'gpt-5.6-sol',
      evidenceSource: 'network_response_metadata',
      verifiedAt: '2026-09-02T03:00:02.000Z',
      reasons: [],
    },
  };
  const first = history.mergeTrustedEvidence(null, state, '2026-09-02T03:00:03.000Z');
  const second = history.mergeTrustedEvidence(first, state, '2026-09-02T03:05:00.000Z');
  assert.deepEqual(second, first);
});

test('an older tab state cannot overwrite newer trusted evidence from another window', () => {
  const newer = history.mergeTrustedEvidence(null, {
    lastRequest: { model: 'gpt-5.6-sol', capturedAt: '2026-09-02T03:10:00.000Z' },
    lastVerification: {
      model: 'gpt-5.6-sol',
      evidenceSource: 'network_response_metadata',
      verifiedAt: '2026-09-02T03:10:02.000Z',
      reasons: [],
    },
  }, '2026-09-02T03:10:03.000Z');

  const merged = history.mergeTrustedEvidence(newer, {
    lastRequest: { model: 'gpt-5.5', capturedAt: '2026-09-02T03:00:00.000Z' },
    lastVerification: {
      model: 'gpt-5.5',
      evidenceSource: 'network_response_metadata',
      verifiedAt: '2026-09-02T03:00:02.000Z',
      reasons: [],
    },
  }, '2026-09-02T03:20:00.000Z');

  assert.equal(merged.request.model, 'gpt-5.6-sol');
  assert.equal(merged.response.model, 'gpt-5.6-sol');
  assert.equal(merged.updatedAt, newer.updatedAt);
});
