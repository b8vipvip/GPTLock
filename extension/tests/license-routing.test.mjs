import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policy = new URL('../policy.js', import.meta.url);
const background = new URL('../background.js', import.meta.url);

test('legacy license UI is removed while background keeps a stale-popup migration bridge', async () => {
  const [policySource, backgroundSource] = await Promise.all([
    readFile(policy, 'utf8'),
    readFile(background, 'utf8'),
  ]);

  assert.doesNotMatch(policySource, /GPTLOCK_LICENSE_/);
  assert.doesNotMatch(policySource, /gptlockLicense|license heartbeat|License required/i);
  assert.match(backgroundSource, /GPTLOCK_ACCOUNT_LOGIN/);
  assert.match(backgroundSource, /GPTLOCK-LICENSE-GET/);
  assert.match(backgroundSource, /LICENSE_UI_STALE/);
  assert.match(backgroundSource, /GPTLOCK_ACCOUNT_LOGOUT/);
  assert.match(backgroundSource, /GPTLOCK_ACCOUNT_REFRESH/);
  assert.match(backgroundSource, /accountAllowsState/);
});
