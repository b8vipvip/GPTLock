from pathlib import Path
p = Path(__file__).resolve().parents[1] / 'extension' / 'context-budget.js'
s = p.read_text(encoding='utf-8')
old = "    if (!key || snapshot?.historyMeasurementSource !== 'conversation-tree+dom-reconcile') return null;\n"
new = "    if (!key || snapshot?.historyMeasurementSource !== 'conversation-tree+dom-reconcile') return null;\n    if (snapshot.conversationKey !== currentConversationKey()) return null;\n"
if s.count(old) != 1:
    raise SystemExit(f'expected one persistence guard, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('checkpoint navigation guard added')
