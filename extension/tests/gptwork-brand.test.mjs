import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

test('GPTWork is canonical product metadata', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.name, 'GPTWork');
  assert.equal(manifest.action.default_title, 'GPTWork');
  assert.equal(JSON.parse(read('extension/package.json')).name, 'gptwork-extension');
  assert.match(read('native-core/Cargo.toml'), /name = "gptwork-core"/);
  assert.match(read('private-engine/Cargo.toml'), /name = "gptwork-private-engine"/);
  assert.match(read('packaging/windows/GPTWork.iss'), /OutputBaseFilename=GPTWorkSetup-x64/);
});

test('user-facing HTML/CSS no longer exposes legacy product brand', () => {
  for (const rootName of ['extension', 'license-server/public']) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(?:html|css)$/.test(entry.name)) {
          const source = fs.readFileSync(file, 'utf8').replaceAll('https://github.com/b8vipvip/GPTLock', 'https://github.com/b8vipvip/REPOSITORY');
          assert.doesNotMatch(source, /GPTLock|(?<![A-Za-z0-9_])GPTLOCK(?![A-Za-z0-9_-])/, path.relative(repo, file));
        }
      }
    };
    walk(path.join(repo, rootName));
  }
});

test('compatibility contracts remain available during rename transition', () => {
  assert.match(read('extension/update-manager.js'), /LEGACY_WINDOWS_INSTALLER_NAME = 'GPTLockSetup-x64\.exe'/);
  assert.match(read('extension/manifest.json'), /https:\/\/gptlock\.mv3\.cn\/\*/);
  assert.match(read('native-core/src/lib.rs'), /com\.gptlock\.core/);
});
