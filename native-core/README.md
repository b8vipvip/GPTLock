# GPTLock Native Core / 本地核心

> 默认中文，English follows.

Rust 编写的跨平台本地进程，提供 Chromium Native Messaging、策略持久化、证据验证、本机 HTTP API 与脱敏审计日志。它不代理、不解密 ChatGPT HTTPS 流量，也不绕过 OpenAI 限制。

## 命令

```text
gptlock-core native                 Native Messaging 模式（无参数时默认）
gptlock-core serve                 监听 127.0.0.1:17856
gptlock-core serve --listen ADDR   仅接受 loopback 地址
gptlock-core doctor                输出脱敏诊断信息和文件路径
gptlock-core --version
```

Native Messaging 清单只能指定可执行文件、不能附加参数，因此无参数启动必须进入 `native` 模式。Linux systemd 用户服务显式使用 `serve` 参数。

## 数据目录

默认使用当前用户目录下的 `.gptlock`，测试或高级部署可通过 `GPTLOCK_HOME` 覆盖：

```text
~/.gptlock/
├── config.json
├── api.token
├── status.json
└── logs/
    ├── audit.jsonl
    └── audit.1.jsonl
```

Linux 上目录权限设为 `0700`，策略、令牌和日志文件设为 `0600`。审计日志达到 10 MiB 后保留一份轮换文件。日志只记录模型、推理强度、证据来源、判定、原因、策略版本和可选请求 ID，不记录聊天正文、Cookie、Authorization 或 API 令牌。

## HTTP API

启动：

```bash
cargo run --manifest-path native-core/Cargo.toml -- serve
```

健康检查：

```bash
curl http://127.0.0.1:17856/health
```

读取令牌后验证：

```bash
GPTLOCK_TOKEN="$(tr -d '\r\n' < "$HOME/.gptlock/api.token")"
curl -sS http://127.0.0.1:17856/verify \
  -H "Authorization: Bearer $GPTLOCK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.6-sol","reasoning":"high","evidenceSource":"network_response_metadata"}'
```

接口：

| 方法 | 路径 | 令牌 | 用途 |
|---|---|---:|---|
| GET | `/health` | 否 | 进程健康检查 |
| GET | `/policy` | 是 | 当前规范化策略及 revision |
| PUT | `/policy` | 是 | 校验并持久化策略 |
| POST | `/verify` | 是 | 验证观测证据并写审计日志 |
| GET | `/status` | 是 | 运行时间、策略和最近结果 |

API 请求体上限 64 KiB，不设置跨域响应头，并拒绝非回环监听地址。

## 测试

```bash
cargo fmt --manifest-path native-core/Cargo.toml --all -- --check
cargo clippy --manifest-path native-core/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path native-core/Cargo.toml --all-targets
```

## English

The Rust Native Core provides Chromium Native Messaging, policy persistence, evidence verification, a loopback-only HTTP API, and a privacy-conscious JSONL audit log. It does not proxy or decrypt ChatGPT HTTPS traffic and cannot bypass service controls.

With no arguments, the executable runs as a Native Messaging host because Chromium manifests cannot pass command-line arguments. Use `serve` for the optional API and `doctor` for a redacted diagnostic report. Data is stored under `~/.gptlock` unless `GPTLOCK_HOME` is set.

The API binds to `127.0.0.1:17856`; only `/health` is unauthenticated. All other endpoints require the random token from `~/.gptlock/api.token`. Requests are capped at 64 KiB, non-loopback addresses are rejected, and no permissive CORS headers are emitted. Audit records never contain chat text, cookies, authorization headers, or the local API token.
