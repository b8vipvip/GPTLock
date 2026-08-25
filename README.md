# GPTLock

> 默认文档语言：中文；English summary follows.

GPTLock 是专用于 `chatgpt.com` 官方网页聊天的模型策略锁定与真实状态验证工具，支持 Windows/Linux 上的 Chrome、Chromium 和 Edge。它由 Manifest V3 扩展与 Rust 本地核心组成，不使用 OpenAI API，不代理 HTTPS，也不尝试绕过服务端限制。

当前版本：`0.3.2`。Phase 1–5 的代码已经实现，包括响应元数据采集、严格发送守卫、状态弹窗、Windows Setup、Linux `.deb`、CI 制品、GitHub Release 与校验和更新流程。0.3.2 修复 Chromium 启动 Native Messaging 主机时附加来源参数所导致的协议启动失败，安装/修复流程会执行真实消息往返自检；Windows 还支持自定义安装根目录（例如 `D:\AI\GPTLock`），并修复 Windows PowerShell 5.1 的中文脚本乱码。

## 核心能力

- 默认并优先选择 `gpt-5.6-sol`，也可配置多个允许模型；
- 允许 `low / medium / high / extra-high` 推理强度，并设置首选强度；
- 通过 Chrome DevTools Protocol 关联当前 ChatGPT 请求与完整响应；
- 只把网络/会话响应元数据视为可产生 `verified` 的证据；
- 严格模式在不匹配、未验证、验证器离线或等待响应时阻止后续发送；
- 提醒模式只显示告警和记录审计，不阻止发送；
- Windows/Linux Native Messaging、本机 API 和隐私化 JSONL 审计日志；
- 固定扩展 ID：`bhchcpeodphgjfjoookncemnamdbfcof`，更新后无需重新登记本地主机。

## 必须理解的边界

GPTLock 无法强制 OpenAI 后端使用某个模型。它只能控制网页端策略、执行发送前检查，并验证服务端实际暴露给网页的响应元数据。如果 ChatGPT 没有返回模型或推理强度元数据，GPTLock 会显示 `unverified`，不会使用页面标签伪造 `verified`。

首次请求也无法在服务端响应前被证明。默认策略允许一次“页面选择符合策略”的探测请求，发送后立即进入等待状态；之后只有匹配的响应元数据才会解锁下一次发送。也可配置为首次默认阻断，再从弹窗手动授权一次探测。

GPTLock 不能：

- 绕过 ChatGPT 套餐、额度、区域、账号或模型可用性限制；
- 修改 OpenAI Gateway 或内部路由；
- 从模型菜单、DOM 文字或自动点击推断后端实际模型；
- 对 OpenAI 未向网页暴露的内部调度作密码学证明；
- 保证 ChatGPT 私有前端协议未来不发生变化。

## 安装、使用与更新

- [安装方法（Windows/Linux）](docs/INSTALL.md)
- [使用方法与状态说明](docs/USAGE.md)
- [以后如何更新与发布](docs/UPDATE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [安全与隐私边界](docs/SECURITY.md)
- [Native Messaging 协议](docs/NATIVE_MESSAGING.md)

最短安装流程：

1. 从 GitHub Release 下载 Windows `GPTLockSetup-x64.exe` 或 Linux `gptlock_<版本>_amd64.deb`；
2. 安装后在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式；
3. Windows 加载 `%LOCALAPPDATA%\GPTLock\extension`，Linux 加载 `/usr/share/gptlock/extension`；
4. 确认扩展 ID 为上面的固定 ID，完全重启浏览器；
5. 打开 `chatgpt.com`，在 GPTLock 设置中保存策略，从弹窗检查 Core、Network verifier 和 Response evidence。

## 开发与测试

要求：Rust stable、Node.js 22+、Chrome/Chromium/Edge。Linux 构建 `.deb` 还需要 `dpkg-deb`，Windows Setup 需要 Inno Setup 6。

```bash
node --test extension/tests/*.test.mjs
cargo fmt --manifest-path native-core/Cargo.toml --all -- --check
cargo clippy --locked --manifest-path native-core/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path native-core/Cargo.toml --all-targets
cargo build --locked --release --manifest-path native-core/Cargo.toml
./packaging/linux/build-deb.sh
```

CI 在 Ubuntu 和 Windows 编译、测试并上传扩展 ZIP、Linux `.deb`、Windows Setup 和本地核心制品。推送与版本一致的 `v*` tag 后，Release 工作流生成 SHA-256 校验和并发布安装资产。

## English

GPTLock is a model-policy guard and evidence-based status verifier exclusively for official `chatgpt.com` web chats. It supports Chrome, Chromium, and Edge on Windows and Linux, uses no OpenAI API, performs no TLS interception, and cannot bypass server-side limits or routing.

Version `0.3.2` implements the Rust Native Core, Native Messaging, response-metadata capture through the Chrome DevTools Protocol, per-request correlation, a strict pre-send guard, status popup, bilingual settings, Windows Setup, Linux `.deb`, CI artifacts, tagged releases, checksums, and update scripts. It fixes Chromium-origin command-line handling for native hosts, performs a real framed-message round-trip during Windows installation/repair, supports custom Windows roots such as `D:\AI\GPTLock`, and preserves readable Chinese output in Windows PowerShell 5.1.

Only current response metadata can produce `verified`. UI text and request metadata are preflight evidence only. Missing or conflicting response metadata produces `unverified`; GPTLock never invents a successful result. Since a first request cannot be verified before a response exists, the default allows one policy-matching probe and then waits for evidence.

See [Installation](docs/INSTALL.md), [Usage](docs/USAGE.md), and [Updates](docs/UPDATE.md) for complete bilingual instructions. The fixed unpacked extension ID is `bhchcpeodphgjfjoookncemnamdbfcof`.
