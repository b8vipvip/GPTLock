import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policy = new URL('../policy.js', import.meta.url);
const background = new URL('../background.js', import.meta.url);

test('license messages are handled only by the dedicated license listener', async () => {
  const [policySource, backgroundSource] = await Promise.all([
    readFile(policy, 'utf8'),
    readFile(background, 'utf8'),
  ]);

  const dedicatedFilter = "if (!message.type.startsWith('GPTLOCK_LICENSE_')) return false;";
  const genericIsolation = "if (message?.type?.startsWith('GPTLOCK_LICENSE_')) return false;";

  const dedicatedIndex = policySource.indexOf(dedicatedFilter);
  const isolationIndex = policySource.indexOf(genericIsolation);

  assert.ok(dedicatedIndex >= 0, 'dedicated license listener must exist');
  assert.ok(isolationIndex > dedicatedIndex, 'generic listener wrapper must skip license messages after dedicated listener registration');
  assert.match(policySource, /case 'GPTLOCK_LICENSE_ACTIVATE': return activate\(message\.code\);/);
  assert.match(backgroundSource, /Unsupported extension message:/);
});
