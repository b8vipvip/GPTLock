# GPTLock private-core distribution boundary

GPTLock now uses a **private monorepo**. Implementation-sensitive source may live in this repository, but it must not be shipped as readable source in client artifacts.

## Private repository source

The repository may contain all product source needed to build GPTLock, including proprietary detection, decision, verification, learning, correlation and context-budget logic.

Implementation-sensitive Rust source belongs under `private-engine/`. The browser extension and `native-core` act as integration/runtime shells and should continue moving sensitive decisions behind the versioned local engine bridge instead of duplicating them in JavaScript.

## Distributable client surface

Release artifacts may contain:

- browser extension runtime files required by Chrome/Edge;
- `gptlock-core` / `gptlock-core.exe`;
- the **compiled** `gptlock-engine` / `gptlock-engine.exe`;
- installers, update helpers and user-facing assets.

Release artifacts must not contain:

- `private-engine/src/**`;
- Rust source files from the private engine;
- private-engine `Cargo.toml` / `Cargo.lock`;
- development-only private source snapshots or overlays.

CI inspects the extension archive and platform packages for these source leaks.

## Legacy v0.5.x browser source

The extension still contains implementation-sensitive JavaScript inherited from the earlier public v0.5.x architecture. Those paths remain a frozen compatibility baseline while the compiled private engine takes over their responsibilities.

Migration rules:

1. new proprietary behavior goes into `private-engine/`;
2. browser/native shells expose only bounded collection, transport, compatibility and UI behavior;
3. use shadow/private-first migration before deleting a legacy component;
4. once a compiled-engine path is proven in Windows and Linux packages, delete the replaced legacy implementation instead of extending it;
5. keep a compatibility fallback only while a released installation can legitimately lack the new engine artifact.

## Historical disclosure

Changing repository visibility prevents unauthenticated access going forward, but source previously published while the repository was public must still be considered historically disclosed. The migration therefore focuses on protecting future implementation changes and preventing readable private-engine source from entering distributed client artifacts.
