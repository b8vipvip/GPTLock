# GPTLock repository governance

## main branch

`main` is the release branch. Changes should enter `main` only through a merged pull request after the repository CI checks have passed.

Direct pushes to `main` are treated as a policy violation. `.github/workflows/repository-housekeeping.yml` audits every `main` push and reports a failed check when the resulting commit cannot be verified as coming from a merged pull request targeting `main`.

The Release workflow also waits for both the normal `main` CI and the repository-governance workflow before it is allowed to build and publish a new version. A governance failure therefore prevents an automated official release from that commit.

GitHub-native branch protection/rulesets remain the preferred hard enforcement layer because a workflow can detect a direct push only after it has happened. The intended native policy is:

- require changes to enter `main` through pull requests;
- require the repository CI checks before merge;
- disallow force pushes and deletion of `main`;
- keep administrators subject to the same normal merge path unless emergency recovery is required.

## Development branch lifecycle

Short-lived development branches use prefixes such as `feat/`, `fix/`, `codex/`, `chore/`, `refactor/`, `test/`, `ui/`, and `hardening/`.

After a change reaches `main`, the housekeeping workflow removes a short-lived branch only when there is conclusive merge evidence. It accepts either normal Git ancestry or, for squash/rebase merges, a merged pull request targeting `main` whose recorded head SHA exactly matches the branch's current tip. A reused branch with newer commits is therefore not deleted accidentally.

Historical `release/*` branches and unknown branch names are intentionally left untouched by automatic cleanup. Version tags and release assets remain independent of development-branch cleanup.
