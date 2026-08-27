# GPTLock v0.4.6

- Keep popup Page selection synchronized with the same validated composer model evidence used by the floating page-model indicator.
- Preserve visible composer text when a generic aria-label or title would otherwise hide the actual model family.
- Recollect live page selection when the popup requests current state, instead of returning only a stale cached observation.
- Preserve page model evidence source, labels, ambiguity state, and candidate families for diagnostics.

Chrome's `chrome.debugger` security infobar remains browser-controlled. GPTLock does not attempt to suppress or remove Chromium security UI while using the CDP/Fetch request-locking path.
