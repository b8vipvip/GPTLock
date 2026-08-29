# Windows 代码签名 / Windows Code Signing

GPTLock 的 Windows 一键更新会先验证 GitHub Release 元数据中公布的 SHA-256，再由本地 Core 启动安装器。浏览器下载的 EXE 会附带 Mark-of-the-Web（`Zone.Identifier`）；从 v0.5.6 起，一键更新仅在 SHA-256 完全匹配后移除该下载标记，以避免隐藏更新进程被 Attachment Manager / SmartScreen 的交互提示阻塞。

手工从浏览器下载并双击 `GPTLockSetup-x64.exe` 时，Windows 是否显示“未知发布者”取决于 Authenticode 数字签名。SHA-256 校验不能替代发布者签名。要让手工安装也显示可信发布者，需要为 Release 配置受 Windows 信任的代码签名证书。

## GitHub Actions Secrets

Release 工作流支持以下仓库 Secrets：

- `GPTLOCK_CODESIGN_PFX_BASE64`：代码签名 PFX/P12 文件的 Base64 内容。
- `GPTLOCK_CODESIGN_PFX_PASSWORD`：PFX 密码。
- `GPTLOCK_CODESIGN_TIMESTAMP_URL`：可选 RFC3161 时间戳地址；为空时使用 `http://timestamp.digicert.com`。

当 `GPTLOCK_CODESIGN_PFX_BASE64` 未配置时，Release 仍会正常构建，但 Windows Setup 会保持未签名状态并在日志中给出警告。

当证书配置存在时，Release 会：

1. 构建 `gptlock-core.exe`；
2. 对 `gptlock-core.exe` 执行 SHA-256 Authenticode 签名并校验 `Get-AuthenticodeSignature` 为 `Valid`；
3. 使用已签名 Core 构建 Inno Setup；
4. 对 `GPTLockSetup-x64.exe` 再次签名并验证；
5. 删除 Runner 上的临时 PFX 文件；
6. 仅在上述步骤全部成功后上传正式 Release 资产。

不要把 PFX 文件、密码或 Base64 内容提交到仓库。推荐使用公开受信任的 OV/EV Code Signing 证书，或支持公开受信任 Authenticode 的云签名服务。
