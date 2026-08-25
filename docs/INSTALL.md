# 安装方法 / Installation

> 默认中文，English follows. 当前发布目标为 Windows x64 与 Debian/Ubuntu amd64。

## 从 GitHub Release 安装（推荐）

发布页：<https://github.com/b8vipvip/GPTLock/releases>

每个正式版本应包含：

| 文件 | 用途 |
|---|---|
| `GPTLockSetup-x64.exe` | Windows x64 安装器 |
| `gptlock_<版本>_amd64.deb` | Debian/Ubuntu amd64 安装包 |
| `gptlock-extension-<版本>.zip` | 仅扩展运行文件 |
| `gptlock-core-<版本>-linux-x64.tar.gz` | 独立 Linux 本地核心 |
| `SHA256SUMS.txt` | 所有发布制品的 SHA-256 |

若版本尚未创建 Release，可在对应 Pull Request 的绿色 CI Run 页面下载同名 Actions artifacts 进行测试。

## Windows 10/11 x64

> 只在 `chrome://extensions` 加载源码目录不会安装 Native Core。若弹窗显示 `Specified native messaging host not found`，必须先运行 Windows Setup；0.3.1 起弹窗会直接提供安装入口。

1. 下载 `GPTLockSetup-x64.exe` 和 `SHA256SUMS.txt`。可选地验证哈希：

   ```powershell
   (Get-FileHash .\GPTLockSetup-x64.exe -Algorithm SHA256).Hash.ToLower()
   ```

   将结果与 `SHA256SUMS.txt` 对应行比较。

2. 运行安装器。它以当前用户身份安装到：

   ```text
   %LOCALAPPDATA%\GPTLock\
   ├── bin\gptlock-core.exe
   ├── extension\
   ├── native-messaging\
   └── tools\Update-GPTLock.ps1
   ```

   安装器同时为当前用户登记 Chrome 与 Edge Native Messaging 主机，不需要管理员权限。

3. 打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择：

   ```text
   %LOCALAPPDATA%\GPTLock\extension
   ```

4. 确认浏览器显示的扩展 ID 为：

   ```text
   bhchcpeodphgjfjoookncemnamdbfcof
   ```

5. 完全退出所有 Chrome/Edge 进程，再重新启动。打开 `chatgpt.com`，点击 GPTLock 图标，确认“本地核心已连接”和“网络验证已连接”。

若仍显示本地核心离线，可从开始菜单运行“修复 GPTLock 浏览器连接”，或执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\GPTLock\tools\Repair-GPTLock.ps1"
```

修复脚本会重新生成 Native Messaging 清单、登记 Chrome/Edge 当前用户注册表项，并验证核心、路径、扩展 ID 与清单内容。

浏览器不会允许普通本地安装器静默安装未上架商店的扩展，因此仍需手动执行一次“加载已解压”。这是预期行为，不应通过篡改浏览器策略绕过。

## Debian/Ubuntu amd64

1. 下载 `.deb` 和 `SHA256SUMS.txt`，验证并安装：

   ```bash
   sha256sum gptlock_<版本>_amd64.deb
   sudo apt install ./gptlock_<版本>_amd64.deb
   ```

2. 可选地启用本机 HTTP API 的 systemd 用户服务：

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now gptlock-core.service
   curl http://127.0.0.1:17856/health
   ```

   Native Messaging 会按需启动本地核心，因此即使不启用此服务，扩展与核心通信仍可工作。

3. 在 `chrome://extensions`、`edge://extensions` 或 Chromium 扩展页开启开发者模式，加载：

   ```text
   /usr/share/gptlock/extension
   ```

4. 确认固定扩展 ID，然后完全重启浏览器。

`.deb` 会安装系统级 Native Messaging 清单到 Chrome、Chromium 和 Edge 的标准目录。如果某个发行版使用非标准浏览器目录，可改用下方的用户级源码安装脚本。

## 从源码安装

```bash
git clone https://github.com/b8vipvip/GPTLock.git
cd GPTLock
cargo build --locked --release --manifest-path native-core/Cargo.toml
```

Linux 用户级安装：

```bash
./packaging/linux/install.sh
```

扩展会复制到 `~/.local/share/gptlock/extension`。Windows PowerShell 用户级安装：

```powershell
.\packaging\windows\Install-GPTLock.ps1
```

扩展会复制到 `%LOCALAPPDATA%\GPTLock\extension`。两种脚本默认使用固定扩展 ID；只有维护自定义 manifest key 时才需要传入 `--extension-id` 或 `-ExtensionId`。

## 安装诊断

```bash
gptlock-core doctor
```

Windows：

```powershell
& "$env:LOCALAPPDATA\GPTLock\bin\gptlock-core.exe" doctor
```

诊断输出不包含 API 令牌或聊天正文。用户数据位于 Linux `~/.gptlock` 或 Windows `%USERPROFILE%\.gptlock`。

## English

Download the Windows x64 Setup or Debian/Ubuntu amd64 package from GitHub Releases and verify it against `SHA256SUMS.txt`. Windows installs under `%LOCALAPPDATA%\GPTLock`; Linux installs the core to `/usr/bin` and the extension to `/usr/share/gptlock/extension`.

In the browser, enable Developer mode and use **Load unpacked** on the installed extension directory. Verify the stable ID `bhchcpeodphgjfjoookncemnamdbfcof`, then fully restart the browser. Loading the extension directory alone does not install the Native Core. If Chromium reports `Specified native messaging host not found`, run Setup or the installed `Repair-GPTLock.ps1`. A normal local installer cannot silently install an unpacked, non-store Chromium extension, so this one manual browser step is intentional.

The Linux systemd user unit is optional because Native Messaging launches the core on demand. Enable it only when the loopback HTTP API should stay available. Source installation scripts are also provided for per-user development installs.
