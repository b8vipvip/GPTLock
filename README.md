# GPTLock

GPTLock is a Manifest V3 browser extension for Windows and Linux Chrome/Edge browsers.

Goals:
- Lock preferred ChatGPT model selections.
- Support multiple target models and reasoning levels.
- Provide network-layer diagnostics through an optional local companion service.
- Never bypass OpenAI service limits or security controls.

Architecture:

```
Browser Extension
    |
    | chrome.debugger / webRequest diagnostics
    |
Local Companion (optional)
    |
    | HTTPS traffic metadata inspection
    |
ChatGPT Web
```

The first version focuses on extension foundation, settings storage, model policy management, and cross-platform compatibility.
