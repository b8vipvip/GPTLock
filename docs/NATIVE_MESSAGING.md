# Native Messaging 协议 / Protocol

> 默认中文，English follows.

主机名：`com.gptlock.core`；协议版本：`1`。Chromium 启动主机时附加的扩展来源参数（以及 Windows 的 `--parent-window` 参数）由核心识别为浏览器调用，不会被误当成 CLI 子命令。

每条消息使用 Chromium Native Messaging 标准：4 字节小端无符号长度，后跟 UTF-8 JSON；单条消息最大 1 MiB。请求携带唯一 `id`，响应原样返回该 `id`。

请求类型：

- `ping`
- `get_capabilities`
- `get_policy`
- `set_policy`，附带 `policy`
- `verify`，附带 `observation`
- `get_status`
- `get_diagnostics`，可附带 `auditLimit`（`1..500`）

`get_capabilities` 会分别列出充分证据来源 `network_response_metadata`、`conversation_response_metadata`，以及提示级来源 `network_request_metadata`、`page_dom`、`user_selection`、`unknown`。

`get_diagnostics` 返回脱敏的 `doctor` 报告和有界的最近审计记录，用于扩展诊断导出；它不返回 API 令牌、配置文件正文、提示词或回答正文。

示例：

```json
{
  "id": "42",
  "type": "verify",
  "observation": {
    "model": "gpt-5.6-sol",
    "reasoning": "high",
    "evidenceSource": "network_response_metadata",
    "capturedAt": "2026-08-25T09:00:00Z",
    "requestId": "request-42"
  }
}
```

成功响应：

```json
{
  "id": "42",
  "ok": true,
  "protocolVersion": 1,
  "data": {
    "verdict": "verified",
    "decision": "allow"
  }
}
```

错误响应包含稳定 `error.code`、中文优先消息 `messageZhCn` 和英文 `messageEn`。协议解析失败或超长帧会关闭当前 Native Messaging 进程，浏览器扩展随后重连。

`verify.observation` 只允许模型、推理强度、证据来源、采集时间和有限字符请求 ID；扩展不得把提示词、回答正文、Cookie、请求头或完整响应传入此协议。

## English

The host is `com.gptlock.core`, protocol version `1`. Chromium's caller-origin argument and the Windows `--parent-window` argument are recognized as a browser invocation rather than CLI subcommands. Each frame is a four-byte little-endian unsigned length followed by UTF-8 JSON, with a 1 MiB maximum. Requests carry a unique `id`; responses echo it.

Supported request types are `ping`, `get_capabilities`, `get_policy`, `set_policy`, `verify`, `get_status`, and `get_diagnostics`. The diagnostics request returns a redacted doctor report plus a bounded audit tail. Capabilities distinguish sufficient response sources from informational request/DOM/selection sources. Successful responses contain `ok: true` and `data`; failures contain a stable error code plus Chinese and English messages. Invalid or oversized framing terminates the current host process so the extension can reconnect cleanly. Verification messages must never carry chat content, headers, cookies, or complete payloads.
