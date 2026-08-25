# 浏览器扩展 / Browser Extension

> 默认中文，English follows.

GPTLock 扩展面向 `https://chatgpt.com/*`，支持 Chrome、Chromium 和 Edge 的 Manifest V3 环境。

当前实现：

- 多模型、多推理强度与严格/提醒模式设置；
- 旧字段 `models`、`reasoningLevels` 自动迁移；
- 通过 `com.gptlock.core` Native Messaging 主机同步策略和验证观测；
- 本地核心在线状态、最近验证与证据来源展示；
- 页面模型文字的提示级观测（固定标注 `page_dom`，不能得到 `verified`）；
- 扩展图标徽章：`OK` 已验证、`MIS` 不匹配、`?` 未验证、`OFF` 本地核心离线。

扩展不会读取或记录聊天正文。当前版本也不会仅凭 DOM 结果阻断 ChatGPT 发送；真正的响应元数据关联与发送前阻断将在 Phase 4 接入。

开发加载：

1. 打开 `chrome://extensions` 或 `edge://extensions`；
2. 启用开发者模式；
3. 选择“加载已解压的扩展程序”，加载本目录；
4. 复制扩展 ID，运行对应系统的 Native Core 安装脚本；
5. 完全重启浏览器并打开扩展设置页。

运行无依赖测试：

```bash
cd extension
npm test
```

## English

The Manifest V3 extension targets official `chatgpt.com` pages on Chrome, Chromium, and Edge. It stores multi-value policies, migrates the legacy field names, synchronizes with `com.gptlock.core`, displays connection and evidence status, and reports limited DOM observations as `page_dom` evidence.

It does not read or log chat content. DOM labels are informational only and cannot produce `verified`. Response-metadata correlation and pre-send enforcement remain Phase 4 work.
