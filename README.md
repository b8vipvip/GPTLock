# GPTLock

GPTLock is a Manifest V3 browser extension plus optional local companion for Windows and Linux Chrome/Edge browsers.

Goals:
- Lock preferred ChatGPT model selections.
- Support multiple target models and reasoning levels.
- Provide local verification and diagnostics.
- Never bypass OpenAI service limits or security controls.

Architecture:

```
Browser Extension
    |
    | policy + state bridge
    |
Local Companion
    |
    | diagnostic verification API
    |
ChatGPT Web
```

Current roadmap:

1. Extension foundation
2. Policy engine
3. Windows/Linux native companion
4. Local verification API
5. Model state audit logs
