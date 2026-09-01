#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`);
    output[key] = value;
    index += 1;
  }
  return output;
}

function normalizeProductVersion(value) {
  const version = String(value || '').trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid product version: ${version || '<empty>'}`);
  }
  return version;
}

function expectedFileName(platform) {
  if (platform === 'linux') return 'gptlock-engine';
  if (platform === 'windows') return 'gptlock-engine.exe';
  fail(`unsupported platform: ${platform}`);
}

export async function verifyPrivateEngineBundle({
  manifestPath,
  binaryPath,
  productVersion,
  platform,
  architecture = 'x64',
}) {
  if (!manifestPath || !binaryPath) fail('manifestPath and binaryPath are required');
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  const expectedVersion = normalizeProductVersion(productVersion);
  if (manifest.schemaVersion !== 1) fail('private engine bundle schemaVersion must be 1');
  if (manifest.protocolVersion !== 2) fail('private engine protocolVersion must be 2');
  if (manifest.productVersion !== expectedVersion) {
    fail(`private engine productVersion ${manifest.productVersion} does not match ${expectedVersion}`);
  }
  if (manifest.platform !== platform) fail(`private engine platform ${manifest.platform} does not match ${platform}`);
  if (manifest.architecture !== architecture) {
    fail(`private engine architecture ${manifest.architecture} does not match ${architecture}`);
  }
  const fileName = expectedFileName(platform);
  if (manifest.fileName !== fileName) fail(`private engine fileName must be ${fileName}`);
  if (basename(binaryPath) !== fileName) fail(`binary path must end with ${fileName}`);
  if (!/^[0-9a-f]{64}$/.test(String(manifest.sha256 || ''))) fail('private engine sha256 is invalid');
  if (typeof manifest.engineVersion !== 'string' || !manifest.engineVersion.trim() || manifest.engineVersion.length > 64) {
    fail('private engine engineVersion is invalid');
  }

  const metadata = await stat(resolve(binaryPath));
  if (!metadata.isFile() || metadata.size <= 0) fail('private engine binary is empty or missing');
  const digest = createHash('sha256').update(await readFile(resolve(binaryPath))).digest('hex');
  if (digest !== manifest.sha256) fail(`private engine sha256 mismatch: expected ${manifest.sha256}, got ${digest}`);

  return {
    schemaVersion: 1,
    protocolVersion: 2,
    productVersion: expectedVersion,
    engineVersion: manifest.engineVersion,
    platform,
    architecture,
    fileName,
    sha256: digest,
    size: metadata.size,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyPrivateEngineBundle({
    manifestPath: args.manifest,
    binaryPath: args.binary,
    productVersion: args.version,
    platform: args.platform,
    architecture: args.architecture || 'x64',
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
