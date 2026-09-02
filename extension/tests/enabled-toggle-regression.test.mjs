import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authGate = fs.readFileSync(new URL('../auth-gate.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../enabled-toggle-controller.js', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../popup-v0513.html', import.meta.url), 'utf8');

test('account gate no longer writes the enable switch disabled state', () => {
  assert.doesNotMatch(authGate, /el\.enabled\.disabled\s*=/);
  assert.match(authGate, /gptlock-entitlement-state/);
});

test('enable switch has a single-owner controller with timeout and rollback', () => {
  assert.match(controller, /TOGGLE_TIMEOUT_MS/);
  assert.match(controller, /stopImmediatePropagation\(\)/);
  assert.match(controller, /toggle\.checked = previous/);
  assert.match(controller, /\.finally\(\(\) => \{/);
  assert.match(controller, /syncAvailability\(\)/);
});

test('current popup loads the stable enable toggle controller after popup.js', () => {
  const legacyIndex = popup.indexOf('src="popup.js"');
  const controllerIndex = popup.indexOf('src="enabled-toggle-controller.js"');
  assert.ok(legacyIndex >= 0);
  assert.ok(controllerIndex > legacyIndex);
});
