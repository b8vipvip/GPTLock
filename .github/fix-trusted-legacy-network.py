from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one block in {path}, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Network evidence may legitimately confirm a future model whose ID happens to
# resemble one of the old DOM-corruption patterns. Historical unproven values are
# removed, but authoritative request/response evidence can restore the same ID.
for path in ['extension/model-catalog.js', 'extension/model-catalog-options.js']:
    marker = '''  function legacySuspiciousModel(value) {\n    const model = normalizeModelId(value);\n    if (!model) return true;\n    if (/^gpt-5\\.6-(?:s|so)$/.test(model)) return true;\n    return model !== 'gpt-5.6-sol' && /^gpt-5\\.6-sol[a-z0-9]+$/.test(model);\n  }'''
    replacement = marker + '''\n\n  function hasTrustedNetworkEvidence(item) {\n    const sources = Array.isArray(item?.sources) ? item.sources : [];\n    return sources.includes('network_request_metadata')\n      || sources.includes('network_response_metadata');\n  }'''
    replace_exact(path, marker, replacement)

replace_exact(
    'extension/model-catalog.js',
    '''      const entries = Object.entries(evidence)\n        .filter(([model, item]) => normalizeModelId(model) && item?.confirmed && !legacySuspiciousModel(model))''',
    '''      const entries = Object.entries(evidence)\n        .filter(([model, item]) => normalizeModelId(model) && item?.confirmed\n          && (!legacySuspiciousModel(model) || hasTrustedNetworkEvidence(item)))''',
)

old_options = '''    const discoveredBefore = Array.isArray(stored[STORAGE_KEY])\n      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]\n      : [];\n    const discovered = discoveredBefore.filter((model) => !legacySuspiciousModel(model));\n    const lockedBefore = Array.isArray(stored.policy?.lockedModels)\n      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)\n      : [];\n    const lockedModels = lockedBefore.filter((model) => !legacySuspiciousModel(model));\n    const evidenceBefore = stored[EVIDENCE_STORAGE_KEY] && typeof stored[EVIDENCE_STORAGE_KEY] === 'object'\n      ? stored[EVIDENCE_STORAGE_KEY]\n      : {};\n    const evidence = Object.fromEntries(\n      Object.entries(evidenceBefore).filter(([model]) => !legacySuspiciousModel(model)),\n    );'''
new_options = '''    const discoveredBefore = Array.isArray(stored[STORAGE_KEY])\n      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]\n      : [];\n    const lockedBefore = Array.isArray(stored.policy?.lockedModels)\n      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)\n      : [];\n    const evidenceBefore = stored[EVIDENCE_STORAGE_KEY] && typeof stored[EVIDENCE_STORAGE_KEY] === 'object'\n      ? stored[EVIDENCE_STORAGE_KEY]\n      : {};\n    const trusted = (model) => hasTrustedNetworkEvidence(evidenceBefore?.[model]);\n    const discovered = discoveredBefore.filter((model) => !legacySuspiciousModel(model) || trusted(model));\n    const lockedModels = lockedBefore.filter((model) => !legacySuspiciousModel(model) || trusted(model));\n    const evidence = Object.fromEntries(\n      Object.entries(evidenceBefore).filter(([model, item]) =>\n        !legacySuspiciousModel(model) || hasTrustedNetworkEvidence(item)),\n    );'''
replace_exact('extension/model-catalog-options.js', old_options, new_options)

p = Path('extension/tests/model-discovery.test.mjs')
text = p.read_text(encoding='utf-8')
append = r'''

test('trusted network evidence can restore a future model that resembles a legacy artifact', () => {
  assert.match(catalogSource, /function hasTrustedNetworkEvidence/);
  assert.match(catalogSource, /!legacySuspiciousModel\(model\) \|\| hasTrustedNetworkEvidence\(item\)/);
  assert.match(optionsSource, /const trusted = \(model\) => hasTrustedNetworkEvidence/);
  assert.match(optionsSource, /!legacySuspiciousModel\(model\) \|\| trusted\(model\)/);
});
'''
if 'trusted network evidence can restore a future model' not in text:
    p.write_text(text + append, encoding='utf-8')

print('trusted legacy network evidence fix applied')
