# 账户系统 / Account System

GPTLock 账户用于统一管理用户登录、权益、设备、会话和会员状态。

## 用户可见能力

- 使用邮箱和密码登录；
- 查看当前权益和有效期；
- 查看并释放已绑定设备；
- 注销不再使用的插件或网页登录会话；
- 修改账户密码；
- 查看可购买方案和自己的订单状态。

网站账户中心和插件使用同一账户体系，但网页登录本身不占用插件设备名额。

## 管理员可见能力

管理后台可用于维护用户、权益、会员方案、订单、系统配置和运行日志。生产环境应通过 HTTPS 并结合额外访问控制保护管理入口。

## 安全原则

账户实现遵循常规安全原则：密码不明文保存、会话可撤销、敏感操作需要认证、输入进行边界校验、生产密钥不进入仓库。具体密码派生参数、令牌存储方式、验证码策略、限流规则、数据库表结构和内部权限判定属于服务端实现细节，不作为公开复刻文档提供。

## public/private split

公开仓库继续保留用户界面、公共 API 兼容边界和部署所需的非敏感说明。新的账户风控、反滥用、权益判定和安全内部实现应在私有服务端/核心侧演进，不在公开文档中逐项披露。

## English

The GPTLock account system manages login, entitlements, devices, sessions, memberships, and orders. Public documentation covers user-facing behavior and general security expectations only. Password parameters, token internals, rate-limit rules, database structure, fraud controls, and other security-sensitive implementation details are intentionally not documented here.
