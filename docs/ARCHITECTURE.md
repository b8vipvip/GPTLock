# 架构说明 / Architecture

> 默认中文，English follows.

## 0.3.5 设计原则

GPTLock 0.3.5 将“请求锁定”和“响应确认”拆成两个独立层次：

- **请求锁定是主功能**：正式 ChatGPT conversation POST 在真正发出前，通过 CDP `Fetch` 暂停、检查并在必要时改写顶层模型/已有推理字段，然后立即继续。
- **响应确认是附加证据**：CDP `Network` 关联同一正式请求的响应，只从白名单响应头/JSON/SSE 元数据提取模型与推理强度，再交给 Native Core 审计。
- **验证系统 fail-open**：DOM 缺失、Core 离线、响应元数据缺失、响应解析失败等都只告警，不成为聊天前置门禁。
- **仅已确认的模型不匹配可阻断**：严格模式下，只有响应明确暴露的模型不在锁定列表时，后续发送才被内容脚本拦截。

## 组件

1. **内容脚本 `content.js`**
   - 读取最小页面选择状态；
   - 尽力对齐模型/推理菜单；
   - 同步 Guard 状态并仅在“已确认模型不匹配”时阻止发送按钮、Enter 和表单提交；
   - 实现“自动验证”的可见测试消息写入和自动点击发送；
   - 不读取或持久化聊天历史正文。

2. **MV3 Service Worker `background.js`**
   - 管理策略、总开关、每标签页/会话状态；
   - 管理 Native Messaging；
   - 将当前锁定策略提供给网络监控器；
   - 记录请求改写、响应确认和自动验证状态；
   - 组合脱敏诊断包。

3. **请求/响应监控器 `network-monitor.js`**
   - 通过 `chrome.debugger` 附加 `chatgpt.com` 标签页；
   - 启用 CDP `Fetch`：在 Request 阶段暂停可能的 conversation 请求；
   - 使用精确谓词确认是否为两个正式 POST；
   - 需要时用 `Fetch.continueRequest` 提交修改后的 UTF-8 请求体；
   - 启用 CDP `Network`：跟踪同一正式请求的响应头、状态和响应体。

4. **请求锁定/证据提取器 `network-evidence.js`**
   - 精确识别正式端点；
   - 解析正式请求 JSON；
   - 只改写顶层 `model` 和已经存在的顶层推理字段；
   - 不修改消息正文、附件、会话 ID、父消息 ID 或其他业务字段；
   - 解析响应 JSON/SSE/NDJSON；
   - 跳过 `content / parts / text / prompt / input / arguments` 等正文区域；
   - 从白名单字段/响应头产生最小模型、推理证据。

5. **Guard `guard.js`**
   - 将页面预检、请求锁定器状态、Core 状态和最近响应结果转成可发送/告警/阻断决定；
   - 0.3.5 仅当 Native 结果明确包含 `model_not_allowed` 时，在严格模式返回 `canSend=false`；
   - 其他验证异常全部允许发送并附带告警原因。

6. **Rust Native Core**
   - 规范化策略和模型/推理标识；
   - 将 `gpt-5.6-sol-wm` 规范化为 `gpt-5.6-sol`；
   - 保持 `gpt-5-6-thinking` 独立；
   - 对响应证据生成 `verified / mismatch / unverified`；
   - 原子持久化配置/状态，写脱敏审计，并提供令牌保护的 loopback API。

7. **诊断层 `runtime-log.js` / `diagnostics.*`**
   - 保存有界扩展事件；
   - 保留端点、字段路径、长度、改写结果、HTTP 状态和错误；
   - 脱敏请求体、响应体、提示词、回答、Cookie、Authorization、Token 等；
   - 与 Native Core 审计尾部组合导出 JSON。

8. **安装/发布层**
   - 固定扩展 ID；
   - 注册 Chrome/Chromium/Edge Native Messaging；
   - 构建 Windows Setup、Linux `.deb`、扩展 ZIP、CI artifacts 和 Release assets。

## 数据流

```text
chatgpt.com 页面
  │
  ├─ DOM 模型/推理文字 ──────────────► content.js
  │                                      │
  │                                      ├─ 尽力 UI 对齐
  │                                      ├─ 可见自动验证消息
  │                                      └─ confirmed-model-mismatch 时发送阻断
  │
  └─ 正式 conversation POST
          │
          ▼
     CDP Fetch(Request)
          │
          ├─ 精确端点过滤
          ├─ 解析顶层 model
          ├─ 必要时请求锁定改写
          └─ continueRequest
          │
          ▼
     ChatGPT 服务端
          │
          ▼
     CDP Network(Response)
          │
          ├─ status / headers
          └─ 完成后短暂读取 body
          │
          ▼
   network-evidence.js
          │ 仅白名单模型/推理元数据
          ▼
     background.js
          │ Native Messaging
          ▼
    Rust Native Core
      ├─ verdict/decision
      ├─ audit.jsonl
      └─ 127.0.0.1 API
```

## 正式请求识别

只有满足全部条件才进入请求锁定：

- `https:`；
- 主机严格等于 `chatgpt.com`；
- HTTP 方法严格等于 `POST`；
- pathname 严格等于以下之一：

```text
/backend-api/conversation
/backend-api/f/conversation
```

