# GPTWork Chrome / Edge 扩展商店上架整改方案

> 状态：方案文档。除“商店资源”和“隐私体系”两项外，本文件中的整改项**本轮不修改代码**。
>
> 基线：`main` @ `4798f52b6aed0ed84c058e92f2720ab75fe7c6fa`，Manifest V3，当前版本 `0.5.34`。

## 1. 目标与原则

目标是在不削弱 GPTWork 核心能力的前提下，使 Chrome Web Store 与 Microsoft Edge Add-ons 的提交包、商店元数据、权限说明、隐私披露、Native Messaging 安装链和更新机制满足公开商店审核要求。

原则：

1. **单一用途**：GPTWork 的公开定位固定为“在 ChatGPT 官方网页聊天中保存/应用用户选择的模型与推理偏好，并提供请求锁定和响应证据确认”。不扩展成通用抓包器、网页自动化器或浏览历史分析器。
2. **最小权限**：每个 Manifest 权限必须能对应一个当前可见功能；不能为了未来功能预留权限。
3. **最小数据**：普通聊天正文不进入 GPTWork 服务端；运行日志必须脱敏；自动验证原始流仅限固定验证流程、本机缓存和用户主动导出。
4. **商店版与 GitHub 独立版分离**：商店版由 Chrome/Edge 商店更新扩展本体；Native Core 保留独立安装与更新通道。
5. **审核可解释**：`debugger`、`nativeMessaging`、`tabs`、host permissions 等高敏感能力必须提供逐项、可复现的 reviewer notes。

## 2. 整改清单

### P0-A：Store build profile（待实施，本轮不改代码）

建立明确的 `store` 构建模式，与 GitHub/独立安装包分离：

- 商店 ZIP 不携带私有 Native Core / Private Engine 二进制。
- 商店 ZIP 不包含扩展自更新器或绕过商店更新的扩展本体下载/安装逻辑。
- Native Core 仍由 GPTWork 官网提供独立安装器，并在扩展首次运行时明确告知用户需要本地组件。
- CI 新增 `store-package` 检查：禁止远程可执行代码、禁止未声明文件、验证 Manifest/图标/版本/隐私链接一致性。
- Chrome 与 Edge 产物可共用源码，但允许不同 Manifest overlay，以适配各自 Store ID 和更新策略。

**验收门槛**：能生成 `gptlock-chrome-store.zip` 与 `gptlock-edge-store.zip`，解压后均可在对应浏览器开发者模式运行，且包内无本地可执行文件。

### P0-B：权限最小化审计（待实施，本轮不改代码）

逐项验证当前权限：

- `debugger`：核心权限。仅附加 `chatgpt.com` 标签页，用于 CDP 网络请求观察、模型/推理参数锁定及响应证据确认。必须保留时，在商店后台给出完整 reviewer justification。
- `nativeMessaging`：与用户主动安装的 GPTWork Native Core 通信；保留。
- `storage`：保存锁定策略、设置、账户会话、本地诊断状态；保留。
- `alarms`：Native Core 重连、账户心跳、运行日志批量上传等周期任务；保留。
- `tabs`：重新审计是否可用 `activeTab`、sender tab 或更窄 API 替代；若不能替代，记录具体调用点。
- `downloads`：商店版优先移除。扩展本体更新交给商店；如仍有用户主动导出/下载功能，验证是否真的需要 downloads API。
- `unlimitedStorage`：重点审计。自动验证原始流已有 10 MiB 上限，应评估是否可移除并使用普通 storage quota。
- `https://chatgpt.com/*`：保留，限定核心功能站点。
- `https://gptlock.mv3.cn/*`：保留，仅用于账户、权益、运行日志和版本/支持服务。

**验收门槛**：形成权限矩阵，所有保留权限均有“功能 → 调用点 → 用户可见价值 → 无更窄替代”的证据。

### P0-C：Native Messaging 双商店身份（待实施，本轮不改代码）

Chrome Web Store 和 Edge Add-ons 发布后会得到各自正式 Extension ID。Native Host manifest 必须：

- 同时允许 Chrome 正式 ID 与 Edge 正式 ID；
- 不使用通配符 origin；
- 安装器能够在 Windows/Linux 正确注册两个浏览器所需 Native Messaging Host；
- 开发版 ID 与正式 Store ID 分离，避免生产安装器永久信任开发 ID；
- 首次运行清晰展示“扩展已安装 / Native Core 未安装”的状态和官方下载入口。

**依赖**：必须先在两个商店创建草稿项目取得正式 ID，之后才能最终固化。

### P0-D：隐私与数据流审计（本轮已开始实施）

当前真实数据流需要在商店后台与官网一致披露：

- 账户：邮箱；密码经 HTTPS 发送，服务端以 scrypt 哈希保存，不保存明文密码；会话令牌客户端本地保存，服务端保存 token hash。
- 设备/会话：device ID、browser instance ID、扩展 ID/版本、平台、会话时间、窗口租约/心跳信息。
- 网站账户中心：登录会话会记录 IP 和 User-Agent，用于安全会话展示与风控。
- 会员/订单：套餐、权益、订单状态、支付方式代码和支付跳转 URL；GPTWork 不应收集银行卡号等支付凭证。
- 运行日志：登录用户的扩展运行日志会自动批量上传到 `gptlock.mv3.cn`；敏感键会在客户端脱敏，服务端默认保留 30 天。
- 自动验证原始流：只在自动验证流程捕获固定探针对应的 SSE/WebSocket 响应流，本地合计上限 10 MiB；普通聊天正文不进入该诊断包；原始流可能包含短期 resume token、消息/会话 ID 和服务器元数据；只有用户主动导出诊断包时离开扩展本地存储。
- 浏览器同步：锁定策略/设置使用 `chrome.storage.sync` 时，可能由浏览器厂商账户同步基础设施处理。
- Native Core：扩展与本机 Native Core 通过 Native Messaging 本地通信。

