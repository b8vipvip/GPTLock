# 使用方法 / Usage

> 默认中文，English follows.

## 首次配置

1. 打开扩展的“设置”。默认策略是：

   - 锁定模型：`gpt-5.6-sol`
   - 允许推理强度：`medium`、`high`、`extra-high`
   - 首选推理强度：`high`
   - 模式：严格
   - 网络响应验证：开启
   - 页面选择自动对齐：开启（尽力而为）
   - 首次请求：自动允许一次探测

2. 按需要勾选模型与推理强度。自定义模型必须使用 ChatGPT 响应元数据实际暴露的标识；不要把显示名称当成已确认的后端标识。

3. 点击“保存并同步”，确认 Native Core 在线。

## 日常使用流程

1. 打开 `https://chatgpt.com/` 并进入一个聊天。
2. GPTLock 会尝试把页面选择对齐到策略中的第一个模型和首选推理强度。这个自动点击只是便利功能，不是验证证据。
3. 页面左下角 GPTLock 指示器应显示“可探测”。如果显示“选择不符”，先手动调整模型/推理菜单。
4. 发送第一条消息。严格模式允许这一条探测请求后立即阻止再次发送，并显示“验证中”。
5. 响应结束后：

   - `已验证 / Verified`：响应元数据同时包含允许的模型和推理强度；可发送下一条；
   - `不匹配 / Mismatch`：至少一个实际元数据值不在策略中；严格模式继续阻断；
   - `未验证 / Unverified`：元数据缺失、冲突、无法读取或已过期；严格模式继续阻断。

页面模型或推理强度没有显示时，GPTLock 会标记为“页面选择未知”，不再误称为明确策略冲突。此时可以手动“允许一次探测”；但若页面已经检测到不允许的值，手动探测仍不会绕过该冲突。

每次允许发送后都会重新进入等待状态，避免把上一轮证据直接当成当前请求的证明。切换会话或修改页面模型/推理选择也会重置状态。

## 弹窗状态

| 字段 | 含义 |
|---|---|
| Native Core | Rust 本地核心与扩展的 Native Messaging 连接 |
| Network verifier | 当前标签页的 Chrome DevTools Protocol 网络连接 |
| Page selection | 页面 DOM 看到的模型/推理，仅用于预检 |
| Response evidence | 最近一个关联响应经过本地核心验证的模型/推理 |

常见徽章：`OK` 已验证，`!` 不匹配/明确预检冲突，`?` 页面信息不完整，`…` 等待响应，`1` 可发送一次探测，`OFF` 核心或验证器未连接。

“允许一次探测”按钮只授权下一条请求，不会把请求提前标记为已验证。若设置为“首次默认阻断”，必须使用该按钮才能开始一个新会话的验证链路。页面暂时无法显示某个字段时，手动探测可以在“没有已知冲突”的前提下启动验证；它绝不会覆盖一个明确不在策略内的页面值。

## 严格模式与提醒模式

- **严格**：验证器离线、页面预检不符、等待响应、`mismatch` 或 `unverified` 时拦截发送按钮、Enter 发送和表单提交。
- **提醒**：不阻止发送，但仍显示状态并写入审计结果。

如果 ChatGPT 当前协议不向网页返回足够的模型/推理元数据，严格模式会按设计保持阻断。可以临时切换提醒模式继续聊天，但这不等于已验证。

## Chrome/Edge 调试提示

网络验证需要扩展的 `debugger` 权限，浏览器可能显示“正在调试此浏览器”提示。同一标签页打开 DevTools 会使 GPTLock 的调试连接断开，状态随即降级为未验证。关闭 DevTools 后，从 GPTLock 弹窗点击“重新连接”。

## 审计日志

位置：

```text
Linux:   ~/.gptlock/logs/audit.jsonl
Windows: %USERPROFILE%\.gptlock\logs\audit.jsonl
```

日志记录时间、请求 ID、模型、推理强度、证据来源、可信度、判定、原因和策略 revision。它不记录提示词、回答正文、Cookie、登录信息、Authorization 或完整响应体。达到 10 MiB 时保留一份轮换文件 `audit.1.jsonl`。

## 本机 API（可选）

启动 `gptlock-core serve` 后监听 `127.0.0.1:17856`。`/health` 无需认证，其余接口使用 `.gptlock/api.token`：

```bash
curl http://127.0.0.1:17856/health
GPTLOCK_TOKEN="$(tr -d '\r\n' < "$HOME/.gptlock/api.token")"
curl -H "Authorization: Bearer $GPTLOCK_TOKEN" http://127.0.0.1:17856/status
```

## English

Configure allowed models, reasoning levels, enforcement mode, preferred reasoning, network verification, UI alignment, and the first-request policy from Settings. The default is strict `gpt-5.6-sol` with medium/high/extra-high allowed and high preferred.

A first request is a probe because no response exists yet. After each allowed send, GPTLock waits for the correlated response. Matching model and reasoning response metadata yields `verified`; disallowed values yield `mismatch`; missing, conflicting, stale, or unreadable metadata yields `unverified`. Strict mode blocks future sends in every state except verified or an explicitly allowed probe. Warning mode reports but does not block.

UI alignment and DOM labels are preflight-only. Missing UI fields are shown as unknown and may be manually probed; explicitly disallowed values cannot be overridden. Opening DevTools on the same tab detaches GPTLock's debugger session; close DevTools and click Reconnect. Audit logs contain only minimal metadata and never chat content or credentials.
