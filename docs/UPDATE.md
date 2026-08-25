# 更新与发布 / Updates & Releases

> 默认中文，English follows.

## Windows 更新

从开始菜单运行“检查 GPTLock 更新”，或执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\GPTLock\tools\Update-GPTLock.ps1"
```

脚本读取 GitHub 最新 Release，下载 `GPTLockSetup-x64.exe` 和 `SHA256SUMS.txt`，校验 SHA-256 后运行安装器。静默更新可添加 `-Silent`。脚本会沿用当前安装根目录，所以 `D:\AI\GPTLock` 等自定义位置不会在更新时退回 `%LOCALAPPDATA%`。更新完成后完全退出并重启浏览器；如扩展管理页未自动重新加载文件，点击扩展卡片上的“重新加载”。

也可以手动下载新版 Setup 覆盖安装。策略保存在浏览器同步存储和用户 `.gptlock` 目录，覆盖安装与正常卸载不会自动删除审计数据。

## Debian/Ubuntu 更新

安装 `.deb` 后可执行：

```bash
gptlock-update
```

更新器从 GitHub 最新 Release 下载 amd64 `.deb` 与校验和，验证后调用 `sudo dpkg -i`。也可手动执行：

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
3. 合并到 `main`；
4. 创建与代码版本一致的签名或普通 tag，例如：

   ```bash
   git tag -a v0.3.3 -m "GPTLock v0.3.3"
   git push origin v0.3.3
   ```

5. `.github/workflows/release.yml` 会在 Ubuntu/Windows 分别构建 `.deb`、Linux tarball、扩展 ZIP 和 Setup，生成 `SHA256SUMS.txt`，再创建 GitHub Release。

Release 工作流在 tag、Cargo 与扩展版本不一致时停止，不会发布混合版本。安装器当前提供 SHA-256 完整性验证；若未来配置代码签名证书，应同时对 Windows Setup 和发布 tag 做签名并在此文档记录验证方式。

## English

On Windows, run the Start-menu updater or `Update-GPTLock.ps1`. The updater preserves a custom installation root such as `D:\AI\GPTLock`. On Debian/Ubuntu, run `gptlock-update`. Both retrieve the latest GitHub Release, download the installer plus `SHA256SUMS.txt`, verify SHA-256, and only then install. Fully restart the browser and reload the unpacked extension if necessary.

Source installs update by pulling, testing, rebuilding, and rerunning the platform installer. The committed public manifest key keeps the official unpacked extension ID stable.

Maintainers update every version field, pass PR CI, merge to `main`, and push a matching `v*` tag. The Release workflow builds platform assets, generates checksums, and publishes them through GitHub Releases; mismatched tag and source versions fail closed.
