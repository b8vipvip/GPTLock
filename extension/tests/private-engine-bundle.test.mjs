import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyPrivateEngineBundle } from '../../scripts/verify-private-engine-bundle.mjs';

async function fixture(platform = 'linux') {
  const directory = await mkdtemp(join(tmpdir(), 'gptlock-private-engine-'));
  const fileName = platform === 'windows' ? 'gptlock-engine.exe' : 'gptlock-engine';
  const binaryPath = join(directory, fileName);
  const bytes = Buffer.from('compiled-private-engine-fixture');
  await writeFile(binaryPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifestPath = join(directory, 'bundle.json');
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    protocolVersion: 2,
    productVersion: '0.5.29',
    engineVersion: '0.1.0',
    platform,
    architecture: 'x64',
    fileName,
    sha256,
  }));
  return { manifestPath, binaryPath };
}

test('private engine bundle verifier accepts a matching compiled artifact', async () => {
  const files = await fixture('linux');
  const result = await verifyPrivateEngineBundle({
    ...files,
    productVersion: '0.5.29',
    platform: 'linux',
  });
  assert.equal(result.protocolVersion, 2);
  assert.equal(result.productVersion, '0.5.29');
  assert.equal(result.fileName, 'gptlock-engine');
  assert.ok(result.size > 0);
});

test('private engine bundle verifier rejects product or digest mismatches', async () => {
  const files = await fixture('windows');
  await assert.rejects(
    verifyPrivateEngineBundle({ ...files, productVersion: '0.5.30', platform: 'windows' }),
    /does not match/,
  );
  await writeFile(files.binaryPath, 'tampered');
  await assert.rejects(
    verifyPrivateEngineBundle({ ...files, productVersion: '0.5.29', platform: 'windows' }),
    /sha256 mismatch/,
  );
});
