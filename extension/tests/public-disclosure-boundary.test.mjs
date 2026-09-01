import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const publicDocs = [
  'README.md',
  'PRIVATE_CORE_BOUNDARY.md',
  'docs/ACCOUNT_SYSTEM.md',
  'docs/ARCHITECTURE.md',
  'docs/INSTALL.md',
  'docs/NATIVE_MESSAGING.md',
  'docs/SECURITY.md',
  'docs/UPDATE.md',
  'docs/USAGE.md',
  'docs/changelog-v0.4.6.md',
  'extension/README.md',
  'native-core/README.md',
];

const implementationMarkers = [
  /\/backend-api\/conversation/i,
  /\/backend-api\/f\/conversation/i,
  /Fetch\.continueRequest/i,
  /Network\.getResponseBody/i,
  /resolved_model_slug/i,
  /served_model_slug/i,
  /gpt-5\.6-sol-wm/i,
  /network_response_metadata/i,
  /conversation_response_metadata/i,
  /stream_handoff/i,
  /encoded_item/i,
  /modelCandidateCount/i,
  /reasoningCandidateCount/i,
];

test('public documentation does not publish implementation-sensitive markers', async () => {
  for (const path of publicDocs) {
    const text = await readFile(new URL(path, root), 'utf8');
    for (const marker of implementationMarkers) {
      assert.doesNotMatch(text, marker, `${path} exposes internal marker ${marker}`);
    }
  }
});

test('public repository declares the split-source migration boundary', async () => {
  const policy = await readFile(new URL('.github/REPOSITORY_POLICY.md', root), 'utf8');
  const boundary = await readFile(new URL('PRIVATE_CORE_BOUNDARY.md', root), 'utf8');
  const contract = JSON.parse(await readFile(new URL('contracts/core-bridge.schema.json', root), 'utf8'));

  assert.match(policy, /legacy frozen baseline/i);
  assert.match(boundary, /split-source/i);
  assert.equal(contract.$defs.request.properties.protocolVersion.const, 2);
  assert.deepEqual(contract.$defs.request.properties.type.enum, [
    'evaluate_request',
    'evaluate_response',
    'evaluate_context',
    'get_capabilities',
  ]);
});
