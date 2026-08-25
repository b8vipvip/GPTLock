# GPTLock Native Core / 本地核心

> 默认中文，English follows.

Rust 本地进程提供 Chromium Native Messaging、策略持久化、证据验证、本机 HTTP API 与脱敏审计日志。它不代理或解密 HTTPS，不调用 OpenAI API，也不能绕过服务限制。

## 命令

```text
gptlock-core native                 Native Messaging 模式（无参数时默认）
gptlock-core serve                 监听 127.0.0.1:17856
gptlock-core serve --listen ADDR   只接受 loopback 地址
gptlock-core doctor                输出脱敏诊断信息和路径
gptlock-core --version
```

Native Messaging 清单的 `path` 不能附加自定义命令参数；手动无参数启动会进入 `native`。Chromium 实际启动主机时会自动把调用扩展的 `chrome-extension://.../` 来源作为首个参数，并可能在 Windows 追加 `--parent-window=<句柄>`；核心会校验这些参数后进入同一模式。Linux systemd 用户服务显式使用 `serve`。

## 数据目录

默认：Linux `~/.gptlock`，Windows `%USERPROFILE%\.gptlock`；测试/高级部署可用 `GPTLOCK_HOME` 覆盖。

```text
.gptlock/
├── config.json
├── api.token
├── status.json
└── logs/
    ├── audit.jsonl
    └── audit.1.jsonl
```

日志达到 10 MiB 后保留一份轮换文件。只记录模型、推理、来源、判定、原因、策略 revision 和有限请求 ID，不记录聊天正文或凭据。

扩展可通过 Native Messaging `get_diagnostics` 读取最多 500 条最近审计记录和脱敏 doctor 报告，用于用户主动导出的诊断包；API 令牌和聊天内容不会通过该消息返回。

## HTTP API

| 方法 | 路径 | 令牌 | 用途 |
|---|---|---:|---|
| GET | `/health` | 否 | 健康检查 |
| GET | `/policy` | 是 | 读取策略与 revision |
| PUT | `/policy` | 是 | 校验并持久化策略 |
| POST | `/verify` | 是 | 验证观测并写审计 |
| GET | `/status` | 是 | 运行状态与最近验证 |

```bash
gptlock-core serve
curl http://127.0.0.1:17856/health
GPTLOCK_TOKEN="$(tr -d '\r\n' < "$HOME/.gptlock/api.token")"
curl -H "Authorization: Bearer $GPTLOCK_TOKEN" http://127.0.0.1:17856/status
```

API 请求体上限 64 KiB，不设置宽松 CORS，并拒绝非回环监听。

## 验证语义

`network_response_metadata` 与 `conversation_response_metadata` 是充分来源；`network_request_metadata`、`page_dom`、`user_selection` 和 `unknown` 都只能得到 `unverified`（若值本身违反策略仍为 `mismatch`）。强证据必须同时提供模型和推理强度且不超过时间窗口。

## 测试

```bash
cargo fmt --manifest-path native-core/Cargo.toml --all -- --check
cargo clippy --locked --manifest-path native-core/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path native-core/Cargo.toml --all-targets
```

安装和更新见 [安装文档](../docs/INSTALL.md) 与 [更新文档](../docs/UPDATE.md)。

## English

The Rust Native Core provides Native Messaging, policy persistence, three-state evidence verification, a loopback API, and privacy-conscious JSONL audit logs. With no arguments it runs as the native host. It also accepts Chromium's automatically supplied caller origin and Windows `--parent-window` argument after validating their shape. `serve` starts the optional API and `doctor` prints a redacted report. The `get_diagnostics` native message returns a bounded audit tail and redacted doctor data for explicit user export.

Only response-metadata sources are sufficient for verification. Request, DOM, selection, and unknown sources remain unverified. The API is loopback-only, token-protected except for health, size-limited, and non-CORS. User data is stored in `.gptlock` under the current profile unless `GPTLOCK_HOME` overrides it.
