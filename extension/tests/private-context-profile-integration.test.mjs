import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../context-budget.js', import.meta.url), 'utf8');

test('successful bypass learning is private-first with legacy compatibility fallback', () => {
  const start = source.indexOf('async function persistLearnedProfile');
  const end = source.indexOf('async function maybeFinalizeBypassLearning', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('successful_bypass'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /nextLearnedProfile\(/);
  assert.ok(block.indexOf("evaluatePrivateContextProfile('successful_bypass'") < block.indexOf('nextLearnedProfile('));
});

test('hard-limit learning is private-first with legacy compatibility fallback', () => {
  const start = source.indexOf('async function persistHardLimitObservation');
  const end = source.indexOf('async function refreshAccountScope', start);
  const block = source.slice(start, end);
  assert.match(block, /evaluatePrivateContextProfile\('hard_limit'/);
  assert.match(block, /numericDerivation: 'private-engine'/);
  assert.match(block, /nextHardLimitProfile\(/);
  assert.ok(block.indexOf("evaluatePrivateContextProfile('hard_limit'") < block.indexOf('nextHardLimitProfile('));
});
