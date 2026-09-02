# GPTLock Store Listing Copy (English)

## Name

GPTLock

## Short description

Lock your ChatGPT web model and reasoning preferences, with request and response evidence for unexpected changes.

## Full description

GPTLock is an independent browser extension for the official ChatGPT web experience. It saves and applies the model and reasoning preferences you select, locally enforces those preferences on relevant chat requests, and shows request/response evidence about whether the preference was applied.

If you regularly use a specific model or reasoning level, GPTLock reduces repetitive setup and makes mismatches easier to notice. The extension presents clear status for the local core, request interceptor, page selection, and response evidence.

Key features:

- Save and apply preferred model and reasoning settings.
- Enforce those preferences on relevant requests on `chatgpt.com`.
- Show Native Core, request-lock, page-selection, and response-evidence status.
- Run an automated verification flow using fixed test probes when verification evidence is needed.
- Support Windows and Linux, targeting Chrome and Microsoft Edge.
- Manage GPTLock account entitlement, devices, and sessions.
- Provide runtime logs and a user-initiated diagnostic export for troubleshooting.

Privacy:

GPTLock does not collect browsing data for advertising, data brokerage, or user profiling. Ordinary chat bodies are not uploaded as client runtime logs. When a user is signed in, sanitized runtime logs are uploaded to the GPTLock service for reliability and troubleshooting. Raw response streams captured for the fixed auto-verification probes are stored locally and leave local storage only when the user explicitly exports a diagnostic bundle. See the GPTLock Privacy Policy for the complete data practices.

Important:

GPTLock is an independent third-party tool. It is not an OpenAI product and is not endorsed by or affiliated with OpenAI. Model availability, usage limits, subscriptions, regional availability, and platform behavior remain controlled by ChatGPT / OpenAI. GPTLock cannot grant access to models that the user’s ChatGPT account is not entitled to use and does not bypass platform restrictions.

Some core functionality requires the separately installed GPTLock Native Core. The Native Core is distributed from the GPTLock website and is installed or removed only by the user.

## Single purpose

GPTLock saves and applies the user’s selected model and reasoning preferences on the official ChatGPT web experience, locally enforces those preferences on relevant chat requests, and shows request/response evidence so the user can detect when the selected preference was not applied or changed unexpectedly.

## Reviewer notes summary

GPTLock operates only on `https://chatgpt.com/*` for its disclosed model-preference locking and verification purpose. The `debugger` permission is used through the Chrome DevTools Protocol to observe network request/response evidence directly required for that purpose. `nativeMessaging` communicates with the GPTLock Native Core that the user separately and explicitly installs. GPTLock is not a general-purpose traffic inspector, does not request access to arbitrary websites, does not sell user data, and does not use chat data for advertising.