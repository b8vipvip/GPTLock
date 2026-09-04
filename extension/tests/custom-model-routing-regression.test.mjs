import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  normalizeConcreteModelId,
  normalizeModelId,
  normalizePolicy,
} from '../policy.js';

const optionsHtml = fs.readFileSync(new URL('../settings-v0521.html', import.meta.url), 'utf8');
const optionsJs = fs.readFileSync(new URL('../options.js', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../model-catalog.js', import.meta.url), 'utf8');
const catalogOptions = fs.readFileSync(new URL('../model-catalog-options.js', import.meta.url), 'utf8');
const autoLock = fs.readFileSync(new URL('../model-auto-lock.js', import.meta.url), 'utf8');

test('auto remains observable as request metadata but is never a concrete lock target', () => {
  assert.equal(normalizeModelId('auto'), 'auto');
  assert.equal(normalizeConcreteModelId('auto'), null);
  assert.equal(normalizeConcreteModelId('gpt-5.6-luna'), 'gpt-5.6-luna');

  const policy = normalizePolicy({
    lockedModels: ['auto', 'gpt-5.6-luna'],
    allowedReasoningLevels: ['high'],
    strictMode: true,
  });
  assert.deepEqual(policy.lockedModels, ['gpt-5.6-luna']);

  const fallback = normalizePolicy({
    lockedModels: ['auto'],
    allowedReasoningLevels: ['high'],
    strictMode: true,
  });
  assert.deepEqual(fallback.lockedModels, ['gpt-5.6-sol']);
});

test('settings expose a dedicated custom model save action', () => {
  assert.match(optionsHtml, /id="saveCustomModels"/);
  assert.match(optionsHtml, /添加并保存/);
  assert.match(optionsHtml, /auto<\/code> 是 ChatGPT 自动路由标识/);
  assert.match(optionsJs, /async function saveCustomModels\(\)/);
  assert.match(optionsJs, /normalizeConcreteModelId/);
  assert.match(optionsJs, /自动路由标识，不是具体模型/);
});

test('model discovery schema v3 removes routing aliases before persistence or auto-lock', () => {
  assert.match(catalog, /DISCOVERY_SCHEMA_VERSION = 3/);
  assert.match(catalog, /NON_CONCRETE_MODEL_IDS = new Set\(\['auto'\]\)/);
  assert.match(catalog, /const model = normalizeConcreteModelId\(value\)/);
  assert.match(catalog, /stored\[STORAGE_KEY\]\.map\(normalizeConcreteModelId\)/);

  assert.match(catalogOptions, /DISCOVERY_SCHEMA_VERSION = 3/);
  assert.match(catalogOptions, /NON_CONCRETE_MODEL_IDS = new Set\(\['auto'\]\)/);
  assert.match(catalogOptions, /\.map\(normalizeConcreteModelId\)/);

  assert.match(autoLock, /NON_CONCRETE_MODEL_IDS = new Set\(\['auto'\]\)/);
  assert.match(autoLock, /\.map\(normalizeConcreteModelId\)/);
});
