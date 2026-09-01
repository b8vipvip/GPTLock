# 浏览器扩展 / Browser Extension

GPTLock 浏览器扩展面向官方 `chatgpt.com` 网页，支持 Chrome、Chromium 和 Edge Manifest V3。

## 用户侧职责

扩展提供：

- GPTLock 开关和状态显示；
- 模型与推理偏好设置入口；
- 账户登录与权益状态；
- 自动验证和诊断入口；
- 与已安装 GPTLock 本地组件的兼容通信；
- 更新与版本入口。

## public/private split

此目录正在逐步收敛为**薄客户端壳层**。新的实现敏感判断、验证、学习和决策能力不应继续写入公开 JavaScript 源码，而由私有核心实现并通过稳定合同返回结果。

v0.5.x 仍保留一部分旧实现文件来维持现有发行版兼容。这些文件已经冻结，不代表未来公共扩展架构，也不应继续添加新的专有逻辑。

公共兼容边界见 `../contracts/core-bridge.schema.json`。

## 开发

公开扩展开发应优先集中在 UI、账户体验、安装状态、非敏感诊断和兼容桥接。涉及核心策略或判断规则的变更应在私有实现中完成。

## English

The GPTLock browser extension is being reduced to a thin public client shell for UI, account state, diagnostics, updates, and compatibility bridging. New proprietary decision, verification, detection, and learning logic belongs to the private core rather than readable public JavaScript. Legacy v0.5.x implementation files remain temporarily for release compatibility and are frozen during migration.
