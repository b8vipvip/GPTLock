# 更新与发布 / Updates & Releases

> 默认中文，English follows.

## Windows 更新

扩展弹窗中的“检查更新”现在是单步更新入口：点击后会检查 GitHub 最新正式 Release；如果发现新版本，会直接自动下载 `GPTLockSetup-x64.exe`、使用 Release 提供的 SHA-256 digest 交给本地核心校验，并以 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` 静默安装。整个检查→下载→校验→安装→等待新版 Core 恢复→重新加载扩展流程不再要求第二次点击“立即更新”或确认安装。

更新流程会把 `update_check_started`、`update_check_completed`、`update_auto_install_triggered`、`update_download_started`、`update_install_started`、`update_completed` / `update_failed` 等事件写入运行日志，便于诊断是否真正触发更新。

也可以从开始菜单运行“检查 GPTLock 更新”，或执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\GPTLock\tools\Update-GPTLock.ps1"
```

脚本同样读取 GitHub 最新 Release，下载 `GPTLockSetup-x64.exe` 和 `SHA256SUMS.txt`，校验 SHA-256 后运行安装器。静默更新可添加 `-Silent`。脚本会沿用当前安装根目录，所以 `D:\AI\GPTLock` 等自定义位置不会在更新时退回 `%LOCALAPPDATA%`。更新完成后完全退出并重启浏览器；如扩展管理页未自动重新加载文件，点击扩展卡片上的“重新加载”。

也可以手动下载新版 Setup 覆盖安装。策略保存在浏览器同步存储和用户 `.gptlock` 目录，覆盖安装与正常卸载不会自动删除审计数据。

## Debian/Ubuntu 更新

安装 `.deb` 后可执行：

```bash
gptlock-update
```

更新器从 GitHub 最新 Release 下载 amd64 `.deb` 与校验和，验证后调用 `sudo dpkg -i`。由于系统包安装需要 sudo 权限，扩展弹窗在 Linux 上发现新版时仍会打开正式发布页，而不会绕过系统权限静默安装。也可手动执行：

```bash
sudo apt install ./gptlock_<新版本>_amd64.deb
systemctl --user daemon-reload
systemctl --user try-restart gptlock-core.service
```

之后完全重启浏览器，必要时在扩展页点击“重新加载”。

## 源码安装更新

先确认工作区没有未提交修改，再拉取并重新构建：

```bash
git pull --ff-only
cargo test --locked --manifest-path native-core/Cargo.toml --all-targets
cargo build --locked --release --manifest-path native-core/Cargo.toml
./packaging/linux/install.sh
```

Windows 重新运行：

```powershell
cargo test --locked --manifest-path native-core/Cargo.toml --all-targets
cargo build --locked --release --manifest-path native-core/Cargo.toml
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\windows\Install-GPTLock.ps1 -InstallRoot 'D:\AI\GPTLock'
```

固定 manifest public key 保证官方源码/安装包的 unpacked 扩展 ID 不变。如果自行修改或删除 manifest 的 `key`，必须重新登记 Native Messaging 的 `allowed_origins`。

## 维护者发布流程

1. 更新 `native-core/Cargo.toml`、`native-core/Cargo.lock`、`extension/manifest.json`、`extension/package.json` 和 Inno 默认版本；
2. 运行全量测试并让 Pull Request CI 全部通过；
3. 合并到 `main`；Release 工作流会等待同一提交的主分支 CI 成功，若 `v<版本>` 尚未发布，则自动创建 tag 和正式 Release；
4. 如需手工发布，也可创建与代码版本一致的签名或普通 tag，例如：

   ```bash
   git tag -a v0.4.4 -m "GPTLock v0.4.4"
   git push origin v0.4.4
   ```

5. `.github/workflows/release.yml` 会在 Ubuntu/Windows 分别构建 `.deb`、Linux tarball、扩展 ZIP 和 Setup，生成 `SHA256SUMS.txt`，再创建 GitHub Release。已存在的同版本 Release 会安全跳过，tag 指向其它提交时会失败而不是覆盖。

Release 工作流在 tag、Cargo 与扩展版本不一致时停止，不会发布混合版本。安装器当前提供 SHA-256 完整性验证；若未来配置代码签名证书，应同时对 Windows Setup 和发布 tag 做签名并在此文档记录验证方式。

## English

On Windows, the popup's **Check update** button is now a one-step update action. It checks the latest GitHub Release and, when a newer version exists, automatically downloads the verified installer, asks the Native Core to validate its SHA-256 digest, launches the installer in fully silent mode, waits for the updated Core, and reloads the extension. No second “Install now” click or installer confirmation is required. Update lifecycle events are also written to runtime logs for diagnostics.

The Start-menu `Update-GPTLock.ps1` path remains available and preserves custom installation roots such as `D:\AI\GPTLock`. On Debian/Ubuntu, run `gptlock-update`; the popup does not bypass sudo/package-manager authorization.

Source installs update by pulling, testing, rebuilding, and rerunning the platform installer. The committed public manifest key keeps the official unpacked extension ID stable.

Maintainers update every version field, pass PR CI, and merge to `main`. For an unpublished version, the Release workflow waits for successful push CI on the same commit, creates the matching tag, builds platform assets, generates checksums, and publishes them through GitHub Releases. A matching `v*` tag may still be pushed manually. Existing releases are skipped safely, while mismatched tag/source commits fail closed.
