from pathlib import Path


def patch(path, old, new, count=1):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} matches, got {actual}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count), encoding="utf-8")


old = """    const frameId = `ws-${requestId}-${++this.webSocketSequence}`;
    if (direction === 'sent') {
      if (!exact) return;
      this.onStreamData?.(tabId, {
        requestId: frameId,
        capturedAt: new Date().toISOString(),
        rawStreamData: payload,
        streamContext,
        diagnostics: {
          endpoint: socket.endpoint,
          httpStatus: 101,
          mimeType: 'application/websocket',
          bodyFormat: 'websocket_frame',
          transport: 'websocket',
          direction,
          stage: 'downstream_websocket',
        },
      });
      return;
    }

    const evidence = extractResponseEvidence({ body: payload, headers: {}, mimeType: 'application/json' });"""
new = """    if (direction === 'sent') return;
    const frameId = `ws-${requestId}-${++this.webSocketSequence}`;
    const evidence = extractResponseEvidence({ body: payload, headers: {}, mimeType: 'application/json' });"""
patch("extension/network-monitor.js", old, new)

patch(
    "extension/background.js",
    "仅自动验证固定测试消息对应的初始 SSE、handoff 后续 SSE 与已匹配 topic 的 WebSocket 帧进入诊断包",
    "仅自动验证固定测试消息对应的初始 SSE、handoff 后续 SSE 与已匹配 topic 的服务端 WebSocket 接收帧进入诊断包",
)
patch(
    "extension/background.js",
    "Only the fixed auto-verification probes may contribute initial SSE, post-handoff SSE, and WebSocket frames matched to the handoff topic",
    "Only the fixed auto-verification probes may contribute initial SSE, post-handoff SSE, and server-to-client WebSocket frames matched to the handoff topic",
)
patch(
    "docs/SECURITY.md",
    "post-handoff SSE or WebSocket frames",
    "post-handoff SSE or server-to-client WebSocket frames",
)

print("privacy cleanup applied")
