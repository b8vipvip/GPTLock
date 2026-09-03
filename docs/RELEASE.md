# GPTWork Release Checklist / 正式发布检查清单

## 中文

正式发布前必须满足以下条件：

1. 所有版本声明保持一致，包括 `extension/manifest.json`、Rust crate、安装包与发布脚本引用的版本号。
2. 修改 `native-core/Cargo.toml` 的 package version 后，必须同步提交 `native-core/Cargo.lock` 中 `gptwork-core` 的版本；CI 使用 `--locked`，不允许发布流程临时改写锁文件。
3. `main` 的最终发布提交必须来自已合并 PR，以通过 repository housekeeping 的 PR-only main governance 检查。
4. CI、License Server CI（适用时）和 repository governance 必须成功后，Release workflow 才能发布正式资产。
5. 发布后必须核对 GitHub Release 的版本、目标提交和全部资产名称，再把该版本视为正式发布。

## English

Before a production release:

1. Keep every version declaration consistent, including `extension/manifest.json`, Rust crates, installers, and release-script references.
2. Whenever the package version in `native-core/Cargo.toml` changes, commit the matching `gptwork-core` version in `native-core/Cargo.lock`. CI intentionally uses `--locked`; release jobs must not rewrite the lockfile implicitly.
3. The final release commit on `main` must come from a merged pull request so the repository's PR-only main governance check succeeds.
4. CI, License Server CI when applicable, and repository governance must succeed before the Release workflow publishes production assets.
5. After publishing, verify the GitHub Release version, target commit, and complete asset set before treating the version as production-ready.
