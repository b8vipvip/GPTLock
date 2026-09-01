# 更新与发布 / Updates & Releases

GPTLock 的正式客户端更新统一经过官网更新服务，不要求插件直接访问私有 GitHub 仓库。

## 用户更新

正式链路为：

`GitHub Release → GPTLock 服务端镜像并校验 → gptlock.mv3.cn 官网发布 → 插件后台收到版本变化 → 客户端更新`

- Windows：安装过具备安全更新能力的 GPTLock Core 后，插件后台会通过官网通知通道与定时兜底检查发现新版本，从官网镜像下载安装器，校验 SHA-256，再由本地 Core 启动静默安装并确认新 Core 已运行；
- Linux：`gptlock-update` 只从 `gptlock.mv3.cn` 的服务端镜像下载 `.deb` 与 `SHA256SUMS.txt`，同时校验版本源中的 SHA-256 与校验文件。由于系统包安装需要系统权限，仍由操作系统的 `sudo/dpkg` 权限边界负责提权；
- 官网版本页直接展示服务端已经完整镜像成功的正式版本与下载文件。镜像未完整校验成功的版本不会进入官网版本索引。

更新完成后如果浏览器仍显示旧界面，完全退出并重新打开浏览器。

## 服务端 Release 镜像

服务端使用只读仓库凭据轮询私有 GitHub 正式 Release。每次发现新版本时：

1. 下载该 Release 的全部资产到持久化镜像目录；
2. 校验 GitHub 提供的 SHA-256（存在时）并重新计算本地 SHA-256；
3. 只有全部资产成功下载并通过校验后，才原子更新官网版本索引；
4. 客户端下载 URL 始终使用 `https://gptlock.mv3.cn/downloads/releases/...`；
5. 版本索引 generation 变化后，等待中的插件通知请求会立即返回；Chrome MV3 后台同时保留周期性检查作为断线兜底。

仓库只读 token 只存在于服务端环境，不进入官网 JSON、浏览器扩展、下载 URL、客户端日志或发行包。

生产环境需要为服务进程配置持久化镜像目录和只读 GitHub token。默认同步间隔为 60 秒；可通过 `GPTLOCK_RELEASE_SYNC_INTERVAL_MS` 调整。镜像目录可通过 `GPTLOCK_RELEASE_MIRROR_DIR` 指定。

## 服务端源码更新

GPTLock 管理后台原有的服务端源码更新与 Release 镜像是两条独立链路：前者更新正在运行的服务端程序，后者同步并发布客户端发行资产。两者不共享浏览器端权限，也不改变现有的服务端特权边界。

## 正式发布

正式版本由仓库受控 CI / Release 流程生成，包括 Windows Setup、Linux 软件包、扩展发行文件、本地组件发行文件及 SHA-256 校验信息。Release 创建完成后，服务端镜像器自动接管后续官网发布，不需要插件访问 GitHub。

## English

GPTLock client updates use an official server-mirror channel: GitHub Release artifacts are downloaded and verified server-side, atomically published on `gptlock.mv3.cn`, and then discovered by the extension through a long-poll notification channel with periodic MV3 alarm fallback. Windows clients with a hardened Native Core can download the mirrored installer, verify SHA-256, install it silently, confirm the updated Core, and reload the extension. Linux updates also use only the official server mirror while preserving the operating system privilege boundary for package installation. Repository credentials remain server-side only.
