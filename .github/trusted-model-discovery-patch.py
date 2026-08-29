from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one block in {path}, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Do not manufacture arbitrary suffix model IDs from visible DOM text.
for path in ['extension/model-catalog.js', 'extension/page-model-evidence.js']:
    old = '''    const explicit = compact.match(/gpt-?(\\d+(?:\\.\\d+)*)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?/);\n    if (explicit) {\n      const suffix = explicit[2] ? `-${explicit[2]}` : '';\n      return normalizeModelId(`gpt-${explicit[1]}${suffix}`);\n    }\n    const compactSol = compact.match(/(?:^|[^a-z0-9])(\\d+(?:\\.\\d+)*)-sol(?:-wm)?(?:-|$)/);\n    return compactSol ? normalizeModelId(`gpt-${compactSol[1]}-sol`) : null;'''
    if path.endswith('page-model-evidence.js'):
        old = '''    const explicit = compact.match(/gpt-?(\\d+(?:\\.\\d+)*)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?/);\n    if (explicit) {\n      const suffix = explicit[2] ? `-${explicit[2]}` : '';\n      return normalizeModelId(`gpt-${explicit[1]}${suffix}`);\n    }\n    const compactSol = compact.match(/(?:^|[^a-z0-9])(\\d+(?:\\.\\d+)*)-sol(?:-wm)?(?:-|$)/);\n    return compactSol ? normalizeModelId(`gpt-${compactSol[1]}-sol`) : null;'''
    new = '''    // Visible DOM text is advisory only.  Recognize the established Sol family\n    // explicitly, otherwise fall back to the base GPT family.  Do not turn\n    // arbitrary trailing UI text (for example "Solji"/"Solmo") into a model ID.\n    const compactSol = compact.match(/(?:^|[^a-z0-9])(?:gpt-)?(\\d+(?:\\.\\d+)*)-sol(?:-wm)?(?:$|[^a-z0-9])/);\n    if (compactSol) return normalizeModelId(`gpt-${compactSol[1]}-sol`);\n    const explicit = compact.match(/(?:^|[^a-z0-9])gpt-?(\\d+(?:\\.\\d+)*)(?=$|[^a-z0-9.])/);\n    return explicit ? normalizeModelId(`gpt-${explicit[1]}`) : null;'''
    replace_exact(path, old, new)


# 2) Persist only network-confirmed discoveries and migrate legacy polluted IDs.
replace_exact(
    'extension/model-catalog.js',
    "  const STORAGE_KEY = 'discoveredModels';\n  const MAX_DISCOVERED_MODELS = 64;",
    "  const STORAGE_KEY = 'discoveredModels';\n  const EVIDENCE_STORAGE_KEY = 'discoveredModelEvidence';\n  const DISCOVERY_SCHEMA_KEY = 'modelDiscoverySchemaVersion';\n  const DISCOVERY_SCHEMA_VERSION = 2;\n  const MAX_DISCOVERED_MODELS = 64;",
)

replace_exact(
    'extension/model-catalog.js',
    '''  function modelCandidates(state) {\n    const values = [];\n    const add = (value) => {\n      const model = normalizeModelId(value);\n      if (model && !values.includes(model)) values.push(model);\n    };\n    add(state?.lastVerification?.model);\n    add(state?.lastRequest?.model);\n    add(effectivePageObservation(state)?.model);\n    return values;\n  }''',
    '''  function trustedModelCandidates(state) {\n    const values = [];\n    const add = (value, source) => {\n      const model = normalizeModelId(value);\n      if (!model) return;\n      const key = `${source}:${model}`;\n      if (!values.some((item) => item.key === key)) values.push({ key, model, source });\n    };\n\n    // The formal conversation POST is authoritative for what GPTLock actually sends.\n    add(state?.lastRequest?.model, 'network_request_metadata');\n\n    const verification = state?.lastVerification;\n    if (\n      verification?.evidenceSource === 'network_response_metadata'\n      && !verification?.reasons?.includes?.('model_missing')\n    ) {\n      add(verification.model, 'network_response_metadata');\n    }\n    return values;\n  }\n\n  function legacySuspiciousModel(value) {\n    const model = normalizeModelId(value);\n    if (!model) return true;\n    if (/^gpt-5\\.6-(?:s|so)$/.test(model)) return true;\n    return model !== 'gpt-5.6-sol' && /^gpt-5\\.6-sol[a-z0-9]+$/.test(model);\n  }''',
)

