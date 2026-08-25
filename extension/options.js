const models = document.getElementById('models');
const levels = document.getElementById('levels');
const strict = document.getElementById('strict');

chrome.storage.sync.get('policy', ({policy}) => {
  if (!policy) return;
  models.value = policy.models.join(',');
  levels.value = policy.reasoningLevels.join(',');
  strict.checked = policy.strictMode;
});

for (const el of [models, levels, strict]) {
  el.addEventListener('change', () => {
    chrome.storage.sync.set({
      policy: {
        models: models.value.split(',').map(x=>x.trim()).filter(Boolean),
        reasoningLevels: levels.value.split(',').map(x=>x.trim()).filter(Boolean),
        strictMode: strict.checked
      }
    });
  });
}
