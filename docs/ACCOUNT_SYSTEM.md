# GPTLock 账号与会员系统 / Account & Membership System

> 默认语言：简体中文。English follows each section.

## 1. 目标 / Goal

GPTLock 的最终用户认证已从“分发授权码”迁移为“账号 + 密码 + 邮箱验证 + 服务端权益”。插件未登录时只显示账号入口；注册必须完成邮箱验证码；忘记密码通过同一注册邮箱完成验证与重置。

GPTLock end-user authentication has moved from distributed license codes to accounts, passwords, verified email, and server-side entitlements. When signed out, the popup is an account screen. Registration requires email verification, and password recovery uses the verified account email.

旧 `licenses / activations / devices / window_leases` 表暂时保留在数据库中，仅用于升级回滚和历史审计。客户端不再使用授权码；旧授权 API 返回 HTTP 410，后台 UI 也不再提供授权码生成/管理入口。

Legacy license tables are retained only for rollback/history. The client no longer uses license codes; legacy license APIs return HTTP 410 and the admin UI no longer exposes license-code management.

## 2. 用户生命周期 / User lifecycle

1. 用户在插件 Popup 选择“注册”。
2. 输入邮箱和至少 10 位密码。
3. 服务端使用 scrypt 保存密码摘要，不保存明文密码。
4. 服务端发送 6 位邮箱验证码；数据库只保存验证码 HMAC，不保存验证码明文。
5. 验证成功后账号激活，并获得后台配置的免费期限/设备上限/同时窗口上限。
6. 用户使用邮箱 + 密码登录。服务端签发随机会话令牌；数据库只保存令牌 SHA-256，原始令牌只保存在浏览器 `chrome.storage.local`。
7. 免费期或会员有效时，后台心跳向插件返回当前权益和允许使用的 ChatGPT 浏览器窗口。
8. 免费期/会员到期后仍可登录账户中心和购买会员，但 GPTLock 请求锁定与自动验证不再启用。

1. A user registers from the extension popup.
2. The password is at least 10 characters.
3. Passwords are stored as salted scrypt hashes, never plaintext.
4. A six-digit email code is sent; only an HMAC of the code is persisted.
5. After verification, the configured free entitlement begins.
6. Login returns a random session token; only its SHA-256 hash is persisted on the server, while the raw token stays in `chrome.storage.local`.
7. While free/member entitlement is active, heartbeat returns limits and allowed ChatGPT windows.
8. Expired users can still access the account center and purchase membership, but GPTLock request locking/auto-verification remains disabled.

## 3. 权益模型 / Entitlement model

默认免费权益：

- 免费期：7 天；
- 设备：1 台；
- 同时 ChatGPT 窗口：1 个。

Default free entitlement: 7 days, one device, and one simultaneous browser window containing ChatGPT.

默认会员套餐（均可在后台修改）：

| 套餐 / Plan | 默认价格 | 天数 | 设备 | 同时窗口 |
|---|---:|---:|---:|---:|
| 月卡 / Monthly | ¥19.00 | 30 | 3 | 3 |
| 季卡 / Quarterly | ¥49.00 | 90 | 5 | 5 |
| 年卡 / Yearly | ¥169.00 | 365 | 10 | 10 |

后台可以给单个用户设置设备/窗口覆盖值。覆盖值优先于免费/会员套餐值。会员续费时不会覆盖未到期时间：新会员从现有最晚到期时间继续顺延。

Administrators may set per-user device/window overrides. Overrides take precedence over plan defaults. Renewals chain after the latest active membership expiry instead of discarding unused time.

“同时窗口”只应统计当前存在 `chatgpt.com` 标签页的 Chrome 窗口，而不是用户打开的所有浏览器窗口。

“Simultaneous windows” means Chrome windows that currently contain a `chatgpt.com` tab, not every browser window on the machine.

## 4. 会员与支付 / Membership & payment

服务端内置 `monthly / quarterly / yearly` 三种计划模型。插件账户中心从服务端读取价格、期限、设备/窗口上限和权益文案，因此修改套餐不需要重新发布插件。

The extension reads plan price, duration, limits, and benefit copy from the server, so plan changes do not require a new extension release.

支付方式支持后台配置：

- 微信支付 / WeChat Pay
- 支付宝 / Alipay

当前第一阶段提供：启用/停用支付方式、HTTPS 支付页面、付款说明、创建待支付订单、后台“确认到账”、确认后自动发放会员。

The first production stage provides payment-method enablement, HTTPS payment entry URLs, instructions, pending orders, admin payment confirmation, and automatic membership granting after confirmation.

