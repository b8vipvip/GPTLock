import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../context-budget.js', import.meta.url), 'utf8');

test('successful bypass numeric learning requires private engine and has no browser formula fallback', () => {
  const start = source.indexOf('async function persistLearnedProfile');
  const end = source.indexOf('async function maybeFinalizeBypassLearning', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('successful_bypass'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /if \(!privateNumbers\)/);
  assert.doesNotMatch(block, /nextLearnedProfile|learningHeadroom|SAFETY_BUDGET_RATIO|contextWindowForModel/);
});

test('hard-limit fallback records metadata only and never derives a new numeric cap in browser', () => {
  const start = source.indexOf('async function persistHardLimitObservation');
  const end = source.indexOf('async function refreshAccountScope', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('hard_limit'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /numericDerivation: 'unavailable'/);
  assert.match(block, /hardLimitUpperBoundTokens: storedMetric\(previous\?\.hardLimitUpperBoundTokens\)/);
  assert.doesNotMatch(block, /nextHardLimitProfile|LEARNING_HEADROOM_RATIO|SAFETY_BUDGET_RATIO/);
});

test('checkpoint persistence accepts token state only after private authority overlay', () => {
  const start = source.indexOf('function publishSnapshot');
  const end = source.indexOf('function recompute', start);
  const block = source.slice(start, end);
  assert.match(block, /next\.budgetAuthority === 'private-engine'/);
});

test('hard-limit learning consumes the authority-overlaid last snapshot', () => {
  const start = source.indexOf('function recompute');
  const end = source.indexOf('function scheduleRefresh', start);
  const block = source.slice(start, end);
  assert.match(block, /publishSnapshot\(snapshotNow\(\)\)/);
  assert.match(block, /persistHardLimitObservation\(lastSnapshot/);
});
