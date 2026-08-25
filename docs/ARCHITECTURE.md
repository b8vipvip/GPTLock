# 架构说明 / Architecture

> 默认中文，English follows.

## 组件边界

1. **ChatGPT 内容脚本**：只采集与模型/推理选择相关的最小页面状态，不读取聊天正文。当前 DOM 证据固定为低可信度。
2. **MV3 Service Worker**：保存策略、管理 Native Messaging 连接、关联请求与响应、维护扩展状态徽章。
3. **Rust Native Core**：规范化策略、执行三态验证、持久化策略与审计日志，并提供令牌保护的 loopback API。
4. **安装层**：为 Chrome/Chromium/Edge 注册 Native Messaging 主机；Linux 可同时启用 systemd 用户服务。

```text
chatgpt.com
    │ page_dom（当前）/ response metadata（Phase 4）
    ▼
content.js ── chrome.runtime messaging ──► background.js
                                                │
                                      Native Messaging JSON
                                                ▼
                                         gptlock-core
                                      ┌─────────┴─────────┐
                                      │                   │
                                config + audit     loopback HTTP API
```

## 策略来源与一致性

扩展的 `chrome.storage.sync.policy` 是用户界面编辑来源。本地核心收到 `set_policy` 后执行严格校验和规范化，再原子写入 `~/.gptlock/config.json`。每次验证和 API 读取都会重新加载配置，最近验证同时写入 `status.json`，因此 Native Messaging 进程与 systemd/API 进程共享同一磁盘策略与最近状态。策略 revision 是规范化 JSON 的稳定 FNV-1a 标识，用于审计关联，不用于加密安全。

## 验证状态机

- **Verified**：模型、推理强度均匹配，证据来自当前网络响应或会话响应元数据，且时间未过期。
- **Mismatch**：已观测模型或推理强度不在允许列表。
- **Unverified**：字段缺失、证据仅来自 DOM/用户选择、来源未知或证据过期。

严格模式：`verified → allow`，其余状态 `→ block`。提醒模式：`verified → allow`，其余状态 `→ warn`。

这里的 `block` 是本地策略决策。Phase 2 尚未把它绑定到 ChatGPT 发送动作；Phase 4 必须在建立当前请求与响应证据关联后执行阻断，避免使用陈旧证据。

## Phase 4 接入约束

网络采集器必须满足：

- 只采集模型、推理强度、请求 ID、会话 ID 哈希和时间戳，不采集提示词/回答正文；
- 把证据与当前发送动作绑定，不能使用上一轮结果；
- 元数据不存在时返回 `unverified`，不能回退到 UI 文字并标记为 `verified`；
- OpenAI 前端协议变化时安全失败（fail closed in strict mode），同时给出可理解的诊断原因；
- 不安装 TLS 根证书、不进行中间人解密、不修改 OpenAI 返回内容。

## English

The content script observes only minimal model/reasoning UI state. The MV3 service worker owns policy synchronization and Native Messaging. The Rust core validates and persists policy, evaluates evidence, writes redacted audit records, and exposes an authenticated loopback API. Installers register the host for Chromium browsers.

The extension's synchronized policy is the editing source. The core validates and writes it to disk; every verification reloads that disk policy so independent Native Messaging and API processes remain consistent. A deterministic policy revision is used for correlation, not cryptographic security.

Verification has three states: `verified` for fresh matching response metadata, `mismatch` for an observed disallowed value, and `unverified` for missing, weak, unknown, or stale evidence. Phase 2 returns decisions but does not yet bind `block` to ChatGPT's send action. Phase 4 must correlate each send with current response evidence, collect no chat bodies, fail safely when protocols change, and never install a TLS interception certificate.