**重要：**真正的微信/支付宝“自动到账回调”需要对应商户平台提供的商户号、API v3 密钥/证书或支付宝应用私钥/公钥等商户凭据。仓库不会伪造这些凭据，也不会在没有真实商户配置时把普通跳转页宣称成自动支付网关。后续接入真实网关时，应增加服务端签名验证、金额/订单号比对、幂等回调和退款状态。

**Important:** fully automated WeChat/Alipay settlement requires real merchant credentials. A future gateway integration must verify provider signatures, amount/order identity, callback idempotency, and refund state.

## 5. 邮箱系统 / Email

后台可配置：

- SMTP 主机；
- 端口；
- SMTPS（例如 465）或 STARTTLS（例如 587）；
- 用户名；
- SMTP 密码/授权码；
- 发件邮箱；
- 发件名称；
- 测试邮件。

SMTP credentials are configured from the admin console. The mail client accepts implicit TLS or STARTTLS and refuses plaintext SMTP transport.

SMTP 密码通过 AES-256-GCM 加密后存入 SQLite `secure_settings`，密钥由现有服务端主密钥 `GPTLOCK_LICENSE_SECRET` 派生。主密钥仍必须只存在生产环境变量/受保护的 systemd EnvironmentFile 中，禁止提交到 Git。

The SMTP secret is stored as AES-256-GCM ciphertext in `secure_settings`, using a key derived from the server secret. The server secret must remain outside the repository.

## 6. 数据表 / Database tables

账号系统新增：

- `users`：账号、密码摘要、邮箱验证、免费期、覆盖限额；
- `user_devices`：设备绑定；
- `user_sessions`：登录会话令牌摘要；
- `user_window_leases`：活动 ChatGPT 窗口租约；
- `email_tokens`：邮箱验证/重置码 HMAC 与尝试次数；
- `membership_plans`：会员套餐；
- `memberships`：用户会员记录；
- `payment_methods`：微信/支付宝配置；
- `membership_orders`：会员订单；
- `secure_settings`：加密敏感配置；
- `account_audit_log`：账号安全/管理审计。

All new tables are additive. Existing production data is not destructively migrated.

## 7. 管理后台 / Admin console

新版后台主要区域：

- 总览：用户数、已验证用户、有效会员、待处理订单；
- 用户：启用/停用、免费期限、设备/窗口覆盖上限、开通会员、重置设备；
- 会员：修改月/季/年价格、期限、限制和权益文案；
- 订单：查看订单、确认到账、取消；
- 系统配置：免费权益、登录会话时长、SMTP、微信/支付宝；
- 日志：运行日志和账户审计；
- 更新：原有安全自动更新流程。

The new console manages users, plans, orders, SMTP/payment settings, audit/runtime logs, and the existing safe updater.

## 8. 安全边界 / Security boundary

账号验证必须在 **Background 实际执行路径** 中生效，而不是只隐藏 Popup 按钮。未登录、权益过期或当前 ChatGPT 窗口超出额度时：

- 网络请求锁定器不附加；
- GPTLock 启用请求被拒绝；
- 自动验证被拒绝；
- 普通 ChatGPT 页面仍保持可用。

Authentication is enforced in the extension background execution path, not only in the popup UI.

但是，本地扩展/Native Core 最终运行在用户控制的计算机上，因此“账号体系”不能被描述为不可破解 DRM。具备修改扩展或二进制能力的用户理论上可以尝试移除本地检查。真正不可绕过的商业能力必须依赖受控服务端，或以后增加服务端签名权益证明并由更低层可信组件验证。

Because the extension and Native Core run on user-controlled machines, this is not unbreakable DRM. Stronger commercial enforcement requires server-controlled capability or cryptographically signed entitlements verified by a trusted lower-level component.

## 9. 上线检查 / Production checklist

- `GPTLOCK_LICENSE_SECRET` 至少 32 字节随机值，并备份到安全密码库；
- 管理员密码使用独立的高熵随机密码；
- 配置有效 SMTP，并完成真实注册/找回密码收信测试；
- HTTPS 反代开启 HSTS；
- Nginx/Cloudflare 对登录、注册、验证码、后台增加 IP/连接限流；
- `/admin/` 推荐使用 Cloudflare Access、VPN 或 IP 白名单；
- 数据库目录保持仅服务账户可写；
- 定期验证 SQLite 在线备份和恢复；
- Windows 正式分发建议配置 Authenticode；
- 不在日志中记录密码、验证码、SMTP 密码、会话令牌或聊天正文；
- 如果接入真实微信/支付宝 API，商户私钥必须进入密钥管理而不是 SQLite 明文字段或 Git。
