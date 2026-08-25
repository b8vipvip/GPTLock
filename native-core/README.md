# GPTLock Native Companion

Cross-platform local companion design.

Targets:

- Windows service
- Linux systemd daemon

Responsibilities:

- Receive policy from browser extension
- Provide localhost IPC API
- Validate diagnostics metadata
- Return model verification state

The companion does not bypass ChatGPT controls. It only validates available metadata and reports mismatches.
