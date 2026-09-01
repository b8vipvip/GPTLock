from pathlib import Path

p = Path('extension/private-context-budget-authority.js')
text = p.read_text()
old = '''  function sourceIsFresh(source) {\n    const measuredAt = Date.parse(source?.measuredAt || '');\n    return Number.isFinite(measuredAt) && Date.now() - measuredAt <= MAX_SOURCE_AGE_MS;\n  }\n'''
new = '''  function sourceIsFresh(source, maxAgeMs = MAX_SOURCE_AGE_MS) {\n    const measuredAt = Date.parse(source?.measuredAt || '');\n    return Number.isFinite(measuredAt) && Date.now() - measuredAt <= maxAgeMs;\n  }\n'''
if text.count(old) != 1:
    raise SystemExit('sourceIsFresh target mismatch')
text = text.replace(old, new, 1)
old = '''    if (!source || !sourceIsFresh(source) || !Array.isArray(source.history) || !source.history.length) return null;\n'''
new = '''    const maxAgeMs = refreshHistory ? 5_000 : MAX_SOURCE_AGE_MS;\n    if (!source || !sourceIsFresh(source, maxAgeMs) || !Array.isArray(source.history) || !source.history.length) return null;\n'''
if text.count(old) != 1:
    raise SystemExit('source freshness target mismatch')
text = text.replace(old, new, 1)
old = '''  async function evaluate({ reason = 'background', refreshHistory = false, force = false } = {}) {\n    const now = Date.now();\n    if (inFlight) return { ok: false, error: 'private_context_budget_busy' };\n    if (!force && api.state?.retryAfter && now < api.state.retryAfter) return { ok: false, error: api.state.error || 'private_context_budget_backoff' };\n    const input = await evaluationSource(refreshHistory);\n    if (!input) return failure('full_history_unavailable', true);\n\n    inFlight = true;\n    lastAttemptAt = now;\n    try {\n      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload: input.payload });\n'''
new = '''  async function evaluate({ reason = 'background', refreshHistory = false, force = false } = {}) {\n    const now = Date.now();\n    if (inFlight) return { ok: false, error: 'private_context_budget_busy' };\n    if (!force && api.state?.retryAfter && now < api.state.retryAfter) return { ok: false, error: api.state.error || 'private_context_budget_backoff' };\n\n    inFlight = true;\n    lastAttemptAt = now;\n    try {\n      const input = await evaluationSource(refreshHistory);\n      if (!input) return failure('full_history_unavailable', true);\n      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload: input.payload });\n'''
if text.count(old) != 1:
    raise SystemExit('evaluate target mismatch')
text = text.replace(old, new, 1)
p.write_text(text)
