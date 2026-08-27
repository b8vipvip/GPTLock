(() => {
  const STORAGE_KEY = 'discoveredModels';
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    return MODEL_ALIASES[model] ?? model;
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

  function appendChoice(model, lockedModels) {
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
    small.textContent = `${model} · 自动识别 / Discovered`;
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

  async function refresh() {
    const stored = await chrome.storage.sync.get([STORAGE_KEY, 'policy']);
    const discovered = Array.isArray(stored[STORAGE_KEY])
      ? [...new Set(stored[STORAGE_KEY].map(normalizeModelId).filter(Boolean))]
      : [];
    const lockedModels = Array.isArray(stored.policy?.lockedModels)
      ? stored.policy.lockedModels.map(normalizeModelId).filter(Boolean)
      : [];
    for (const model of discovered) appendChoice(model, lockedModels);
    dedupeCustomField(discovered);
    window.setTimeout(() => dedupeCustomField(discovered), 800);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || (!changes[STORAGE_KEY] && !changes.policy)) return;
    void refresh().catch(() => {});
  });

  void refresh().catch(() => {});
})();
