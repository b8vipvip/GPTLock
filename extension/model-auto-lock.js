(() => {
  const DISCOVERED_MODELS_KEY = 'discoveredModels';
  const POLICY_KEY = 'policy';
  const ASTRA_MODEL_ID = 'gpt-6-astra';
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });
  const NON_CONCRETE_MODEL_IDS = new Set(['auto']);
  let writeQueue = Promise.resolve();

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    if (model === ASTRA_MODEL_ID || /^(?:gpt-6-astra)(?:[-_.:][a-z0-9._:-]+)$/.test(model)) {
      return ASTRA_MODEL_ID;
    }
    return MODEL_ALIASES[model] ?? model;
  }

  function normalizeConcreteModelId(value) {
    const model = normalizeModelId(value);
    return model && !NON_CONCRETE_MODEL_IDS.has(model) ? model : null;
  }

  function normalizeModels(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map(normalizeConcreteModelId)
      .filter(Boolean))];
  }

  function newlyDiscovered(change) {
    const previous = new Set(normalizeModels(change?.oldValue));
    return normalizeModels(change?.newValue).filter((model) => !previous.has(model));
  }

  function prioritizedModels(lockedModels, models) {
    const merged = [...new Set([...lockedModels, ...models])];
    if (!models.includes(ASTRA_MODEL_ID)) return merged;
    return [ASTRA_MODEL_ID, ...merged.filter((model) => model !== ASTRA_MODEL_ID)];
  }

  function autoEnable(models) {
    if (!models.length) return;
    writeQueue = writeQueue.then(async () => {
      const stored = await chrome.storage.sync.get(POLICY_KEY);
      const policy = stored[POLICY_KEY] && typeof stored[POLICY_KEY] === 'object'
        ? stored[POLICY_KEY]
        : {
            lockedModels: ['gpt-6-astra', 'gpt-5.6-sol'],
            allowedReasoningLevels: ['medium', 'high', 'extra-high'],
            strictMode: true,
          };
      const lockedModels = normalizeModels(policy.lockedModels);
      const nextLockedModels = prioritizedModels(lockedModels, models);
      if (nextLockedModels.length === lockedModels.length
        && JSON.stringify(lockedModels) === JSON.stringify(policy.lockedModels || [])) return;
      await chrome.storage.sync.set({
        [POLICY_KEY]: { ...policy, lockedModels: nextLockedModels },
      });
    }).catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[DISCOVERED_MODELS_KEY]) return;
    autoEnable(newlyDiscovered(changes[DISCOVERED_MODELS_KEY]));
  });
})();
