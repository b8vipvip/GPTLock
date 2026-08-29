from pathlib import Path

root = Path(__file__).resolve().parents[1]
updates = {
    root / 'extension' / 'manifest.json': ('"version": "0.5.4"', '"version": "0.5.5"'),
    root / 'extension' / 'package.json': ('"version": "0.5.4"', '"version": "0.5.5"'),
    root / 'native-core' / 'Cargo.toml': ('version = "0.5.4"', 'version = "0.5.5"'),
}
for path, (old, new) in updates.items():
    text = path.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one {old!r}, got {text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('version sources bumped to 0.5.5')
