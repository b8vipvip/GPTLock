# GPTLock

> v0.3.9: preserves verified backend model/reasoning evidence for the same turn even when later metadata-empty frames arrive, while scoping that proof so it cannot leak into a newer request.

> v0.3.8: parses nested WebSocket `encoded_item` SSE response metadata (`resolved_model_slug` / `thinking_effort`), improves composer-scoped UI observation, and moves the floating status badge to the bottom-right.

> 默认文档语言：中文；English summary follows.

GPTLock 是专用于 `chatgpt.com` 官方网页聊天的模型请求锁定与响应证据确认工具，支持 Windows/Linux 上的 Chrome、Chromium 和 Edge。它由 Manifest V3 扩展与 Rust 本地核心组成，不使用 OpenAI API，不代理 HTTPS，也不尝试绕过套餐、额度、区域或账号限制。

当前版本：`0.3.9`。本版修复同一轮聊天已经取得真实后端模型/推理元数据后，又被后续不含模型字段的 WebSocket/SSE 帧覆盖成“确认不足”的问题；已确认结果只在同一轮请求内保持有效，新一轮请求不会继承上一轮证据。请求锁定与响应确认仍然分层：模型请求锁定可以成功，而服务端若未暴露可验证模型/推理元数据，响应状态仍保持 `unverified`，不会伪造成功。

## 核心能力

- 默认锁定 `gpt-5.6-sol`，也可配置多个允许模型；
- 支持 `low / medium / high / extra-high` 推理强度，并设置优先强度；
- 只把以下两个正式聊天 POST 当作需要锁定的请求：
  - `/backend-api/conversation`
  - `/backend-api/f/conversation`
- `prepare`、`init` 等辅助请求不再被误判为正式聊天请求；
- 通过 Chrome DevTools Protocol `Fetch` 在正式 POST 发出前检查顶层 `model`，必要时改写为锁定模型；
- 如果正式请求已经存在可识别的顶层推理强度字段，GPTLock 可把不允许的值改为优先允许值，但不会凭空伪造网页本来没有发送的字段；
- 已知 `gpt-5.6-sol-wm` 是 `gpt-5.6-sol` 的传输别名；`gpt-5-6-thinking` 保持独立，不会被伪装成 Sol；
- 通过 CDP `Network` 关联正式请求与响应，只把响应元数据当作“后端实际暴露状态”的附加证据；
- 默认 fail-open：页面识别缺失、Native Core 离线、响应字段缺失、响应读取错误或验证器异常只告警，不中断正常聊天；
- 强制模式只有在响应元数据明确确认“实际模型不在锁定列表”时，才阻断后续发送；推理强度不匹配仅告警；
- Windows/Linux Native Messaging、本机 API、隐私化审计日志，以及可筛选/清空/导出的扩展运行日志；
- 固定扩展 ID：`bhchcpeodphgjfjoookncemnamdbfcof`，更新后无需重新登记本地主机。

## “锁定”与“验证”分别是什么

GPTLock 0.3.9 把两件事明确分开：

1. **请求锁定**：在网页准备发送正式 ChatGPT conversation POST 时，扩展检查并按策略改写它能够安全识别的顶层模型/已有推理字段，然后立即放行请求。这是日常聊天的主功能。
2. **响应确认**：请求返回后，扩展尝试从响应头或响应正文元数据中提取模型和推理强度，再交给 Native Core 形成 `verified / mismatch / unverified` 审计结果。这只是附加确认，不再作为日常聊天的前置门禁。

因此，用户不需要先“验证成功”才能正常聊天。开启 GPTLock 后直接在 ChatGPT 输入框发送消息即可；如果响应没有暴露足够元数据，界面会显示告警/未确认，但不会因为“证据缺失”把聊天卡死。

## 自动验证

点击 **自动验证 / Auto verify** 后，GPTLock 会自动执行程序能够完成的步骤：

1. 检查 Native Core 和请求锁定器状态；
2. 尽力把当前页面模型/推理选项对齐到策略；
3. 在当前 ChatGPT 输入框写入固定的可见测试消息；
4. 自动点击发送，不需要人工再发送“探针”；
5. 捕获该正式请求的锁定结果和可用的响应证据；
6. 将结果写入运行日志与诊断包。

