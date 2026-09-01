from pathlib import Path
import re

TARGET = "0.5.29"
PREVIOUS = "0.5.28"


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if new in text and old not in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one {old!r}, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_exact(
    "extension/manifest.json",
    f'"version": "{PREVIOUS}"',
    f'"version": "{TARGET}"',
)
replace_exact(
    "extension/package.json",
    f'"version": "{PREVIOUS}"',
    f'"version": "{TARGET}"',
)
replace_exact(
    "native-core/Cargo.toml",
    f'version = "{PREVIOUS}"',
    f'version = "{TARGET}"',
)

lock = Path("native-core/Cargo.lock")
text = lock.read_text(encoding="utf-8")
old_pattern = re.compile(
    rf'(\[\[package\]\]\nname = "gptlock-core"\nversion = "){re.escape(PREVIOUS)}(")'
)
new_pattern = re.compile(
    rf'(\[\[package\]\]\nname = "gptlock-core"\nversion = "){re.escape(TARGET)}(")'
)
if old_pattern.search(text):
    text, count = old_pattern.subn(rf'\g<1>{TARGET}\g<2>', text, count=1)
    if count != 1:
        raise SystemExit("native-core/Cargo.lock: failed to update gptlock-core package version")
    lock.write_text(text, encoding="utf-8")
elif not new_pattern.search(text):
    raise SystemExit("native-core/Cargo.lock: gptlock-core package version was not recognized")

checks = {
    "extension/manifest.json": f'"version": "{TARGET}"',
    "extension/package.json": f'"version": "{TARGET}"',
    "native-core/Cargo.toml": f'version = "{TARGET}"',
    "native-core/Cargo.lock": f'name = "gptlock-core"\nversion = "{TARGET}"',
}
for path, marker in checks.items():
    if marker not in Path(path).read_text(encoding="utf-8"):
        raise SystemExit(f"{path}: target version validation failed")

print(f"GPTLock release metadata prepared for {TARGET}")
