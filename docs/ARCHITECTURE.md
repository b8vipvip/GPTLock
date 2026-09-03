# 架构说明 / Architecture

GPTWork 对外只维护高层组件边界，不公开内部判断、识别、验证、学习或关联算法。

## 公开架构

GPTWork 由三类对用户可见的组件组成：

1. **浏览器端**：提供设置、状态、账户入口和 ChatGPT 网页集成。
2. **本地组件**：提供需要更高可信度或系统权限的本地能力，并通过版本化接口与浏览器端通信。
3. **GPTWork 服务端**：提供账户、权益、设备、版本、官网和管理能力。

公开组件之间只依赖稳定接口。实现敏感的核心行为在私有实现中开发，以发布构建产物形式交付，不在本仓库文档中描述其内部规则。

## public/private split

本仓库负责公开发行层：官网、用户界面、安装打包、发布元数据、公共兼容性合同和必要客户端壳层。

新的核心实现不再直接写入公开源码。当前仍保留的 v0.5.x 旧核心源码属于迁移兼容基线，冻结后只允许删除或进行明确批准的兼容/安全维护。

公共壳层与核心之间的兼容接口见 `contracts/core-bridge.schema.json`。该合同只约定消息边界，不定义内部算法。

更多说明见仓库根目录 `PRIVATE_CORE_BOUNDARY.md`。

## English

GPTWork publicly documents only its high-level component boundaries: browser integration, a local component, and GPTWork account/release services. Proprietary detection, decision, verification, learning, and correlation algorithms are private implementation details. The public repository carries distribution/UI code, packaging, public contracts, and legacy migration compatibility only.
