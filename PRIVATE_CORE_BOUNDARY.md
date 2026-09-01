# GPTLock public/private boundary

GPTLock is moving to a split-source architecture.

## Public side

The public repository is for distribution and interoperability. It can expose what users and integrators need to install, run, update, diagnose at a safe level, and interact with released builds:

- official website and account UI;
- installers, packaging and release metadata;
- browser extension UI and thin integration shell;
- public configuration and compatibility contracts;
- user-facing documentation;
- non-sensitive operational tooling.

## Private side

Implementation-sensitive behavior is not part of the public source contract. It includes proprietary detection, decision, verification, learning, correlation, and privileged runtime behavior.

The public repository must not document or duplicate those internal mechanisms. A public component may send data through a versioned contract and receive a bounded decision/result, but the implementation behind that contract stays private.

## Legacy v0.5.x source

The current public tree still contains implementation code required by the existing v0.5.x build and release path. That code predates the split and is treated as a frozen migration baseline. It remains temporarily so released installations keep building and updating normally.

The migration rule is simple:

1. do not add new proprietary behavior to frozen public-core paths;
2. develop new core behavior privately;
3. expose only the minimum stable contract needed by the public shell;
4. once a private-built artifact replaces a legacy component, delete the legacy public source instead of evolving it further.

Deleting a frozen legacy file is allowed. Modifying it to add or replace proprietary implementation is not.

## Historical limitation

This boundary protects future development. Source that was already published in earlier Git history must be considered disclosed. Removing a file from the current branch does not erase historical commits. A separate repository-history/visibility migration is required if historical source also needs to stop being publicly downloadable.
