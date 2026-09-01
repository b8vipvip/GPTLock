# GPTLock repository governance

## Public repository role

This repository is the public distribution surface for GPTLock. It may contain the official website, account-facing UI, installers and packaging, public release metadata, user documentation, compatibility contracts, and the minimum client/runtime shell required to operate released builds.

Implementation-sensitive behavior is developed outside the public repository. New proprietary detection, policy, verification, learning, routing, or privileged runtime logic must not be added here as readable source. The public side should depend on stable interfaces and produced artifacts instead of duplicating private implementation.

Some implementation source remains in the current tree for compatibility with the v0.5.x build pipeline. Those paths are a **legacy frozen baseline**: they may be removed as the private-core migration advances, but they must not receive new proprietary behavior. See `PRIVATE_CORE_BOUNDARY.md` and the CI boundary check.

## main branch

`main` is the release branch. Changes should enter `main` only through a merged pull request after the repository CI checks have passed.

Direct pushes to `main` are treated as a policy violation. `.github/workflows/repository-housekeeping.yml` audits every `main` push and reports a failed check when the resulting commit cannot be verified as coming from a merged pull request targeting `main`.

The Release workflow also waits for both the normal `main` CI and the repository-governance workflow before it is allowed to build and publish a new version. A governance failure therefore prevents an automated official release from that commit.

GitHub-native branch protection/rulesets remain the preferred hard enforcement layer because a workflow can detect a direct push only after it has happened. The intended native policy is:

- require changes to enter `main` through pull requests;
- require the repository CI checks before merge;
- require the private-core boundary check;
- disallow force pushes and deletion of `main`;
- keep administrators subject to the same normal merge path unless emergency recovery is required.

## Development branch lifecycle

Short-lived development branches use prefixes such as `feat/`, `fix/`, `codex/`, `chore/`, `refactor/`, `test/`, `ui/`, and `hardening/`.

After a change reaches `main`, the housekeeping workflow removes a short-lived branch only when there is conclusive merge evidence. It accepts either normal Git ancestry or, for squash/rebase merges, a merged pull request targeting `main` whose recorded head SHA exactly matches the branch's current tip. A reused branch with newer commits is therefore not deleted accidentally.

Historical `release/*` branches and unknown branch names are intentionally left untouched by automatic cleanup. Version tags and release assets remain independent of development-branch cleanup.
