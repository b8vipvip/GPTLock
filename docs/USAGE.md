# 使用方法 / Usage

> 默认中文，English follows.

## 首次配置

1. 打开扩展“设置”。0.3.6 默认策略：

   - GPTLock 总开关：开启
   - 锁定模型：`gpt-5.6-sol`
   - 允许推理强度：`medium`、`high`、`extra-high`
   - 首选推理强度：`high`
   - 模式：严格
   - 响应元数据确认：开启
   - 页面选择自动对齐：开启（尽力而为）

2. 按需要勾选模型与推理强度。多个模型同时允许时，列表中的第一个模型是正式请求需要改写时的首选目标。
3. 点击“保存并同步”。Native Core 在线时可同时记录响应审计；即使 Native Core 暂时离线，扩展仍会尝试执行浏览器侧正式请求锁定。

## 日常使用：不需要先验证

0.3.6 不再要求“先验证成功才能聊天”。正常流程是：

1. 打开 `https://chatgpt.com/` 并进入聊天；
2. GPTLock 自动附加当前标签页的请求锁定器；
3. 你直接在 ChatGPT 输入框输入并发送消息；
4. 在正式 conversation POST 发出前，GPTLock 检查顶层 `model`：
   - 已在允许列表中：原样保留；
   - 不在允许列表中：改写为首选锁定模型的已知传输标识；
5. 如果请求顶层已经存在可识别的推理强度字段，GPTLock 会按允许列表/首选强度检查和改写；如果字段不存在，则不会凭空新增；
6. 请求立即继续发送；随后如启用了“响应元数据确认”，GPTLock 再尝试分析关联响应。

目前只把以下两个 POST 视为正式聊天发送：

```text
/backend-api/conversation
/backend-api/f/conversation
```

`/prepare`、`/init` 等辅助请求不会被当作正式聊天发送，也不会触发旧版“准备请求导致阻断”的问题。

## 页面自动对齐的作用

页面模型/推理菜单自动点击只用于让 UI 与策略尽量一致，方便你直观看到当前选择。它不是后端验证证据，也不是请求锁定的唯一手段。

即使页面 DOM 暂时识别不到模型名称，只要网络请求锁定器已附加，GPTLock 仍会在正式 conversation POST 上检查顶层模型字段。页面状态缺失只显示告警，不再阻断正常聊天。

## 自动验证：程序自动发送测试消息

点击弹窗或设置页的 **“自动验证 / Auto verify”** 后，不需要再人工输入或发送“探针”。0.3.6 会对一次自动验证最多执行 2 次可见测试尝试：第一次响应证据不足时先自动回查当前会话详情，仍不足才自动发送第二条测试消息。程序会自动：

1. 检查 Native Core；失败时记录告警但继续后续可执行步骤；
2. 确保当前 ChatGPT 标签页的请求锁定器已附加；
3. 收集当前页面选择并尽力自动对齐；
4. 清除旧的验证状态；
5. 在当前 ChatGPT 输入框写入固定可见测试消息：

   `GPTLock 自动验证测试：请只回复“验证完成”。`

6. 自动点击发送；
7. 捕获该正式请求的锁定结果；
8. 响应完成后自动尝试提取模型/推理元数据并交给 Native Core 验证；
9. 若流式响应未暴露模型/推理元数据，自动读取当前会话详情中的最新助手消息元数据作为第二证据源；
10. 若仍为 `unverified`，自动再发送一次可见测试消息；
11. 最终明确显示失败/不足原因与已执行的尝试次数，并将全过程写入运行日志/诊断包。

如果输入框已有草稿，程序会先保留草稿，并在测试消息成功发出后尽力恢复。自动验证不会发送隐藏请求，也不会把页面文字伪造为 `verified`。

从 0.3.6 起，自动验证还会把这两次固定测试请求对应的**原始 SSE 响应**临时保存在扩展本地存储中，并在导出诊断包时写入 `autoVerificationSse`。原始 SSE 按 UTF-8 字节合计最多 10 MiB；超过上限的响应只保留大小/请求 ID 等省略记录，不伪装成完整抓包。该机制只针对自动验证，不抓取普通聊天响应正文。

## 状态含义

| 状态 | 含义 | 是否影响聊天 |
|---|---|---|
| 请求锁定已就绪 / Lock ready | 拦截器已连接，正式请求将按策略检查 | 不影响 |
| 等待确认 / Waiting | 正式请求已发送，等待可选响应证据 | 不影响 |
| 已确认 / Verified | 响应同时暴露了允许的模型和推理元数据 | 不影响 |
| 未完全确认 / Unverified | 响应缺字段、格式不可解析、证据不足等 | 只告警 |
| 页面选择不同 / UI differs | DOM 看到的选择和策略不同 | 只告警，网络层仍尝试锁定 |
| 请求锁定器离线 | Chrome debugger/CDP 会话不可用 | 只告警，聊天 fail-open |
| Native Core 离线 | 无法完成本地响应审计 | 只告警；浏览器侧仍尝试请求锁定 |
| 模型不匹配 / Model mismatch | 响应明确暴露的模型不在允许列表 | 严格模式阻断后续发送 |
| 推理强度不匹配 | 响应推理值不在允许列表 | 只告警 |

常见徽章：`L` 请求锁定已就绪，`OK` 响应已确认，`…` 等待响应，`?` 告警/证据不足，`!` 已确认模型不匹配，`OFF` GPTLock 已关闭。

## 严格模式与提醒模式

