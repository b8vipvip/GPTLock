(() => {
  const STORAGE_KEY = 'discoveredModels';
  const EVIDENCE_STORAGE_KEY = 'discoveredModelEvidence';
  const DISCOVERY_SCHEMA_KEY = 'modelDiscoverySchemaVersion';
  const DISCOVERY_SCHEMA_VERSION = 2;
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    return MODEL_ALIASES[model] ?? model;
  }

  function legacySuspiciousModel(value) {
    const model = normalizeModelId(value);
    if (!model) return true;
    if (/^gpt-5\.6-(?:s|so)$/.test(model)) return true;
    return model !== 'gpt-5.6-sol' && /^gpt-5\.6-sol[a-z0-9]+$/.test(model);
  }

  function evidenceLabel(model, evidence) {
    const sources = Array.isArray(evidence?.[model]?.sources) ? evidence[model].sources : [];
    if (sources.includes('network_response_metadata')) return '网络响应确认 / Response confirmed';
    if (sources.includes('network_request_metadata')) return '正式请求确认 / Request confirmed';
    return '历史识别 / Legacy discovered';
  }

  function modelLabel(value) {
    const model = normalizeModelId(value);
    if (!model) return 'Unknown';
    if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
    if (model === 'gpt-5.5') return 'GPT-5.5';
    if (model.startsWith('gpt-')) {
      return model
        .split('-')
        .map((part, index) => {
          if (index === 0) return 'GPT';
          if (/^\d+(?:\.\d+)*$/.test(part)) return part;
          if (part === 'sol') return 'Sol';
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(' ');
    }
    return model;
  }

  function appendChoice(model, lockedModels, evidence) {
    const container = document.getElementById('modelChoices');
    if (!container) return;
    const existing = container.querySelector(`input[name="model"][value="${CSS.escape(model)}"]`);
    if (existing) {
      if (existing.closest('[data-discovered-model]')) existing.checked = lockedModels.includes(model);
      return;
    }

    const row = document.createElement('label');
    row.className = 'check-row';
    row.dataset.discoveredModel = model;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'model';
    input.value = model;
    input.checked = lockedModels.includes(model);

    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = modelLabel(model);
    const small = document.createElement('small');
    small.textContent = `${model} · ${evidenceLabel(model, evidence)}`;
    text.append(strong, small);
    row.append(input, text);
    container.append(row);
  }

  function dedupeCustomField(discovered) {
    const field = document.getElementById('customModels');
    if (!field || !field.value.trim()) return;
    const discoveredSet = new Set(discovered);
    const remaining = field.value
      .split(',')
      .map((value) => normalizeModelId(value))
      .filter((value) => value && !discoveredSet.has(value));
    field.value = [...new Set(remaining)].join(', ');
  }

  function removeDuplicateDiscoveredRows() {
    const container = document.getElementById('modelChoices');
    if (!container) return;
    for (const row of container.querySelectorAll('[data-discovered-model]')) {
      const input = row.querySelector('input[name="model"]');
      if (!input) continue;
      const duplicates = [...container.querySelectorAll('input[name="model"]')]
        .filter((candidate) => candidate.value === input.value && candidate !== input);
      if (duplicates.some((candidate) => !candidate.closest('[data-discovered-model]'))) row.remove();
    }
  }

  async function refresh() {
    const stored = await chrome.storage.sync.get([
      STORAGE_KEY,
      EVIDENCE_STORAGE_KEY,
      DISCOVERY_SCHEMA_KEY,
      'policy',
    ]);
    const discoveredBefore = Array.isArray(stored[STORAGE_KEY])
      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]
      : [];
    const discovered = discoveredBefore.filter((model) => !legacySuspiciousModel(model));
    const lockedBefore = Array.isArray(stored.policy?.lockedModels)
      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)
      : [];
    const lockedModels = lockedBefore.filter((model) => !legacySuspiciousModel(model));
    const evidenceBefore = stored[EVIDENCE_STORAGE_KEY] && typeof stored[EVIDENCE_STORAGE_KEY] === 'object'
      ? stored[EVIDENCE_STORAGE_KEY]
      : {};
    const evidence = Object.fromEntries(
      Object.entries(evidenceBefore).filter(([model]) => !legacySuspiciousModel(model)),
    );

    if (
      Number(stored[DISCOVERY_SCHEMA_KEY] || 0) < DISCOVERY_SCHEMA_VERSION
      || JSON.stringify(discovered) !== JSON.stringify(discoveredBefore)
      || JSON.stringify(lockedModels) !== JSON.stringify(lockedBefore)
      || Object.keys(evidence).length !== Object.keys(evidenceBefore).length
    ) {
      const patch = {
        [STORAGE_KEY]: discovered,
        [EVIDENCE_STORAGE_KEY]: evidence,
        [DISCOVERY_SCHEMA_KEY]: DISCOVERY_SCHEMA_VERSION,
      };
      if (stored.policy && JSON.stringify(lockedModels) !== JSON.stringify(lockedBefore)) {
        patch.policy = { ...stored.policy, lockedModels };
      }
      await chrome.storage.sync.set(patch);
    }

    for (const model of discovered) appendChoice(model, lockedModels, evidence);
    removeDuplicateDiscoveredRows();
    dedupeCustomField(discovered);
    window.setTimeout(() => {
      removeDuplicateDiscoveredRows();
      dedupeCustomField(discovered);
    }, 800);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || (!changes[STORAGE_KEY] && !changes.policy)) return;
    void refresh().catch(() => {});
  });

  void refresh().catch(() => {});
})();
