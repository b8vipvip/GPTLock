import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function extensionIdFromKey(base64Key) {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest().subarray(0, 16);
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join('');
}

test('manifest public key matches the stable packaging extension ID', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const packagedId = (await readFile(new URL('../../packaging/EXTENSION_ID', import.meta.url), 'utf8')).trim();
  assert.equal(extensionIdFromKey(manifest.key), packagedId);
  assert.match(packagedId, /^[a-p]{32}$/);
});
