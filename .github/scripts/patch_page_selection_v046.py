from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'extension/content.js',
    "    const fingerprint = JSON.stringify([observation.model, observation.reasoning]);",
    "    const fingerprint = JSON.stringify([\n      observation.model,\n      observation.reasoning,\n      observation.modelEvidenceSource,\n      observation.reasoningEvidenceSource,\n      observation.modelLabel,\n      observation.reasoningLabel,\n      observation.ambiguousModel,\n      observation.candidates,\n    ]);",
)

replace_once(
    'extension/content.js',
    "        ambiguousModel: Boolean(validated.ambiguous),\n        capturedAt: new Date().toISOString(),",
    "        ambiguousModel: Boolean(validated.ambiguous),\n        candidates: Array.isArray(validated.candidates) ? validated.candidates.slice(0, 8) : [],\n        capturedAt: new Date().toISOString(),",
)

replace_once(
    'extension/content.js',
    "      reasoningEvidenceSource: 'legacy-fallback',\n      capturedAt: new Date().toISOString(),",
    "      reasoningEvidenceSource: 'legacy-fallback',\n      ambiguousModel: false,\n      candidates: model ? [model] : [],\n      capturedAt: new Date().toISOString(),",
)

old_collect = """    if (response?.observation) {
      state.pageObservation = {
        model: response.observation.model ?? null,
        reasoning: response.observation.reasoning ?? null,
        capturedAt: response.observation.capturedAt ?? new Date().toISOString(),
        evidenceSource: 'page_dom',
      };
      return { collected: true, error: null };
    }"""
new_collect = """    if (response?.observation) {
      const observation = response.observation;
      state.pageObservation = {
        model: observation.model ?? null,
        reasoning: observation.reasoning ?? null,
        capturedAt: observation.capturedAt ?? new Date().toISOString(),
        evidenceSource: 'page_dom',
        modelEvidenceSource: observation.modelEvidenceSource ?? 'none',
        reasoningEvidenceSource: observation.reasoningEvidenceSource ?? 'none',
        modelLabel: observation.modelLabel ?? '',
        reasoningLabel: observation.reasoningLabel ?? '',
        ambiguousModel: Boolean(observation.ambiguousModel),
        candidates: Array.isArray(observation.candidates) ? observation.candidates.slice(0, 8) : [],
      };
      return { collected: true, error: null };
    }"""
replace_once('extension/background.js', old_collect, new_collect)

old_get = """        const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
        return {
          policy: currentPolicy,
          settings: currentSettings,
          nativeStatus: nativeStatus ?? { connected: false },
          tabState: tabId === null ? null : publicTabState(tabStates.get(tabId)),
          extensionVersion: chrome.runtime.getManifest().version,
        };"""
new_get = """        const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
        const state = tabId === null ? null : tabStates.get(tabId);
        if (tabId !== null && state && isChatGptUrl(state.url)) {
          await collectPageObservation(tabId, state);
        }
        return {
          policy: currentPolicy,
          settings: currentSettings,
          nativeStatus: nativeStatus ?? { connected: false },
          tabState: state ? publicTabState(state) : null,
          extensionVersion: chrome.runtime.getManifest().version,
        };"""
replace_once('extension/background.js', old_get, new_get)

old_msg = """        state.pageObservation = {
          model: message.observation?.model ?? null,
          reasoning: message.observation?.reasoning ?? null,
          capturedAt: message.observation?.capturedAt ?? new Date().toISOString(),
          evidenceSource: 'page_dom',
        };"""
new_msg = """        state.pageObservation = {
          model: message.observation?.model ?? null,
          reasoning: message.observation?.reasoning ?? null,
          capturedAt: message.observation?.capturedAt ?? new Date().toISOString(),
          evidenceSource: 'page_dom',
          modelEvidenceSource: message.observation?.modelEvidenceSource ?? 'none',
          reasoningEvidenceSource: message.observation?.reasoningEvidenceSource ?? 'none',
          modelLabel: message.observation?.modelLabel ?? '',
          reasoningLabel: message.observation?.reasoningLabel ?? '',
          ambiguousModel: Boolean(message.observation?.ambiguousModel),
          candidates: Array.isArray(message.observation?.candidates) ? message.observation.candidates.slice(0, 8) : [],
        };"""
replace_once('extension/background.js', old_msg, new_msg)

test_path = Path('extension/tests/page-model-evidence.test.mjs')
test_text = test_path.read_text(encoding='utf-8')
anchor = "  assert.match(adapterSource, /data-model-id/);\n"
addition = "  assert.match(adapterSource, /function evidenceValues/);\n  assert.match(adapterSource, /element\\.innerText/);\n  assert.match(adapterSource, /element\\.textContent/);\n  assert.match(adapterSource, /generic aria-label/);\n"
if addition not in test_text:
    if anchor not in test_text:
        raise SystemExit('page model test anchor missing')
    test_text = test_text.replace(anchor, anchor + addition, 1)
test_text = test_text.replace(
    "  assert.match(adapterSource, /models\\.length === 1/);",
    "  assert.match(adapterSource, /effectiveModels\\.length === 1/);",
)
test_path.write_text(test_text, encoding='utf-8')

sync_test = Path('extension/tests/page-observation-sync.test.mjs')
sync_test.write_text("""import assert from 'node:assert/strict';
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
""", encoding='utf-8')

manifest_path = Path('extension/manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['version'] = '0.4.6'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

package_path = Path('extension/package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['version'] = '0.4.6'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

replace_once('native-core/Cargo.toml', 'version = "0.4.5"', 'version = "0.4.6"')