如果输入框中已有草稿，自动验证会先保存草稿，并在测试消息发出后尽力恢复。

0.3.9 会在**自动验证期间**保存固定测试请求对应的原始 SSE 响应，按 UTF-8 字节合计最多 10 MiB，并随“导出诊断包”写入 `autoVerificationSse.entries[].rawSse`。这样当 ChatGPT 没有被现有解析器识别出模型/推理字段时，可以直接查看服务器实际返回了哪些字段，而不是继续猜字段名。普通聊天的响应正文仍不会被打包；原始 SSE 可能包含测试回答、消息/会话 ID 和服务器元数据，因此分享诊断包前应按包含聊天内容的文件处理。

## 必须理解的边界

GPTLock 可以控制**网页发出的正式请求字段**，但无法承诺 OpenAI 后端一定按请求字段选择某个模型。后端仍可能根据账号权限、额度、产品策略或内部路由拒绝、替换或降级。因此：

- 请求被成功改写为 Sol，表示“网页向服务端发送了 Sol 请求”，不等于密码学证明“服务端一定实际使用了 Sol”；
- 只有服务端向网页返回且可安全解析的响应元数据，才能作为实际响应模型的附加证据；
- 如果 ChatGPT 没有返回模型或推理强度元数据，GPTLock 会显示 `unverified`/告警，而不会伪造 `verified`；
- 如果响应明确暴露了不允许的模型，强制模式可以阻断后续发送；
- GPTLock 不能绕过 ChatGPT 套餐、额度、区域、账号或模型可用性限制，也不能修改 OpenAI Gateway 或内部调度。

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
5. 打开 `chatgpt.com`，在 GPTLock 设置中选择锁定模型/允许推理强度并保存；
6. 日常使用时直接聊天即可；需要诊断时再点击“自动验证”或导出运行日志。

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

CI 在 Ubuntu 和 Windows 编译、测试并上传扩展 ZIP、Linux `.deb`、Windows Setup 和本地核心制品。合并尚未发布的新版本到 `main` 后，Release 工作流会等待该提交的主分支 CI 成功，再创建与源码版本一致的 tag、生成 SHA-256 校验和并发布安装资产；仍支持手工推送匹配的 `v*` tag。

## English

GPTLock 0.3.9 is a request-locking and evidence-verification tool for official `chatgpt.com` web chats. It supports Chrome, Chromium, and Edge on Windows and Linux, uses no OpenAI API, performs no TLS interception, and cannot bypass server-side product limits.

The primary control is the **formal chat request lock**. GPTLock intercepts only `/backend-api/conversation` and `/backend-api/f/conversation`, checks the top-level model before the POST is sent, rewrites a disallowed model to the configured lock target, and only adjusts an already-existing top-level reasoning field. `prepare` and `init` traffic is auxiliary and is never treated as a formal chat send.

Response metadata is supplementary evidence. Missing fields, Native Core outages, DOM-detection gaps, and verifier errors warn but fail open. In strict mode, only a confirmed response-model mismatch blocks subsequent sends. `gpt-5.6-sol-wm` is recognized as the transport alias for `gpt-5.6-sol`; `gpt-5-6-thinking` remains a separate model identifier. A verified backend result remains sticky only for the same request turn, so later metadata-empty frames cannot erase it and a newer request cannot inherit stale proof.

**Auto verify** performs the whole probe flow itself: it best-effort aligns the page, writes a visible fixed test message into the active ChatGPT composer, clicks Send, and captures request/response diagnostics without asking the user to manually send anything.

Request rewriting proves what the official web client sent, not what OpenAI ultimately routed internally. Only response metadata exposed to the browser can provide additional evidence about the served model. See [Installation](docs/INSTALL.md), [Usage](docs/USAGE.md), [Architecture](docs/ARCHITECTURE.md), and [Security](docs/SECURITY.md) for details.

### v0.3.7 stream handoff diagnostics
Automatic verification now follows ChatGPT `stream_handoff` metadata into matched downstream SSE/WebSocket traffic, shares one 10 MiB diagnostic budget across the chain, and no longer probes generic page buttons when the model/reasoning UI value is unknown. The obsolete conversation-detail GET fallback is disabled.
