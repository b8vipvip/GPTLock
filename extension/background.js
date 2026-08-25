const DEFAULT_POLICY = {
  models: ["gpt-5.6-sol"],
  reasoningLevels: ["medium", "high"],
  strictMode: true
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ policy: DEFAULT_POLICY });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details.url.includes("chatgpt.com/backend-api")) return;
    console.debug("GPTLock request observed", details.url);
  },
  { urls: ["https://chatgpt.com/backend-api/*"] }
);
