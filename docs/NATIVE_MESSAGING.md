# 本地组件兼容接口 / Local Core Compatibility

GPTWork 的浏览器端与本地组件通过版本化接口通信。

公开文档只保证以下兼容原则：

- 请求和响应带有协议版本；
- 请求具有可关联的 ID；
- 失败返回稳定错误代码；
- 接口只传递完成用户功能所需的最小数据；
- 聊天正文、登录凭据和其他不必要的敏感数据不应成为公共接口的一部分；
- 新版核心能力通过向后兼容的合同演进，客户端不依赖内部实现细节。

当前 public/private split 的下一代公共消息边界定义在：

`contracts/core-bridge.schema.json`

该 schema 只描述客户端能够请求哪类能力以及通用响应外形，不描述模型识别、请求判断、证据分析、上下文学习等内部算法。

旧版 v0.5.x 本地通信实现仍暂时存在于公开树中用于兼容现有发布，但已经冻结，不作为新的公共开发接口继续扩展。

## English

GPTWork exposes a versioned compatibility boundary between the browser client and the released local core. The public contract defines message identity, versioning, bounded inputs/outputs, and stable errors only. Internal policy, verification, learning, and detection algorithms are intentionally outside the public protocol documentation.
