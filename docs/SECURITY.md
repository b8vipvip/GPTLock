# 安全与隐私边界 / Security & Privacy

> 默认中文，English follows.

## 权限与本地攻击面

- 扩展只声明 `https://chatgpt.com/*` 主机范围；
- `debugger` 权限用于该站点标签页的 CDP `Fetch` 和 `Network` 域。Chromium 不允许把该权限设为普通站点 optional 权限，因此安装时会明确展示调试权限告警；
- `unlimitedStorage` 仅用于可靠保存一次自动验证最多 10 MiB 的原始 SSE 诊断缓存，避免与正常运行日志共同占用 `storage.local` 默认配额；
- `Fetch` 只用于正式 ChatGPT conversation POST 的发送前请求锁定；
- `Network` 只用于关联正式请求与可选响应元数据；
- Native Messaging 只允许固定扩展 ID `bhchcpeodphgjfjoookncemnamdbfcof`；
- HTTP API 只接受 loopback，默认 `127.0.0.1:17856`；
- `/health` 之外要求随机高熵令牌，请求体受大小限制，不返回宽松 CORS；
- Linux 状态目录和敏感文件使用收紧的本地权限；
- Native Messaging stdout 只写长度前缀 JSON 帧，诊断写 stderr；
- 模型、推理强度、请求 ID、条目数和长度均受校验。

manifest 中提交的是稳定扩展 ID 所需的 RSA **公钥**，不是商店签名私钥，也不提供代码签名信任。不要向仓库提交私钥、API token、Cookie、浏览器 Profile、`.gptlock` 用户数据或任何真实聊天内容。

## 面向公众分发时的账号与会员安全

公开分发版本不再以授权码作为终端用户凭据。用户必须使用 **账号 + 密码 + 已验证邮箱** 登录，服务端再根据免费期、会员计划、设备绑定和活动 ChatGPT 窗口租约返回实时权益。旧授权码表只为升级回滚/历史审计保留，旧客户端授权 API 返回 HTTP 410。

密码使用随机盐 `scrypt` 派生摘要，CPU 密集计算通过 Node/libuv worker pool 异步执行，避免同步密码哈希阻塞 Web 事件循环。数据库从不保存明文密码。登录成功签发 32 字节随机会话令牌，服务端只保存令牌 SHA-256，原始令牌仅保存在扩展自己的 `chrome.storage.local`，不进入 Chrome Sync。修改密码会使其他会话失效；找回密码会使全部旧会话失效。

邮箱验证和找回密码使用 6 位一次性验证码。数据库只保存基于服务端密钥派生键计算的验证码 HMAC，并限制有效期和错误尝试次数。注册、重发验证码、找回密码以及登录同时具有 **IP 级总限流** 与 **IP+邮箱级限流**，降低暴力猜解、凭据填充和轮换邮箱绕过单账号限制的效果。进程内限流不能抵御分布式攻击，生产反向代理/WAF 仍必须设置请求速率、连接数和异常流量限制；用户规模扩大后建议把限流状态迁移到 Redis/网关并为注册/找回密码加入 CAPTCHA 或同等反自动化挑战。

管理员 Cookie 为 `HttpOnly; Secure; SameSite=Strict`。后台写操作还检查同源 `Origin`，降低浏览器 CSRF 风险。管理员登录另有独立暴力尝试限流。`/admin/` 仍建议使用 Cloudflare Access、VPN 或 IP 白名单，不应只依靠应用层密码暴露在全互联网。

账号、订单、套餐和配置的 SQL 均使用 SQLite prepared statements；数值、枚举、ID、邮箱和 URL 均进行边界验证。支付跳转地址只接受 HTTPS。SMTP 密码/授权码使用 AES-256-GCM 加密保存，密钥由生产服务端主密钥派生；SMTP 仅允许 SMTPS 或 STARTTLS，不允许明文传输凭据。

扩展 ID、Origin 和 CORS 只是浏览器侧缩小攻击面的措施，不是密码学客户端身份证明：自写 HTTP 客户端可以伪造这些头。真正的账户身份仍由密码/会话令牌建立。更重要的是，GPTLock 扩展和 Native Core 运行在用户控制的机器上，因此账号门禁不能宣称为“不可破解 DRM”；能够修改本地扩展或二进制的用户理论上可以尝试移除本地检查。更强的商业防绕过需要把关键能力留在受控服务端，或引入服务端签名的短期权益证明并由更可信的本地组件验证。

会员/邮箱/支付架构和上线检查详见 [`ACCOUNT_SYSTEM.md`](ACCOUNT_SYSTEM.md)。

## Public account and membership security

Public builds now use verified-email accounts instead of license codes. Passwords are stored as salted scrypt hashes; password derivation runs asynchronously through Node's worker pool. Session tokens are random and stored server-side only as SHA-256 hashes, while raw tokens remain in extension-local storage. Email verification/reset codes are persisted only as HMACs with expiration and attempt limits. Login and email-delivery flows have both per-IP and per-IP-plus-account rate limits, while production deployments must still enforce distributed rate/connection limits at the reverse proxy or WAF.

