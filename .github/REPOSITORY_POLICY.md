# GPTWork repository governance

## Private monorepo role

This repository is the authoritative private source repository for GPTWork. It may contain website/server source, browser-extension source, installers, packaging, native host code and proprietary private-engine source.

Repository privacy is **not** treated as the only source-protection control. Client artifacts remain inspectable after installation, so implementation-sensitive behavior should continue moving from shipped JavaScript into the compiled `private-engine/` component. CI must prevent private-engine Rust source and build metadata from entering extension archives or installer/package payloads.

The old split-repository handoff is being retired. New private-engine behavior should be developed in `private-engine/` in this repository so normal pull-request CI can test the exact engine source that will be packaged with the same commit.

Some implementation-sensitive JavaScript remains for v0.5.x compatibility. Those files stay a frozen migration baseline: delete them after a compiled-engine replacement is proven, but do not evolve them with new proprietary behavior. See `PRIVATE_CORE_BOUNDARY.md`.

## main branch

`main` is the release branch. Changes should enter `main` only through a merged pull request after the repository CI checks have passed.

Direct pushes to `main` are treated as a policy violation. `.github/workflows/repository-housekeeping.yml` audits every `main` push and reports a failed check when the resulting commit cannot be verified as coming from a merged pull request targeting `main`.

The Release workflow also waits for both the normal `main` CI and the repository-governance workflow before it is allowed to build and publish a new version. A governance failure therefore prevents an automated official release from that commit.

GitHub-native branch protection/rulesets remain the preferred hard enforcement layer because a workflow can detect a direct push only after it has happened. The intended native policy is:

- require changes to enter `main` through pull requests;
- require the repository CI checks before merge;
- require the private-core/distribution-boundary check;
- disallow force pushes and deletion of `main`;
- keep administrators subject to the same normal merge path unless emergency recovery is required.

## Distribution boundary

Only built client/runtime artifacts may leave the private source repository. In particular:

- extension archives contain only the browser runtime files selected by the packaging workflow;
- Windows Setup and Linux deb packages include `gptwork-core` plus the compiled `gptwork-engine` artifact;
- `private-engine/src/**`, Rust source, Cargo manifests/locks and private development snapshots must never be distributed;
- release/update credentials remain server- or Actions-side secrets and are never embedded in the extension or installer.

## Development branch lifecycle

Short-lived development branches use prefixes such as `feat/`, `fix/`, `codex/`, `chore/`, `refactor/`, `test/`, `ui/`, and `hardening/`.

After a change reaches `main`, the housekeeping workflow removes a short-lived branch only when there is conclusive merge evidence. It accepts either normal Git ancestry or, for squash/rebase merges, a merged pull request targeting `main` whose recorded head SHA exactly matches the branch's current tip. A reused branch with newer commits is therefore not deleted accidentally.

Historical `release/*` branches and unknown branch names are intentionally left untouched by automatic cleanup. Version tags and release assets remain independent of development-branch cleanup.
