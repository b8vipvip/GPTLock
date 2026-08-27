import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backgroundSource = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../content.js', import.meta.url), 'utf8');

test('popup state refresh actively recollects the live ChatGPT page observation', () => {
  assert.match(backgroundSource, /await collectPageObservation\(tabId, state\)/);
  assert.match(backgroundSource, /modelEvidenceSource: observation\.modelEvidenceSource/);
  assert.match(backgroundSource, /ambiguousModel: Boolean\(observation\.ambiguousModel\)/);
  assert.match(backgroundSource, /candidates: Array\.isArray\(observation\.candidates\)/);
});

test('page reporting fingerprint includes model evidence details, not only model and reasoning', () => {
  assert.match(contentSource, /observation\.modelEvidenceSource/);
  assert.match(contentSource, /observation\.modelLabel/);
  assert.match(contentSource, /observation\.ambiguousModel/);
  assert.match(contentSource, /observation\.candidates/);
});
