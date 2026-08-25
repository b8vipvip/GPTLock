# GPTLock

> 默认文档语言：中文；英文说明见下半部分。
> Default documentation language: Chinese; English follows.

GPTLock 是面向 `chatgpt.com` 官方网页聊天的模型策略锁定与状态验证工具，支持 Windows/Linux 上的 Chrome、Chromium 和 Edge。它由 Manifest V3 浏览器扩展与 Rust 本地核心组成，不使用 Worker 模式，不调用 OpenAI API。

## 当前状态

**Phase 2 已实现：本地核心、Native Messaging、扩展策略同步、本机 API、审计日志和跨平台 CI。**

本阶段已经建立“证据来源分级”基础，但尚未把 ChatGPT 网络响应中的模型元数据采集器接入扩展，因此不能把页面显示的 `GPT-5.6 Sol` 声明为后端真实模型。页面 DOM 证据会明确返回 `unverified`。网络响应元数据采集和发送前阻断属于后续 Phase 4。

## 能做与不能做

GPTLock 可以：

- 保存多个允许模型和多个推理强度；
- 在扩展与本地核心之间同步策略；
- 对带来源标记的观测证据执行 `verified / mismatch / unverified` 三态判断；
- 在严格模式下为不匹配或证据不足返回 `block` 决策；
- 记录不含聊天正文和令牌的 JSONL 审计日志；
- 在 Windows/Linux 上通过 Chromium Native Messaging 通信。

GPTLock 不能：

- 绕过 ChatGPT 套餐、额度、区域或账号限制；
- 修改 OpenAI 服务端模型路由；
- 仅凭模型菜单、DOM 文字或模拟点击证明后端实际使用了某个模型；
- 承诺 OpenAI 未公开或未稳定提供的内部模型标识永远不变。

## 架构

```text
ChatGPT 官方网页
       │ 页面状态（提示级证据；后续接入响应元数据）
       ▼
Manifest V3 扩展
       │ Chromium Native Messaging（长度前缀 JSON）
       ▼
GPTLock Rust 本地核心
       ├── 策略验证器
       ├── 127.0.0.1:17856 本机 API
       └── ~/.gptlock/logs/audit.jsonl
```

详细设计见 [架构说明](docs/ARCHITECTURE.md)、[安全边界](docs/SECURITY.md) 和 [Native Messaging 协议](docs/NATIVE_MESSAGING.md)。

## 快速开发验证

要求：Rust stable、Node.js 22+、Chrome/Chromium/Edge。

```bash
cargo test --manifest-path native-core/Cargo.toml --all-targets
cargo build --release --manifest-path native-core/Cargo.toml
cd extension && npm test
```

在浏览器扩展管理页启用“开发者模式”，选择“加载已解压的扩展程序”，加载 `extension/`。记下 32 位扩展 ID，然后安装本地核心：

Linux：

```bash
./packaging/linux/install.sh --extension-id <扩展ID>
```

Windows PowerShell：

```powershell
.\packaging\windows\Install-GPTLock.ps1 -ExtensionId <扩展ID>
```

安装后完全退出并重新启动浏览器。开发安装细节见 [本地核心文档](native-core/README.md)。

## 验证语义

| 证据来源 | 可信度 | 匹配时结果 | 说明 |
|---|---:|---|---|
| `network_response_metadata` | 高 | `verified` | 来自当前服务端网络响应的模型元数据 |
| `conversation_response_metadata` | 中 | `verified` | 来自当前会话服务端响应元数据 |
| `page_dom` | 低 | `unverified` | 页面文字可能只是选择状态 |
| `user_selection` | 低 | `unverified` | 用户选择不等于服务器实际路由 |
| `unknown` | 无 | `unverified` | 无可验证来源 |

任一已观测模型或推理强度不在策略中时返回 `mismatch`。严格模式将 `mismatch` 和 `unverified` 映射为 `block`；提醒模式映射为 `warn`。

## 本机 API

默认监听 `127.0.0.1:17856`：

- `GET /health`：无需令牌；
- `GET /policy`：读取策略；
- `PUT /policy`：更新策略；
- `POST /verify`：验证一次观测；
- `GET /status`：运行状态与最近验证。

除 `/health` 外均要求 `Authorization: Bearer <token>` 或 `X-GPTLock-Token`。令牌保存在 `~/.gptlock/api.token`，不要提交或分享。

## 路线图

- [x] Phase 1：扩展与策略框架
- [x] Phase 2：Rust Native Core、Native Messaging、Windows/Linux CI
- [ ] Phase 3：扩展状态面板与策略体验完善
- [ ] Phase 4：当前请求响应元数据采集、证据关联、发送前阻断
- [ ] Phase 5：签名安装包、自动升级和正式发布

---

## English

GPTLock is a model-policy guard and evidence-based status verifier for official `chatgpt.com` web chats. It supports Chrome, Chromium, and Edge on Windows and Linux. It does not use Worker mode or the OpenAI API.

Phase 2 implements the Rust local core, Native Messaging, policy synchronization, loopback API, privacy-conscious audit log, installers, and cross-platform CI. It does **not** yet capture ChatGPT response metadata, so visible UI text is intentionally classified as `unverified`, never as proof of the backend model.

GPTLock can compare source-labelled observations with a local policy and return `verified`, `mismatch`, or `unverified`. Strict mode maps mismatches and insufficient evidence to a `block` decision; warning mode returns `warn`. It cannot bypass service limits, change OpenAI routing, or prove a backend model from a menu selection or DOM label.

Build and test:

```bash
cargo test --manifest-path native-core/Cargo.toml --all-targets
cargo build --release --manifest-path native-core/Cargo.toml
cd extension && npm test
```

Load `extension/` as an unpacked extension, copy its 32-character ID, then run the Linux or Windows installer shown above. Restart the browser completely after installation.

The optional API listens only on `127.0.0.1:17856`. `/health` is public locally; `/policy`, `/verify`, and `/status` require the random token stored in `~/.gptlock/api.token`. See the linked architecture, security, protocol, and Native Core documents for full bilingual details.
