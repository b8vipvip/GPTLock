# 安全与隐私边界 / Security & Privacy

> 默认中文，English follows.

## 权限与本地攻击面

- 扩展只声明 `https://chatgpt.com/*` 主机范围；
- `debugger` 权限用于该站点标签页的 CDP `Network` 域。Chromium 不允许把此权限设为 optional，因此安装时会明确展示权限告警；
- Native Messaging 只允许固定扩展 ID `bhchcpeodphgjfjoookncemnamdbfcof`；
- HTTP API 只接受 loopback，默认 `127.0.0.1:17856`；
- `/health` 之外要求 256 位随机令牌，请求体上限 64 KiB，不返回宽松 CORS；
- Linux 状态目录使用 `0700`，配置、令牌、状态和日志使用 `0600`；
- Native Messaging stdout 只写长度前缀 JSON 帧，诊断写 stderr；
- 模型、推理强度、请求 ID、条目数和长度均受校验。

manifest 中提交的是稳定 ID 所需的 RSA **公钥**，不是商店签名私钥，也不提供代码签名信任。不要向仓库加入任何私钥、API token、Cookie 或 `.gptlock` 用户数据。

## 数据最小化

CDP 需要浏览器把响应体交给扩展才能从 JSON/SSE 中寻找元数据，但解析器：

- 只接受明确白名单键与响应头；
- 不把字符串再次当作 JSON 解析，避免聊天正文伪造元数据；
- 跳过 `content`、`parts`、`text`、`prompt`、`input`、`output_text`、`arguments` 分支；
- 不持久化请求体、响应体、headers、Cookie 或 Authorization；
- 提取完成后立即释放正文引用。

审计日志允许记录：时间、有限请求 ID、模型、推理强度、证据来源、可信度、判定、原因和策略 revision。禁止记录：提示词、回答正文、上传文件、Cookie、登录令牌、Authorization、本地 API token 或完整网络负载。

## 真实性边界

`page_dom`、`user_selection` 和 `network_request_metadata` 永远不足以证明后端实际模型。`verified` 要求当前响应同时暴露匹配的模型与推理强度元数据。互相冲突或缺失的强证据不会被猜测补全。

这仍不是 OpenAI 内部调度器的密码学证明：GPTLock 只能验证服务器实际交给官方网页的元数据，本地核心也无法独立证明调用它的扩展没有伪造 `evidenceSource`。首次探测请求在响应前天然未验证，文档和 UI 必须持续明确这一点。

## 更新安全

更新脚本只从 GitHub HTTPS Release 下载，先验证 `SHA256SUMS.txt` 再执行安装器；它不会下载后直接执行任意脚本。但安装包与校验和来自同一发布渠道，因此 SHA-256 主要检测传输/文件损坏，不能替代独立代码签名。维护者应保护 GitHub 账号、分支和发布权限，未来配置证书后再声明 Authenticode 或 tag 签名保证。

## 威胁模型外

GPTLock 不防御已取得当前操作系统账户或浏览器扩展权限的恶意软件；不能审计 OpenAI 未暴露的内部路由；不能绕过额度、区域、套餐或账号策略；也不能保证 ChatGPT 私有接口和模型标识保持稳定。

## English

The extension is scoped to `chatgpt.com`, but Chromium requires its `debugger` permission to be declared at install time. It uses only the CDP Network domain for scoped tabs. Native Messaging is allow-listed to the stable extension ID, and the optional API is loopback-only, token-protected except for health, size-limited, and non-CORS.

Response bodies are transiently available to the extractor, which reads only whitelisted metadata, skips chat-content branches, never reparses content strings, and persists no bodies, headers, cookies, credentials, or prompts. Audit logs contain minimal model/reasoning verdict metadata only.

Response metadata is evidence, not cryptographic attestation of OpenAI's private scheduler. Request/UI state never proves the backend, the first probe is necessarily unverified before its response, and missing/conflicting evidence remains unverified. Release checksums detect integrity problems but are not a substitute for independent code signing.
