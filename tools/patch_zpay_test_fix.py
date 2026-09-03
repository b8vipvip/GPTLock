from pathlib import Path
p = Path(__file__).resolve().parents[1] / 'license-server/test/payment-system.test.mjs'
text = p.read_text(encoding='utf-8')
old = """    PRAGMA foreign_keys=ON;\n    CREATE TABLE payment_methods (\n"""
new = """    PRAGMA foreign_keys=ON;\n    CREATE TABLE app_settings (\n      key TEXT PRIMARY KEY,\n      value TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    ) STRICT;\n    CREATE TABLE payment_methods (\n"""
if old not in text:
    raise SystemExit('legacy fixture anchor missing')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('legacy fixture updated')