replace_exact(
    'extension/model-catalog.js',
    '''  function rememberModels(models) {\n    if (!models.length) return;\n    writeQueue = writeQueue.then(async () => {\n      const stored = await chrome.storage.sync.get(STORAGE_KEY);\n      const existing = Array.isArray(stored[STORAGE_KEY])\n        ? stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean)\n        : [];\n      const next = [...new Set([...existing, ...models.map(normalizeModelId).filter(Boolean)])]\n        .slice(-MAX_DISCOVERED_MODELS);\n      if (JSON.stringify(next) !== JSON.stringify(existing)) {\n        await chrome.storage.sync.set({ [STORAGE_KEY]: next });\n      }\n    }).catch(() => {});\n  }''',
    '''  function rememberModels(candidates) {\n    if (!candidates.length) return;\n    writeQueue = writeQueue.then(async () => {\n      const stored = await chrome.storage.sync.get([\n        STORAGE_KEY,\n        EVIDENCE_STORAGE_KEY,\n        DISCOVERY_SCHEMA_KEY,\n      ]);\n      const legacy = Array.isArray(stored[STORAGE_KEY])\n        ? stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean)\n        : [];\n      const evidence = stored[EVIDENCE_STORAGE_KEY] && typeof stored[EVIDENCE_STORAGE_KEY] === 'object'\n        ? { ...stored[EVIDENCE_STORAGE_KEY] }\n        : {};\n      const now = new Date().toISOString();\n\n      // v1 stored page-text guesses without provenance. Keep plausible historical IDs,\n      // but drop the known partial/concatenated 5.6 Sol artifacts. A real future model\n      // can always be re-added immediately by authoritative network evidence.\n      if (Number(stored[DISCOVERY_SCHEMA_KEY] || 0) < DISCOVERY_SCHEMA_VERSION) {\n        for (const model of legacy) {\n          if (legacySuspiciousModel(model)) continue;\n          evidence[model] ||= { confirmed: true, sources: ['legacy-v1'], firstSeenAt: now, lastSeenAt: now };\n        }\n      }\n\n      for (const candidate of candidates) {\n        const model = normalizeModelId(candidate?.model);\n        if (!model || legacySuspiciousModel(model) && candidate?.source?.startsWith?.('page_')) continue;\n        const previous = evidence[model] && typeof evidence[model] === 'object' ? evidence[model] : {};\n        const sources = [...new Set([...(Array.isArray(previous.sources) ? previous.sources : []), candidate.source])];\n        evidence[model] = {\n          confirmed: true,\n          sources,\n          firstSeenAt: previous.firstSeenAt || now,\n          lastSeenAt: now,\n        };\n      }\n\n      const entries = Object.entries(evidence)\n        .filter(([model, item]) => normalizeModelId(model) && item?.confirmed && !legacySuspiciousModel(model))\n        .sort((a, b) => String(a[1]?.lastSeenAt || '').localeCompare(String(b[1]?.lastSeenAt || '')))\n        .slice(-MAX_DISCOVERED_MODELS);\n      const nextEvidence = Object.fromEntries(entries);\n      const next = entries.map(([model]) => model);\n      await chrome.storage.sync.set({\n        [STORAGE_KEY]: next,\n        [EVIDENCE_STORAGE_KEY]: nextEvidence,\n        [DISCOVERY_SCHEMA_KEY]: DISCOVERY_SCHEMA_VERSION,\n      });\n    }).catch(() => {});\n  }''',
)

replace_exact(
    'extension/model-catalog.js',
    '''    rememberModels(modelCandidates(state));''',
    '''    rememberModels(trustedModelCandidates(state));''',
)
replace_exact(
    'extension/model-catalog.js',
    '''      if (model) rememberModels([model]);\n      render(lastState);''',
    '''      // Page DOM remains useful for the live indicator, but it is not strong enough\n      // evidence to permanently add a lockable model. Network request/response evidence\n      // will promote the model after a real conversation request.\n      render(lastState);''',
)


