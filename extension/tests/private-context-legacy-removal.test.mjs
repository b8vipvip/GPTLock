import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const bridge = await readFile(new URL('../private-context-bridge.js', import.meta.url), 'utf8');
const channel = await readFile(new URL('../private-core-channel.js', import.meta.url), 'utf8');

test('manifest loads only the authoritative context budget renderer', () => {
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.equal(scripts.includes('private-context-budget-authority.js'), true);
  assert.equal(scripts.includes('context-budget.js'), true);
  assert.equal(scripts.includes('private-context-indicator.js'), false);
});

test('legacy coarse remaining message and capability are absent from browser runtime', () => {
  assert.doesNotMatch(bridge, /GPTLOCK_PRIVATE_CONTEXT_EVALUATE/);
  assert.doesNotMatch(bridge, /sanitizePrivateContextPayload|normalizePrivateContextResult/);
  assert.doesNotMatch(channel, /['\"]contextEvaluation['\"]/);
});