### 严格

严格模式仍优先保证日常聊天不会因为“验证系统本身失败”而卡死。只有**响应元数据明确确认模型不在锁定列表**时，后续发送才会被阻断。

下列情况均为告警，不阻断：

- 页面模型或推理识别不到；
- 页面选择与策略不一致；
- Native Core 离线；
- 请求锁定器因 DevTools 等原因离线；
- 响应体读不到；
- 响应没有模型或推理字段；
- 响应推理强度不符合策略；
- 验证过程自身发生异常。

### 提醒

提醒模式永不因响应验证结果阻断发送，但仍执行能够执行的请求锁定、状态展示与日志记录。

## `gpt-5.6-sol-wm` 与 `gpt-5-6-thinking`

0.3.6 根据实际观察把 `gpt-5.6-sol-wm` 作为 `gpt-5.6-sol` 的传输别名处理。因此策略中选择 `gpt-5.6-sol` 时，正式请求可能以 `gpt-5.6-sol-wm` 发出，而界面/审计显示规范化后的 `gpt-5.6-sol`。

`gpt-5-6-thinking` 仍是独立标识，不会被 GPTLock 当成 Sol。如果正式请求顶层模型是该值，而策略只允许 Sol，请求锁定器会尝试改写为 Sol 的已知传输标识。

## 响应确认的边界

请求锁定证明的是“GPTLock 检查/改写了官方网页准备发送的正式请求字段”，不是 OpenAI 后端内部路由的密码学证明。服务端仍可能基于账号权限、额度或产品策略改变实际处理方式。

响应确认只使用浏览器能够安全读取的响应元数据：

- 如果模型和推理强度都存在且符合策略：`verified`；
- 如果响应明确暴露了不允许的模型：`mismatch`，严格模式会阻断后续发送；
- 如果字段缺失或无法读取：`unverified`，只告警；
- 不会通过“问模型你是什么模型”、DOM 显示文字或用户手工输入来伪造成功证据。

## Chrome/Edge 调试提示

请求锁定和响应确认都使用扩展的 `debugger` 权限。浏览器可能显示“正在调试此浏览器”提示。同一标签页打开 DevTools 可能抢占调试连接并让 GPTLock 脱离。

发生这种情况时：

1. 关闭该 ChatGPT 标签页的 DevTools；
2. 点击 GPTLock“重新连接”；
3. 确认状态恢复为“请求锁定已就绪”。

调试连接丢失时 GPTLock 会记录告警，但不会因此阻断日常聊天。

## 运行日志与诊断包

Native Core 审计日志：

```text
Linux:   ~/.gptlock/logs/audit.jsonl
Windows: %USERPROFILE%\.gptlock\logs\audit.jsonl
```

Native 日志记录时间、请求 ID、模型、推理强度、证据来源、可信度、判定、原因和策略 revision。它不记录提示词、回答正文、Cookie、登录信息、Authorization 或完整响应体。达到 10 MiB 时保留一份轮换文件 `audit.1.jsonl`。

扩展“运行日志”页记录并可导出：

- 正式请求命中的端点；
- 请求锁定是否改写；
- 改写前/后的规范化模型与传输模型；
- 已存在的推理字段及检查结果；
- 响应 HTTP 状态、MIME、解析格式、候选字段路径；
- Native Core 连接/验证错误；
- 自动验证是否成功写入并发送测试消息；
- 各 ChatGPT 标签页当前状态。

扩展最多保留 2000 条有界运行日志；诊断导出请求最多 1000 条 Native Core 审计尾部记录。运行日志脱敏器仍会去除 `postData`、请求/响应正文、提示词、回答、Cookie、Authorization、Token、密码等敏感字段，同时保留 `postDataLength`、端点、字段路径和错误等技术诊断信息。**诊断包中的 `autoVerificationSse` 是唯一正文例外**：它只保存自动验证固定测试消息对应的原始 SSE，合计最多 10 MiB，用于分析 ChatGPT 实际返回字段。

## 本机 API（可选）

启动 `gptlock-core serve` 后监听 `127.0.0.1:17856`。`/health` 无需认证，其余接口使用 `.gptlock/api.token`：

```bash
curl http://127.0.0.1:17856/health
GPTLOCK_TOKEN="$(tr -d '\r\n' < "$HOME/.gptlock/api.token")"
curl -H "Authorization: Bearer $GPTLOCK_TOKEN" http://127.0.0.1:17856/status
```

## English

GPTLock 0.3.6 no longer requires verification before ordinary chat. Once enabled, it attaches a CDP request interceptor and locks only the two formal conversation POST endpoints. A disallowed top-level model is rewritten to the configured lock target; an already-existing top-level reasoning field may be aligned to the preferred allowed value, but missing reasoning fields are never invented.

Response verification is supplementary. Missing DOM fields, Core outages, debugger detaches, unreadable/missing response metadata, reasoning mismatches, and verification errors warn but fail open. In strict mode, only a **confirmed response-model mismatch** blocks subsequent sends.

Auto verify is fully automatic: it best-effort aligns the UI, writes a fixed visible test message to the active ChatGPT composer, clicks Send, captures the formal request lock result, then evaluates any response metadata that ChatGPT exposes. Existing drafts are preserved and restored on a best-effort basis.

`gpt-5.6-sol-wm` is normalized as the transport alias of `gpt-5.6-sol`; `gpt-5-6-thinking` remains distinct. Request rewriting shows what the official web client sent, not what OpenAI ultimately routed internally.
