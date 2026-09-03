# GPTWork Local Core / 本地组件

GPTWork 在 Windows 与 Linux 上安装一个本地组件，用于完成浏览器扩展单独不适合承担的本地能力。

## 用户需要知道什么

- 本地组件应随正式 GPTWork 安装包一起安装和更新；
- 插件显示“组件在线/正常”即可，不要求用户理解内部协议；
- 本地组件不用于绕过 ChatGPT 套餐、额度、区域或模型限制；
- 遇到离线或版本不一致时，优先使用正式安装器、修复入口或更新功能；
- 用户主动导出的诊断信息应按敏感文件处理。

## public/private split

当前 `native-core` 目录是 v0.5.x 公开发行链路的兼容基线。随着私有核心迁移推进，新的实现敏感能力将从私有源码构建为发行制品，公开仓库只保留必要的启动/安装/兼容壳层和版本合同。

因此，本目录中的旧实现源码已经冻结，不是继续开发专有判断、验证或学习逻辑的位置。

公共兼容接口见 `../contracts/core-bridge.schema.json`，架构边界见 `../PRIVATE_CORE_BOUNDARY.md`。

## English

GPTWork installs a local component on Windows and Linux. Users only need to know whether it is installed, online, compatible, and up to date. The current public `native-core` source is a frozen v0.5.x migration baseline. New proprietary implementation-sensitive behavior is moving to a privately built core artifact behind a stable public compatibility contract.
