(() => {
  const DISCOVERED_MODELS_KEY = 'discoveredModels';
  const POLICY_KEY = 'policy';
  const MODEL_ALIASES = Object.freeze({
    'gpt-5.6-sol-wm': 'gpt-5.6-sol',
    'gpt-5-6': 'gpt-5.6-sol',
  });
  let writeQueue = Promise.resolve();

  function normalizeModelId(value) {
    const model = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._:-]{1,128}$/.test(model)) return null;
    return MODEL_ALIASES[model] ?? model;
  }

  function normalizeModels(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map(normalizeModelId)
      .filter(Boolean))];
  }

  function newlyDiscovered(change) {
    const previous = new Set(normalizeModels(change?.oldValue));
    return normalizeModels(change?.newValue).filter((model) => !previous.has(model));
  }

  function autoEnable(models) {
    if (!models.length) return;
    writeQueue = writeQueue.then(async () => {
      const stored = await chrome.storage.sync.get(POLICY_KEY);
      const policy = stored[POLICY_KEY] && typeof stored[POLICY_KEY] === 'object'
        ? stored[POLICY_KEY]
        : {
            lockedModels: ['gpt-5.6-sol'],
            allowedReasoningLevels: ['medium', 'high', 'extra-high'],
            strictMode: true,
          };
      const lockedModels = normalizeModels(policy.lockedModels);
      const nextLockedModels = [...new Set([...lockedModels, ...models])];
      if (nextLockedModels.length === lockedModels.length) return;
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