# 3) Clean legacy storage and avoid duplicate known/discovered cards in options UI.
replace_exact(
    'extension/model-catalog-options.js',
    "  const STORAGE_KEY = 'discoveredModels';",
    "  const STORAGE_KEY = 'discoveredModels';\n  const EVIDENCE_STORAGE_KEY = 'discoveredModelEvidence';\n  const DISCOVERY_SCHEMA_KEY = 'modelDiscoverySchemaVersion';\n  const DISCOVERY_SCHEMA_VERSION = 2;",
)

insert_after = '''  function normalizeModelId(value) {\n    const model = String(value ?? '').trim().toLowerCase();\n    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;\n    return MODEL_ALIASES[model] ?? model;\n  }'''
addition = insert_after + '''\n\n  function legacySuspiciousModel(value) {\n    const model = normalizeModelId(value);\n    if (!model) return true;\n    if (/^gpt-5\\.6-(?:s|so)$/.test(model)) return true;\n    return model !== 'gpt-5.6-sol' && /^gpt-5\\.6-sol[a-z0-9]+$/.test(model);\n  }\n\n  function evidenceLabel(model, evidence) {\n    const sources = Array.isArray(evidence?.[model]?.sources) ? evidence[model].sources : [];\n    if (sources.includes('network_response_metadata')) return '网络响应确认 / Response confirmed';\n    if (sources.includes('network_request_metadata')) return '正式请求确认 / Request confirmed';\n    return '历史识别 / Legacy discovered';\n  }'''
replace_exact('extension/model-catalog-options.js', insert_after, addition)

replace_exact(
    'extension/model-catalog-options.js',
    '''  function appendChoice(model, lockedModels) {''',
    '''  function appendChoice(model, lockedModels, evidence) {''',
)
replace_exact(
    'extension/model-catalog-options.js',
    '''    small.textContent = `${model} · 自动识别 / Discovered`;''',
    '''    small.textContent = `${model} · ${evidenceLabel(model, evidence)}`;''',
)

old_refresh = '''  async function refresh() {\n    const stored = await chrome.storage.sync.get([STORAGE_KEY, 'policy']);\n    const discovered = Array.isArray(stored[STORAGE_KEY])\n      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]\n      : [];\n    const lockedModels = Array.isArray(stored.policy?.lockedModels)\n      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)\n      : [];\n    for (const model of discovered) appendChoice(model, lockedModels);\n    dedupeCustomField(discovered);\n    window.setTimeout(() => dedupeCustomField(discovered), 800);\n  }'''
new_refresh = '''  function removeDuplicateDiscoveredRows() {\n    const container = document.getElementById('modelChoices');\n    if (!container) return;\n    for (const row of container.querySelectorAll('[data-discovered-model]')) {\n      const input = row.querySelector('input[name="model"]');\n      if (!input) continue;\n      const duplicates = [...container.querySelectorAll('input[name="model"]')]\n        .filter((candidate) => candidate.value === input.value && candidate !== input);\n      if (duplicates.some((candidate) => !candidate.closest('[data-discovered-model]'))) row.remove();\n    }\n  }\n\n  async function refresh() {\n    const stored = await chrome.storage.sync.get([\n      STORAGE_KEY,\n      EVIDENCE_STORAGE_KEY,\n      DISCOVERY_SCHEMA_KEY,\n      'policy',\n    ]);\n    const discoveredBefore = Array.isArray(stored[STORAGE_KEY])\n      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]\n      : [];\n    const discovered = discoveredBefore.filter((model) => !legacySuspiciousModel(model));\n    const lockedBefore = Array.isArray(stored.policy?.lockedModels)\n      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)\n      : [];\n    const lockedModels = lockedBefore.filter((model) => !legacySuspiciousModel(model));\n    const evidenceBefore = stored[EVIDENCE_STORAGE_KEY] && typeof stored[EVIDENCE_STORAGE_KEY] === 'object'\n      ? stored[EVIDENCE_STORAGE_KEY]\n      : {};\n    const evidence = Object.fromEntries(\n      Object.entries(evidenceBefore).filter(([model]) => !legacySuspiciousModel(model)),\n    );\n\n    if (\n      Number(stored[DISCOVERY_SCHEMA_KEY] || 0) < DISCOVERY_SCHEMA_VERSION\n      || JSON.stringify(discovered) !== JSON.stringify(discoveredBefore)\n      || JSON.stringify(lockedModels) !== JSON.stringify(lockedBefore)\n      || Object.keys(evidence).length !== Object.keys(evidenceBefore).length\n    ) {\n      const patch = {\n        [STORAGE_KEY]: discovered,\n        [EVIDENCE_STORAGE_KEY]: evidence,\n        [DISCOVERY_SCHEMA_KEY]: DISCOVERY_SCHEMA_VERSION,\n      };\n      if (stored.policy && JSON.stringify(lockedModels) !== JSON.stringify(lockedBefore)) {\n        patch.policy = { ...stored.policy, lockedModels };\n      }\n      await chrome.storage.sync.set(patch);\n    }\n\n    for (const model of discovered) appendChoice(model, lockedModels, evidence);\n    removeDuplicateDiscoveredRows();\n    dedupeCustomField(discovered);\n    window.setTimeout(() => {\n      removeDuplicateDiscoveredRows();\n      dedupeCustomField(discovered);\n    }, 800);\n  }'''
replace_exact('extension/model-catalog-options.js', old_refresh, new_refresh)

