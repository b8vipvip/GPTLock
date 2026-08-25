import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyNativeError, nativeHelp } from '../native-status.js';

test('recognizes the Chromium missing-host error shown to extension-only installs', () => {
  const code = classifyNativeError('Specified native messaging host not found.');
  assert.equal(code, 'host_not_installed');
  assert.match(nativeHelp(code).detail, /只加载浏览器扩展还不够/);
});

test('distinguishes origin and startup failures from a missing install', () => {
  assert.equal(classifyNativeError('Access to the specified native messaging host is forbidden.'), 'origin_not_allowed');
  assert.equal(classifyNativeError('Failed to start native messaging host.'), 'host_start_failed');
  const protocolCode = classifyNativeError('Error when communicating with the native messaging host.');
  assert.equal(protocolCode, 'protocol_error');
  assert.match(nativeHelp(protocolCode).detail, /协议握手失败/);
  assert.equal(classifyNativeError('Native host disconnected'), 'connection_failed');
  assert.equal(classifyNativeError(null), null);
});
