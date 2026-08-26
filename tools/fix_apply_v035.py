from pathlib import Path

path = Path(__file__).with_name('apply_v035_hotfix.py')
text = path.read_text(encoding='utf-8')
needle = '''def regex_once(path: str, pattern: str, replacement: str) -> None:\n'''
helper = '''def replace_first(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count < 1:\n        raise RuntimeError(f"{path}: expected at least one exact match: {old[:80]!r}")\n    write(path, text.replace(old, new, 1))\n\n\n'''
if helper not in text:
    if needle not in text:
        raise RuntimeError('regex_once marker missing')
    text = text.replace(needle, helper + needle, 1)
old_call = '''replace_once(\n    "extension/background.js",\n    "    evidenceIssue: state.evidenceIssue,\\n    lastError: state.lastError,\\n    updatedAt: state.updatedAt,\\n",\n'''
new_call = '''replace_first(\n    "extension/background.js",\n    "    evidenceIssue: state.evidenceIssue,\\n    lastError: state.lastError,\\n    updatedAt: state.updatedAt,\\n",\n'''
if old_call in text:
    text = text.replace(old_call, new_call, 1)
elif new_call not in text:
    raise RuntimeError('background public state replacement marker missing')
path.write_text(text, encoding='utf-8')
print('Applicator repaired')
