# 安全与隐私 / Security & Privacy

GPTLock 的公开安全文档只描述用户需要知道的边界，不公开可用于复刻核心实现的检测规则、字段清单、判定权重、内部状态机或通信细节。

## 用户数据原则

- GPTLock 只应处理完成产品功能所需要的数据；
- 正常运行日志和服务端日志应避免保存聊天正文、密码、Cookie、访问令牌或其他凭据；
- 用户主动导出的诊断文件可能包含更多用于排障的信息，分享前应视为敏感文件处理；
- 账户密码不会以明文方式保存；
- 网站与插件会话应支持注销和失效管理；
- 管理后台不应作为无需额外保护的公共入口使用，生产环境建议配合 HTTPS、WAF、访问控制或 IP 限制。

## 产品边界

GPTLock 运行在用户自己的浏览器和设备上，因此不能把客户端侧机制描述成不可破解的 DRM，也不能承诺绕过 ChatGPT 的套餐、额度、区域或模型可用性限制。

GPTLock 的状态和诊断用于帮助用户了解产品是否按预期工作，但不应把客户端观察结果宣传成对第三方后端内部调度的密码学证明。

## public/private split

新的实现敏感安全逻辑由私有核心维护。公开仓库只保留：

- 用户可理解的安全边界；
- 必要的配置/兼容接口；
- 安装和发布安全措施；
- 非敏感的运维与诊断说明。

内部识别规则、证据策略、请求处理算法、上下文学习、反复刻设计以及其他核心实现不在公开文档中展开。

## 密钥与仓库卫生

任何仓库都不应提交真实生产密码、私钥、API Token、Cookie、浏览器 Profile、用户数据库、SMTP 凭据或真实聊天内容。公开仓库还额外禁止提交私有核心源码、私有覆盖层和私有构建材料。

## English

GPTLock follows data-minimization and credential-hygiene principles. Public documentation describes user-facing security boundaries, not proprietary detection, decision, verification, learning, or anti-replication algorithms. Sensitive implementation belongs to the private core, while this repository keeps only the public compatibility and distribution surface.