Admin cookies use HttpOnly, Secure and SameSite=Strict, state-changing admin requests are origin-checked, SQLite access uses prepared statements, SMTP secrets are AES-256-GCM encrypted at rest, and payment links must be HTTPS. Extension ID/CORS checks are hardening rather than cryptographic identity, and local client checks must not be presented as unbreakable DRM.

## 账号认证与会员交易完整性补充

- 登录对“账号存在”和“账号不存在”都会执行同级别的 scrypt 校验工作，减少通过响应耗时枚举邮箱的侧信道。
- 服务只监听 loopback 时才信任反向代理客户端 IP；优先使用代理覆盖的 `X-Real-IP`，否则使用 `X-Forwarded-For` 的最后一跳，避免攻击者伪造最左侧 XFF 绕过进程内限流。生产反向代理仍应明确覆盖这些头。
- 会员订单在创建时冻结套餐名称、价格、时长、设备/窗口上限与权益说明；到账发放的会员记录继续保存同一份快照。管理员后续修改套餐只影响新订单，不会偷偷改变已购买或已生效会员的权益。

## 请求锁定的最小修改范围

0.3.6 会在正式 conversation POST 发出前短暂读取请求体，因为只有这样才能检查网页实际准备发送的顶层模型字段。修改范围刻意限制为：

- 只处理 `https://chatgpt.com`；
- 只处理 `POST`；
- pathname 只允许：

  ```text
  /backend-api/conversation
  /backend-api/f/conversation
  ```

- 请求体必须是 JSON object；
- 只允许修改顶层 `model`；
- 只允许修改已经存在、且值能安全规范化的顶层推理强度字段；
- 不创建缺失的推理字段；
- 不修改消息正文、附件、会话 ID、父消息 ID、客户端标识、账户信息或其他业务字段；
- `prepare`、`init` 等辅助流量即使被宽 URL pattern 暂停，也会经过精确谓词后立即原样继续；
- 任意解析/改写异常都尽力原样放行，而不是把用户聊天卡在暂停状态。

改写后的完整 `postData` 只用于当次 `Fetch.continueRequest`，不写入运行日志或诊断包。

## 响应数据最小化

CDP `Network` 需要浏览器把响应体交给扩展，才能从 JSON/SSE 中寻找响应元数据。解析器采取以下限制：

- 只接受明确白名单模型/推理键与响应头；
- 不把聊天字符串内容再次当作 JSON 解析；
- 跳过 `content`、`parts`、`text`、`prompt`、`input`、`output_text`、`arguments` 等正文分支；
- 普通聊天不持久化完整请求体、响应体、Cookie、Authorization 或 token；
- **唯一正文例外是自动验证**：仅固定测试消息对应的原始 SSE response body 可临时保存并随诊断包导出，按 UTF-8 字节合计最多 10 MiB；
- 自动验证之外的响应在元数据提取完成后立即释放正文引用；自动验证原始 SSE 在完成有界复制后也立即释放网络事件中的正文引用；
- 最多保留字段路径、MIME、HTTP 状态、数据长度、解析格式、候选数量等技术诊断。

扩展运行日志的脱敏器会明确屏蔽 `postData`、request/response body、prompt、chat content、answer content、Cookie、Authorization、API key、access/refresh token、password、secret 等字段，同时允许保留 `postDataLength`、端点、模型规范化值、字段路径和错误。

Native Core 审计允许记录：时间、安全请求 ID、模型、推理强度、证据来源、可信度、判定、原因和策略 revision。禁止记录：提示词、回答正文、上传文件内容、Cookie、登录令牌、Authorization、本地 API token 或完整网络负载。

## “请求锁定”不等于后端证明

请求改写能证明的范围是：**在扩展成功附加且改写日志成立的情况下，GPTLock 检查了官方网页准备发送的正式请求，并把可控字段按策略继续发送。**

它不能证明 OpenAI 内部一定使用同一个模型，因为服务端仍可能：

- 因账号或套餐不可用而拒绝模型；
- 因额度耗尽而降级/替换；
- 根据产品策略重新路由；
- 返回与请求不同的服务模型；
- 不向网页暴露完整内部调度信息。

因此，请求锁定与响应确认是两个不同概念，UI/文档不得把“请求 model 已改写”描述成“后端模型已被密码学强制”。

## 响应证据真实性边界

`page_dom`、`user_selection` 和 `network_request_metadata` 永远不足以单独证明后端实际模型。`verified` 仍要求响应证据本身暴露可验证且符合策略的模型和推理元数据。

