import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [manifestText, budgetText, authorityText, packageText] = await Promise.all([
  readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  readFile(new URL('../context-budget.js', import.meta.url), 'utf8'),
  readFile(new URL('../private-context-budget-authority.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

test('extension loads the private context budget authority instead of the old shadow', () => {
  assert.match(manifestText, /private-context-budget-authority\.js/);
  assert.doesNotMatch(manifestText, /private-context-budget-shadow\.js/);
  assert.match(packageText, /node --check private-context-budget-authority\.js/);
  assert.doesNotMatch(packageText, /node --check private-context-budget-shadow\.js/);
});

test('legacy context guard delegates exact send-time decisions to the private authority', () => {
  assert.match(budgetText, /__GPTLOCK_PRIVATE_CONTEXT_BUDGET_AUTHORITY__/);
  assert.match(budgetText, /authority\?\.shouldGuardSend\?\.\(\)/);
  assert.match(budgetText, /authority\.evaluateForSend\(\)/);
  assert.match(budgetText, /refreshPrivateHistory/);
  assert.match(budgetText, /privateHistoryParts/);
});

test('private authority falls back to visible conversation DOM when the conversation-tree endpoint is unavailable', () => {
  assert.match(authorityText, /function domHistorySnapshot\(\)/);
  assert.match(authorityText, /data-message-author-role/);
  assert.match(authorityText, /dom-visible-fallback/);
  assert.match(authorityText, /privateHistorySnapshot\?\.\(\) \|\| domHistorySnapshot\(\)/);
  assert.match(authorityText, /source = domHistorySnapshot\(\)/);
});