# 4) Explain the new trust rule in the UI.
replace_exact(
    'extension/options.html',
    '''      <p class="permission-note">使用过程中识别到的新模型会自动加入这里作为“自动识别 / Discovered”候选项，但不会自动勾选或放宽当前锁定策略；只有你勾选并保存后才会成为允许的锁定模型。</p>''',
    '''      <p class="permission-note">只有正式聊天请求或响应元数据确认的新模型才会加入“自动识别 / Discovered”；页面 DOM 文本只作为辅助观察，不会单独永久入库。自动识别项不会自动勾选或放宽锁定策略，只有你勾选并保存后才会成为允许模型。</p>''',
)

# 5) Regression coverage.
Path('extension/tests/model-discovery.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const adapterSource = await readFile(new URL('../page-model-evidence.js', import.meta.url), 'utf8');
const catalogSource = await readFile(new URL('../model-catalog.js', import.meta.url), 'utf8');
const optionsSource = await readFile(new URL('../model-catalog-options.js', import.meta.url), 'utf8');

function loadAdapter() {
  const context = vm.createContext({});
  vm.runInContext(adapterSource, context);
  return context.__GPTLOCK_PAGE_MODEL_EVIDENCE__;
}

test('visible DOM text cannot manufacture arbitrary GPT-5.6 Sol suffix IDs', () => {
  const adapter = loadAdapter();
  for (const label of ['GPT 5.6 S', 'GPT 5.6 So', 'GPT 5.6 Solji', 'GPT 5.6 Soljin', 'GPT 5.6 Solmo']) {
    const model = adapter.modelFromText(label);
    assert.notEqual(model, 'gpt-5.6-s');
    assert.notEqual(model, 'gpt-5.6-so');
    assert.notEqual(model, 'gpt-5.6-solji');
    assert.notEqual(model, 'gpt-5.6-soljin');
    assert.notEqual(model, 'gpt-5.6-solmo');
  }
  assert.equal(adapter.modelFromText('GPT-5.6 Sol'), 'gpt-5.6-sol');
  assert.equal(adapter.modelFromText('gpt-5.6-sol-wm'), 'gpt-5.6-sol');
});

test('persistent discovery is network-authoritative and DOM-only observations are not stored', () => {
  assert.match(catalogSource, /function trustedModelCandidates/);
  assert.match(catalogSource, /network_request_metadata/);
  assert.match(catalogSource, /network_response_metadata/);
  assert.doesNotMatch(catalogSource, /if \(model\) rememberModels\(\[model\]\)/);
  assert.match(catalogSource, /Page DOM remains useful for the live indicator/);
});

test('legacy polluted Sol fragments are migrated out of discoveries and locked policy', () => {
  assert.match(optionsSource, /function legacySuspiciousModel/);
  assert.match(optionsSource, /gpt-5\\\.6-\(\?:s\|so\)/);
  assert.match(optionsSource, /patch\.policy = \{ \.\.\.stored\.policy, lockedModels \}/);
  assert.match(optionsSource, /removeDuplicateDiscoveredRows/);
});
''', encoding='utf-8')

print('trusted model discovery patch applied')
