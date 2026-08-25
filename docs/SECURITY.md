# 安全与隐私边界 / Security & Privacy

> 默认中文，English follows.

## 本地攻击面控制

- HTTP 服务只接受 loopback 地址，默认 `127.0.0.1:17856`；
- `/health` 之外的接口要求 256 位随机令牌；
- 请求体限制为 64 KiB，未启用宽松 CORS；
- Native Messaging 清单只允许安装时指定的扩展 ID；
- Linux 数据目录和文件使用私有权限；
- Native Messaging stdout 仅写长度前缀协议帧，诊断错误写 stderr；
- 配置字段限制字符、长度、条目数量并去重。

## 数据最小化

审计日志允许记录：时间、请求 ID、模型标识、推理强度、证据来源、可信度、判定、原因、策略 revision。

禁止记录：提示词、回答正文、上传文件、Cookie、登录令牌、Authorization、API 令牌、完整网络响应。后续网络采集器也必须遵守此边界。

## 真实性声明

`page_dom` 和 `user_selection` 永远不足以证明后端实际模型。只有由受信扩展采集器标记为当前服务端响应元数据的证据可得到 `verified`。本地核心负责校验字段、来源标签、时间与策略，但无法独立证明调用方没有伪造来源标签；该结论也不是对 OpenAI 内部调度器的密码学证明。GPTLock 不得把 `unknown` 自动改写为成功。

## 威胁模型外

GPTLock 不防御已取得当前操作系统账户权限的恶意软件，也不能审计 OpenAI 未暴露的内部路由、绕过服务端额度或保证某个未公开模型标识持续存在。

发现安全问题时，请创建不含真实令牌、Cookie、聊天正文或个人信息的最小复现。公开仓库中不要提交真实 `api.token` 或 `.gptlock` 数据目录。

## English

The API is loopback-only, authenticated except for `/health`, capped at 64 KiB, and does not emit permissive CORS headers. Native Messaging is allow-listed to the installed extension ID. Linux state uses private permissions, and policy inputs are normalized and bounded.

Audit records may contain timestamps, request IDs, model/reasoning identifiers, evidence source, confidence, verdict, reason codes, and policy revision. They must never contain prompts, responses, uploads, cookies, login credentials, authorization headers, the local API token, or complete network payloads.

UI state is never backend proof. A `verified` result requires metadata labelled by the trusted extension collector as belonging to the current server response. The core validates fields, source labels, freshness, and policy, but cannot independently prove that a caller did not forge a source label. It also does not cryptographically attest OpenAI's private scheduler. GPTLock does not protect against malware already running as the user, cannot bypass quotas, and cannot inspect undisclosed internal routing.
