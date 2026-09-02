const helpButton = document.getElementById('help');

helpButton?.addEventListener('click', () => {
  const url = chrome.runtime.getURL('help.html');
  void chrome.tabs.create({ url }).then(() => window.close());
});
