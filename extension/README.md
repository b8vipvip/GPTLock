# 浏览器扩展 / Browser Extension

> 默认中文，English follows.

GPTLock `0.3.1` 扩展只匹配 `https://chatgpt.com/*`，支持 Chrome、Chromium 和 Edge Manifest V3。

已实现：

- 多模型、多推理强度、严格/提醒模式；
- 首选推理强度和保守的页面菜单自动对齐；
- `chrome.debugger` + CDP Network 响应关联；
- JSON、SSE 和白名单响应头的模型/推理元数据提取；
- 冲突/缺失元数据安全降级；
- 首次探测、等待、Verified、Mismatch、Unverified 状态机；
- 发送按钮、Enter 与表单提交的同步守卫；
- 双语弹窗、设置页、页面小型状态指示器与每标签页徽章；
- Native Messaging 策略同步和验证。

运行文件测试：

```bash
node --test extension/tests/*.test.mjs
```

开发加载：在扩展管理页开启开发者模式，加载本目录。**这一步只安装扩展，不会安装 Native Core。** 还必须先运行 Windows Setup/源码安装脚本或安装 Linux deb；否则 Chrome 会返回 `Specified native messaging host not found`。manifest 公钥使官方目录的 ID 固定为 `bhchcpeodphgjfjoookncemnamdbfcof`，本地核心清单必须允许该 ID。

扩展不会持久化聊天正文、请求体或响应体。DOM、自动点击和请求元数据只用于预检，不能产生 `verified`。详见 [使用方法](../docs/USAGE.md) 与 [安全边界](../docs/SECURITY.md)。

## English

The v0.3.1 MV3 extension targets only official `chatgpt.com` pages. It provides policy settings, conservative UI alignment, CDP Network correlation, whitelisted JSON/SSE response-metadata extraction, strict send interception, a one-probe state machine, popup/status UI, Native Messaging, and actionable Local Core installation diagnostics. Loading this directory installs only the extension; Setup, a platform package, or a source installer must separately register the Native Core.

Chat bodies and complete network payloads are never persisted. DOM labels, automatic selection, and request metadata are preflight-only and cannot produce `verified`. The committed public manifest key gives official unpacked builds the stable ID shown above.