例如下面这些都不属于正式聊天发送：

```text
/backend-api/f/conversation/prepare
/backend-api/conversation/init
/backend-api/messages
```

`Fetch` 的 URL pattern 可以较宽，以便浏览器能触发暂停事件；真正是否改写由上述精确谓词决定。辅助请求即使被 Fetch pattern 捕获，也会立即原样继续。

## 请求锁定算法

正式请求被暂停后：

1. 获取请求 `postData`；
2. 必须能解析为 JSON object；否则原样 fail-open；
3. 必须存在字符串类型的顶层 `model`；否则原样 fail-open；
4. 将当前模型规范化；
5. 若当前规范化模型已在 `lockedModels` 中，保留原传输值；
6. 若不在列表中，使用第一个锁定模型的已知传输 ID 改写顶层 `model`；
7. 遍历**顶层**已存在的推理字段；只有当前值不允许且能规范化时才改为优先允许强度；
8. 不创建缺失推理字段；
9. JSON 序列化后使用 `Fetch.continueRequest` 放行；
10. 任意改写异常都尝试原样放行，并写技术日志。

Sol 已知映射：

```text
gpt-5.6-sol-wm  -> canonical: gpt-5.6-sol
gpt-5.6-sol     -> transport when rewrite is needed: gpt-5.6-sol-wm
```

`gpt-5-6-thinking` 不参与上述别名映射。

## 响应关联与证据

`Network.requestWillBeSent` 只为精确命中的正式请求建立记录。每个 CDP `requestId` 保存：

- 标签页；
- 起始时间；
- 脱敏端点；
- MIME；
- HTTP 状态；
- 响应头；
- 是否启用响应验证。

响应结束后短暂调用 `Network.getResponseBody`。正文只在内存中用于元数据解析，解析完成立即丢弃。证据提取器：

- 优先白名单响应头；
- 支持 JSON、SSE、NDJSON；
- 只遍历允许的元数据结构；
- 跳过正文内容字段；
- 对最高可信候选冲突进行降级，不随意选一个值；
- 只把模型、推理强度、字段路径和解析诊断传给 Native Core。

请求中的模型/推理属于 `network_request_metadata`，可用于技术诊断，但不会被 Native Core 当成后端响应证明。

## Guard 状态机

0.3.5 不再使用“一次探针额度”作为日常发送门禁。

| 状态 | 严格模式能否发送 | 说明 |
|---|---:|---|
| `lock_ready` | 是 | 请求锁定器就绪 |
| `waiting` | 是 | 已发送，等待响应确认 |
| `verified` | 是 | 响应元数据符合策略 |
| `unverified` | 是 | 响应证据缺失/不足，只告警 |
| `preflight_unknown` | 是 | 页面 DOM 不完整，只告警 |
| `preflight_mismatch` | 是 | UI 与策略不同，网络层仍尝试锁定 |
| `monitor_offline` | 是 | 请求锁定器离线，fail-open 告警 |
| `core_offline` | 是 | Native 审计不可用，fail-open 告警 |
| `error` | 是 | 验证系统异常，fail-open 告警 |
| `mismatch`（仅 reasoning） | 是 | 推理不匹配只告警 |
| `mismatch` + `model_not_allowed` | **否** | 严格模式唯一模型级阻断条件 |
| `disabled` | 是 | GPTLock 全局关闭 |

## 自动验证链路

```text
用户点击 Auto verify
  │
  ├─ refresh Native Core（允许失败）
  ├─ attach CDP Fetch/Network
  ├─ collect page selection
  ├─ 清除旧 mismatch/verification
  ▼
content.js
  ├─ wait idle
  ├─ best-effort UI align
  ├─ 保存已有草稿
  ├─ 写入固定可见测试消息
  ├─ 点击 ChatGPT Send
  └─ 尽力恢复草稿
          │
          ▼
正式 conversation POST
  ├─ 请求锁定
  └─ 可选响应确认
```

整个流程不需要用户再次手工点击“发送探针”。

## 策略与进程一致性

`chrome.storage.sync.policy` 是策略来源；扩展专用行为存放于 `settings`，避免进入 Native Core 的严格策略 schema。Native Core 收到 `set_policy` 后校验并原子写入 `~/.gptlock/config.json`。

策略 revision 是规范化 JSON 的稳定 FNV-1a 标识，只用于审计关联，不承担密码学完整性。

## English

GPTLock 0.3.5 uses two separate layers. CDP **Fetch** is the primary request-lock layer: only the two exact formal conversation POST paths are paused, their top-level model is checked/re-written when needed, already-existing top-level reasoning fields may be aligned, and the request is immediately continued. Auxiliary `prepare` and `init` traffic is never treated as a formal chat send.

CDP **Network** is a supplementary response-evidence layer. It correlates only formal requests, transiently reads completed response bodies, extracts whitelisted model/reasoning metadata from headers/JSON/SSE/NDJSON, discards the body, and asks the Rust core for a verdict. Request metadata and DOM labels never become backend proof.

The Guard is fail-open for DOM gaps, Core outages, debugger detaches, missing response metadata, reasoning mismatches, and verifier errors. In strict mode only a confirmed `model_not_allowed` response result blocks subsequent sends. Auto verify best-effort aligns the page and automatically sends a fixed visible test message; no manual probe send is required.
