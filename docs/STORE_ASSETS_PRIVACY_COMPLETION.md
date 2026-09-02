# 商店资源与隐私体系完成记录 / Store Assets & Privacy Completion Record

Date: 2026-09-02

This record covers only the two items explicitly approved for direct implementation in this round: store assets and the privacy system. All other remediation items remain proposal-only in `docs/STORE_READINESS_REMEDIATION_PLAN.md`.

Completed:
- Manifest PNG icons: 16×16, 32×32, 48×48, 128×128.
- Store logo: 128×128.
- Store screenshot: 1280×800.
- Small promo: 440×280.
- Simplified Chinese and English store descriptions/reviewer-notes drafts.
- Public Privacy Policy, Terms of Service, Support, and Data Deletion pages/routes.
- Self-service account/data deletion with current-password verification and `DELETE` confirmation.
- Privacy text aligned with current account/device/session data, site-session IP/User-Agent, membership/order records, browser sync settings, sanitized client runtime-log uploads, fixed auto-verification SSE/WebSocket local diagnostic capture, Native Messaging, and log retention behavior.
- Legal/support pages made compatible with production CSP `style-src 'self'` by moving their styles into `site.css`.

Not implemented in this round:
- Store build vs independent/GitHub build split.
- Permission changes for `debugger`, `tabs`, `downloads`, `unlimitedStorage`, etc.
- Chrome/Edge production extension IDs in the Native Host allowlist.
- Store-specific extension update flow.
- Reviewer test account, dashboard submission, or formal review.
