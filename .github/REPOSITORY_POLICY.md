# GPTLock repository governance

## main branch

`main` is the release branch. Changes should enter `main` only through a merged pull request after the repository CI checks have passed.

Direct pushes to `main` are treated as a policy violation. `.github/workflows/repository-housekeeping.yml` audits every `main` push and reports a failed check when the resulting commit is not associated with a merged pull request.

GitHub-native branch protection/rulesets remain the preferred hard enforcement layer because a workflow can detect a direct push only after it has happened. The intended native policy is:

- require changes to enter `main` through pull requests;
- require the repository CI checks before merge;
- disallow force pushes and deletion of `main`;
- keep administrators subject to the same normal merge path unless emergency recovery is required.

## Development branch lifecycle

Short-lived branches use one of these prefixes: `feat/`, `fix/`, `codex/`, `chore/`, `refactor/`, or `test/`.

After a change reaches `main`, the housekeeping workflow removes a short-lived branch only when Git proves that the branch tip is already an ancestor of the current `main` commit. Unmerged branches are never deleted by the workflow. Long-lived or unknown branch names are left untouched.
