# Store privacy disclosure checklist / 商店隐私披露核对表

This checklist describes the current implementation only. Recheck it against the exact release candidate before store submission.

- Account: email; passwords travel over HTTPS for account operations and are stored server-side as scrypt-derived hashes, not readable plaintext.
- Device/session: random device ID, browser instance ID, extension ID/version, platform, timestamps and entitlement/window heartbeat metadata.
- Website security sessions: IP and User-Agent are retained with site-session metadata for account security/session management.
- Membership/orders: plan, entitlement dates, order amount/status, payment-method code and HTTPS payment URL; GPTLock does not collect card numbers or payment passwords in the browser extension.
- Preferences: model/reasoning settings may use browser `storage.sync`.
- Client runtime logs: signed-in clients automatically upload sanitized technical logs. Known sensitive keys are redacted before upload; server default retention is 30 days.
- Auto-verification diagnostic stream: only while the fixed auto-verification workflow is running, matching SSE/WebSocket response data may be cached locally with a 10 MiB cap. It is not sent as normal runtime-log content and leaves local storage when the user explicitly exports a diagnostic bundle.
- Native Messaging: local communication with the separately installed GPTLock Native Core.
- Server runtime logs: method/path/status/duration plus Origin/User-Agent and sanitized errors; request bodies, cookies and Authorization headers are not intentionally logged.

Explicit non-uses: no sale of user data, no advertising personalization, no data-broker use, no cross-site behavioral profiling, and no ordinary chat body upload as client runtime logs.

Public URLs:
- Privacy: https://gptlock.mv3.cn/privacy
- Terms: https://gptlock.mv3.cn/terms
- Support: https://gptlock.mv3.cn/support
- Data deletion: https://gptlock.mv3.cn/data-deletion
