import assert from 'node:assert/strict';
import test from 'node:test';

const channelModule = await import(`../private-core-channel.js?test=${Date.now()}`);
const { PrivateCoreChannel, normalizePrivateEngineCapabilities } = channelModule;

test('capability normalization whitelists only supported compiled-engine features', () => {
  const capability = normalizePrivateEngineCapabilities({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextBudgetEvaluation: true,
        contextProfileEvaluation: true,
        contextEvaluation: true,
        privateRuleDump: true,
      },
    },
  });
  assert.equal(capability.available, true);
  assert.equal(capability.contextBudgetEvaluation, true);
  assert.equal(capability.contextProfileEvaluation, true);
  assert.equal(capability.contextEvaluation, true);
  assert.equal(Object.hasOwn(capability, 'privateRuleDump'), false);
});

test('supports requires both an executable probe and the requested feature', async () => {
  const channel = new PrivateCoreChannel();
  channel.requestRaw = async () => ({
    ok: true,
    data: {
      privateEngine: {
        available: true,
        protocolVersion: 2,
        capabilityProbe: true,
        contextEvaluation: true,
        contextBudgetEvaluation: false,
      },
    },
  });
  assert.equal(await channel.supports('contextEvaluation'), true);
  assert.equal(await channel.supports('contextBudgetEvaluation'), false);
  assert.equal(await channel.supports('unknownFeature'), false);
});
