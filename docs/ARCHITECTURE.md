# 架构说明 / Architecture

> 默认中文，English follows.

## 组件

1. **内容脚本 `content.js`**：读取最小页面选择状态，保守地尝试对齐模型/推理菜单，同步发送守卫，并拦截发送按钮、Enter 和表单提交。它不读取聊天正文。
2. **MV3 Service Worker `background.js`**：管理策略、每标签页/会话状态机、Native Messaging、请求关联和徽章。
3. **网络验证器 `network-monitor.js`**：通过 `chrome.debugger` 附加 `chatgpt.com` 标签页，启用 CDP `Network` 域，关联 conversation-like POST、响应头与响应体。
4. **证据提取器 `network-evidence.js`**：只解析白名单元数据键/响应头；提示词与回答字段被跳过，完整正文只在内存中短暂存在并立即丢弃。
5. **Rust Native Core**：规范化策略、执行三态验证、原子持久化策略/状态、写脱敏审计，并提供令牌保护的 loopback API。
6. **安装/发布层**：固定扩展 ID，注册 Chrome/Chromium/Edge Native Messaging，构建 Windows Setup、Linux `.deb`、CI artifacts 和 Release assets。

```text
chatgpt.com 页面
  ├─ DOM 选择（低可信预检）──► 内容脚本 ──► 发送守卫
  └─ 当前网络响应 ──────────► CDP Network ──► 元数据提取
                                                   │
                                                   ▼
                                             MV3 Service Worker
                                                   │ Native Messaging
                                                   ▼
                                             Rust Native Core
                                              ├─ config/status
                                              ├─ audit.jsonl
                                              └─ 127.0.0.1 API
```

## 请求关联

网络验证器只跟踪 `https://chatgpt.com/backend-api/*` 下 conversation、response、message 或 codex 类 POST。每个 CDP `requestId` 关联请求时间、有限请求元数据、响应头和完成后的响应体。写入 Native Core 前，扩展只保留：模型、推理强度、时间和安全字符组成的 `cdp-<tab>-<request>` 标识。

请求体中的模型/推理值属于 `network_request_metadata`，只能帮助预检，不能得到 `verified`。响应完成后，从白名单响应头或 JSON/SSE 元数据抽取值；最高可信候选冲突时清空该字段并降级为 `unverified`。

## 严格发送状态机

| 状态 | 严格模式能否发送 | 转移条件 |
|---|---:|---|
| `probe_ready` | 一次 | 新会话、网络验证器在线且页面选择符合策略 |
| `waiting` | 否 | 探测或已验证后的下一次请求已经开始 |
| `verified` | 一次 | 当前关联响应元数据完整且符合策略 |
| `mismatch` | 否 | 响应模型或推理强度违反策略 |
| `unverified` | 否 | 响应字段缺失、冲突、过期或不可读 |
| `monitor_offline/error` | 否 | CDP/Native Core 断开或处理失败 |

允许发送后会立即本地消费该权限，防止双击或重复 Enter。新会话、策略变化或完整页面选择变化会清除旧证据。提醒模式保持同一验证过程，但不拦截发送。

## 策略与进程一致性

`chrome.storage.sync.policy` 是设置页编辑来源；扩展专用行为存放在独立 `settings` 对象，避免进入 Native Core 的严格策略 schema。本地核心收到 `set_policy` 后校验并原子写入 `~/.gptlock/config.json`。Native Messaging 与可选 API 服务每次验证都重新读取磁盘策略，并通过 `status.json` 共享最近结果。

策略 revision 是规范化 JSON 的稳定 FNV-1a 标识，只用于审计关联，不承担密码学完整性。

## 故障安全

- ChatGPT 协议变化、响应体不可读取或元数据不存在：`unverified`；
- 打开同标签页 DevTools 导致调试器分离：`monitor_offline`；
- Native Core 离线：`error`；
- DOM 选择未知：不允许自动探测；
- 任何服务端限制：向用户展示，不尝试绕过。

## English

The content script performs minimal UI preflight and synchronous send interception. The MV3 worker owns per-tab state and Native Messaging. A `chrome.debugger`/CDP Network monitor correlates ChatGPT backend POST requests with their completed responses, while a pure extractor keeps only whitelisted model/reasoning metadata and immediately discards response bodies.

Request metadata and DOM text are preflight-only. Current response metadata is sent to the Rust core for `verified`, `mismatch`, or `unverified` evaluation. Strict mode grants a single probe or verified send, consumes that grant immediately, and waits for the correlated response; warning mode never blocks. Protocol changes, missing/conflicting metadata, debugger detachment, and core failures all fail safely without fabricating proof.