本轮新增官网 Privacy Policy、Terms、Support、Data Deletion 页面，并补自助账户删除入口，使公开说明与当前实现保持一致。

### P1-A：商店资源（本轮已实施）

新增：

- Manifest PNG icons：16×16、32×32、48×48、128×128；
- Store logo：128×128、300×300；
- Chrome/Edge screenshot：1280×800；
- Small promo：440×280；
- 中英文 Store description、short description、reviewer notes 草案。

图像要求：不使用 OpenAI/Chrome/Edge 官方 Logo 作为 GPTWork 品牌标识；截图不得伪造不存在的功能或“官方认证”状态。

### P1-B：商店更新机制（待实施，本轮不改代码）

- Chrome/Edge 商店版扩展本体只由对应商店升级。
- 现有“检查更新”在 Store build 中改为显示商店版本状态/跳转商店页面，不直接下载安装扩展 ZIP。
- Native Core/Private Engine 可继续独立更新，但必须明确区分“扩展版本”和“本地核心版本”。
- 不允许 Native Core 修改、替换或侧载商店扩展本体。

### P1-C：Reviewer notes 与可复现审核脚本（待实施，本轮不改代码）

准备一份审核人员可执行流程：

1. 安装扩展；
2. 安装官方 Native Core；
3. 登录 GPTWork 测试账户；
4. 打开 `https://chatgpt.com/`；
5. 选择锁定模型/推理强度；
6. 启用 GPTWork；
7. 运行自动验证；
8. 说明何时调用 `debugger`、读取哪些网络证据、何时停止；
9. 演示禁用 GPTWork 后不再进行请求锁定；
10. 演示账户中心删除账户与数据。

审核账号不得使用真实付费用户数据；应提供专门测试账户和测试权益。

### P1-D：品牌与知识产权检查（待实施，本轮不改代码）

- Store 标题与描述明确 GPTWork 是第三方工具，不是 OpenAI 官方产品，也不暗示 OpenAI 背书。
- “ChatGPT”仅用于兼容性/功能描述，不复制 OpenAI 品牌视觉作为 GPTWork 图标。
- 所有截图、Promo、Logo 均由项目自有资产生成。

### P2：发布与运营流程（待实施，本轮不改代码）

- Chrome Developer Dashboard：创建项目、上传 ZIP、填写 Privacy practices、权限理由、数据使用、隐私 URL、商店图片与中英文描述。
- Edge Partner Center：创建项目、上传 ZIP、填写 Properties / Privacy / Store listings / Certification notes。
- 首发先走受限/隐藏测试，确认 Native Core 正式 ID、更新和账户登录链路，再切 Public。
- 每次发布前运行 Store compliance checklist；权限或数据实践变化必须同步更新 Privacy Policy 与 Store disclosures。

## 3. 建议的商店单一用途文本

**中文**：GPTWork 用于在 ChatGPT 官方网页聊天中保存并应用用户选择的模型与推理偏好，对相关聊天请求执行本地请求锁定，并向用户显示请求/响应证据状态，帮助发现模型偏好未被应用或发生异常切换的情况。

**English**: GPTWork saves and applies the user’s selected model and reasoning preferences on the official ChatGPT web experience, locally enforces those preferences on relevant chat requests, and shows request/response evidence so the user can detect when the selected preference was not applied or changed unexpectedly.

## 4. 发布前硬门槛

只有同时满足以下条件才建议提交公开审核：

- [ ] Store build 已与 GitHub 独立版分离；
- [ ] 权限矩阵完成，`downloads` / `tabs` / `unlimitedStorage` 已完成去留决策；
- [ ] Chrome 与 Edge 正式 Extension ID 已写入 Native Host allowlist；
- [x] 128 PNG icon、1280×800 screenshot、440×280 promo 已准备；
- [x] 中英文 Store description 已准备；
- [x] Privacy Policy / Terms / Support / Data Deletion 页面已加入项目；
- [ ] 线上部署后逐个验证上述公开 URL 可访问；
- [ ] Store Privacy disclosures 与代码实际数据流逐项核对；
- [ ] Reviewer test account 与审核步骤准备完成；
- [ ] CI 对 Store ZIP、远程代码、权限和敏感数据做发布阻断检查；
- [ ] Chrome 与 Edge 各完成一次测试渠道安装、升级、卸载、重装验证。

## 5. 本轮明确不做的改动

除商店资源与隐私体系外，本轮**不**删除或调整 Manifest 权限，不拆 Store build，不改扩展更新机制，不修改 Native Host allowlist，不创建商店账号，不提交 Chrome/Edge 审核。

这些工作应在下一阶段逐项实施并单独验证，避免为了“看起来更容易过审”而破坏 GPTWork 当前真实功能。