- 响应缺失模型或推理字段：`unverified`；
- 强证据冲突：降级，不猜测补全；
- 响应推理强度不允许：`mismatch`/告警，但 0.3.6 不因此阻断聊天；
- 响应明确暴露不允许模型：`mismatch`，严格模式可阻断后续发送。

这仍不是 OpenAI 内部调度器的密码学证明：GPTLock 只能验证服务器实际交给官方网页的元数据，本地核心也无法独立证明调用它的扩展没有伪造 `evidenceSource`。

## Fail-open 的安全取舍

旧版把“验证器是否健康”本身当成发送门禁，容易出现 Core 离线、字段缺失或协议变化时日常聊天完全无法发送。0.3.6 改为：

- 请求锁定器健康时尽量执行锁定；
- 请求锁定器/Native Core/响应验证失败时清晰告警并记录日志；
- 不因为验证基础设施自身失败而阻断用户正常聊天；
- 只有已获得强响应证据并确认**模型**违反策略时，严格模式阻断后续发送。

这个选择优先避免扩展故障造成“ChatGPT 不可用”。代价是：如果浏览器调试连接被 DevTools 或其他调试器抢占，GPTLock 不能声称该次请求被锁定。界面会显示请求锁定器离线/告警，用户可关闭冲突调试器后点击“重新连接”。

## 自动验证与用户可见性

“自动验证”会自动在当前 ChatGPT 对话中发送固定测试消息，因此它是**用户可见的真实聊天消息**，而不是后台隐形请求。这样做的原因是验证需要一条真实正式 conversation POST，同时让用户能够直接看到程序做了什么。

自动验证：

- 不发送隐藏提示词；
- 测试文本是固定、明确可见的；
- 尽力保存并恢复已有输入框草稿；
- 不读取旧聊天内容来生成测试文本；
- 运行日志和 Native Core audit 仍不写测试消息/回答正文；
- 用户主动导出的诊断包可以包含自动验证固定测试请求的原始 SSE，这是用于协议分析的显式例外，最多 10 MiB，并在 `privacy` 字段明确标记。

## 更新安全

更新脚本只从 GitHub HTTPS Release 下载，先验证 `SHA256SUMS.txt` 再执行安装器；不会从未知第三方地址下载并直接执行任意脚本。但安装包与校验和仍来自同一发布渠道，因此 SHA-256 主要检测传输/文件损坏，不能替代独立代码签名。

维护者应保护 GitHub 账号、分支、Actions 与 Release 权限。未来只有在实际配置 Authenticode、签名 tag 或独立发布签名后，文档才应声明相应代码签名保证。

## 威胁模型外

GPTLock 不防御：

- 已取得当前操作系统账户权限的恶意软件；
- 具备更高浏览器扩展权限的恶意扩展；
- 能抢占 Chrome debugger 会话的本地调试工具；
- OpenAI 未暴露给网页的内部路由变化；
- 套餐、额度、区域、账号、风控或模型可用性限制；
- ChatGPT 私有接口未来发生不兼容变化。

## English

GPTLock 0.3.6 uses Chromium's `debugger` permission for both CDP **Fetch** and **Network** on `chatgpt.com`. Fetch is the pre-send request-lock layer and is constrained to the two exact formal conversation POST paths. It may modify only the top-level model and already-existing top-level reasoning fields; it does not modify chat content, attachments, conversation identifiers, or unrelated payload fields. Parsing/rewrite errors fail open and attempt to continue the original request.

Ordinary-chat request postData and response bodies remain transient and are not persisted in runtime logs or Native Core audit files. GPTLock 0.3.6 adds one explicit diagnostic exception: raw SSE response bodies for the fixed automatic-verification probes may be retained locally and exported under `autoVerificationSse`, capped at 10 MiB total. Runtime-log redaction still removes request/response payloads, prompts, answers, cookies, authorization data, tokens, passwords, and secrets. The raw SSE export never includes browser cookies, Authorization headers, request headers, or response headers, but the SSE body itself may contain the probe answer, message/conversation IDs, and server metadata.

A rewritten request proves what GPTLock attempted to send from the official web client; it does **not** cryptographically force or attest OpenAI's internal routing. DOM labels and request metadata never become backend proof. Only response metadata exposed to the browser can provide supplementary served-model evidence.

The guard deliberately fails open for debugger detach, Core outage, missing/unreadable response metadata, DOM gaps, and reasoning mismatches. In strict mode only a confirmed response-model mismatch blocks subsequent sends. Auto verify sends one fixed, visible test message in the active ChatGPT conversation and never hides that action from the user.


## v0.3.7 automatic-verification stream capture
Only the fixed automatic-verification probes may capture post-handoff SSE or server-to-client WebSocket frames, and WebSocket capture begins only after an exact handoff topic/token marker matches the socket subscription. The aggregate raw stream budget remains 10 MiB. Raw handoff SSE can contain short-lived resume tokens; account cookies, Authorization headers, request/response headers, and ordinary chat bodies remain excluded.
