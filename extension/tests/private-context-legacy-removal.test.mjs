import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const bridge = await readFile(new URL('../private-context-bridge.js', import.meta.url), 'utf8');
const channel = await readFile(new URL('../private-core-channel.js', import.meta.url), 'utf8');
const chatLengthView = await readFile(new URL('../chat-length-remaining-indicator.js', import.meta.url), 'utf8');

test('manifest loads private authority plus an algorithm-free chat length remaining view', () => {
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.equal(scripts.includes('private-context-budget-authority.js'), true);
  assert.equal(scripts.includes('context-budget.js'), true);
  assert.equal(scripts.includes('chat-length-remaining-indicator.js'), true);
  assert.equal(scripts.includes('private-context-indicator.js'), false);
  assert.match(chatLengthView, /聊天长度剩余/);
  assert.doesNotMatch(chatLengthView, /safeLimitTokens|nominalLimitTokens|remainingTokens\s*\/|tokenWeight|mediaWeight/);
});

test('legacy coarse remaining message and capability are absent from browser runtime', () => {
  assert.doesNotMatch(bridge, /GPTLOCK_PRIVATE_CONTEXT_EVALUATE/);
  assert.doesNotMatch(bridge, /sanitizePrivateContextPayload|normalizePrivateContextResult/);
  assert.doesNotMatch(channel, /['\"]contextEvaluation['\"]/);
});
