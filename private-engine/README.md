# GPTLock Private Engine

This directory contains implementation-sensitive GPTLock runtime source. The repository itself is private; this source is **not** a distributable client payload.

## Runtime role

The compiled binary is installed beside the public/native host shell as:

- Windows: `bin/gptlock-engine.exe`
- Linux: `/usr/bin/gptlock-engine`

`gptlock-core` talks to it through the bounded protocol-v2 local bridge. Browser-side code should collect only the data required by that contract and should not duplicate engine rules.

## Distribution rule

Source under `private-engine/` must never be copied into:

- the browser extension archive;
- Windows Setup payloads;
- Linux deb payloads;
- public/site static assets;
- diagnostic exports.

Only the compiled `gptlock-engine` / `gptlock-engine.exe` artifact may leave the private repository as part of a client release.

## Build

```text
cargo fmt --manifest-path private-engine/Cargo.toml --all -- --check
cargo clippy --manifest-path private-engine/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path private-engine/Cargo.toml --all-targets
cargo build --manifest-path private-engine/Cargo.toml --release
```

The product release workflow builds this crate in the same private repository so no cross-repository source or artifact handoff is required.
