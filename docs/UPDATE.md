# 更新与发布 / Updates & Releases

GPTLock 建议使用正式版本和产品内更新入口。

## 用户更新

- Windows：优先使用产品内更新或重新运行最新正式安装器；
- Linux：使用正式发布的对应软件包更新；
- 官网版本页会展示当前正式版本和可下载文件。

更新完成后如果浏览器仍显示旧界面，完全退出并重新打开浏览器。

## 服务端更新

GPTLock 管理后台提供服务端更新入口。管理员应在确认备份、服务状态和访问权限正常后执行更新，并观察页面给出的进度与结果。

公开文档不描述服务端更新器的特权执行细节、仓库访问策略、回滚实现或其他可被直接复制的内部运维机制。

## 正式发布

正式版本由仓库的受控 CI / Release 流程生成。公开发布物可以包括：

- Windows 安装程序；
- Linux 软件包；
- 浏览器扩展发行文件；
- 必要的本地组件发行文件；
- SHA-256 校验信息。

随着 public/private split 推进，实现敏感组件会逐步改为由私有源码构建，再以发行制品进入公开发布流程。公开仓库只保留制品消费、打包和兼容性合同，不公开私有实现源码。

## English

Use official GPTLock releases and in-product update flows. The public repository documents release artifacts and compatibility expectations, not privileged deployment mechanics. As the split-source migration progresses, implementation-sensitive components will be built from private source and consumed by the public distribution pipeline as release artifacts.
