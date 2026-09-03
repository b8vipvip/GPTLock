from pathlib import Path
import json
import re
import subprocess

ROOT = Path('.')
manifest = json.loads(Path('extension/manifest.json').read_text(encoding='utf-8'))
if manifest.get('name') == 'GPTWork':
    print('GPTWork source transformation already applied.')
    raise SystemExit(0)

tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
binary_suffixes = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.exe', '.deb', '.gz', '.zip'}
pairs = [
    ('gptlock-private-engine', 'gptwork-private-engine'),
    ('gptlock_private_engine', 'gptwork_private_engine'),
    ('gptlock-license-server', 'gptwork-license-server'),
    ('gptlock-extension', 'gptwork-extension'),
    ('gptlock-core', 'gptwork-core'),
    ('gptlock_core', 'gptwork_core'),
    ('gptlock-engine', 'gptwork-engine'),
    ('gptlock-update', 'gptwork-update'),
    ('GptLock', 'GptWork'),
]
for name in tracked:
    if not name or name.startswith('.github/workflows/') or name == 'tools/tmp-gptwork-migrate.py':
        continue
    path = Path(name)
    if path.suffix.lower() in binary_suffixes:
        continue
    try:
        text = path.read_text(encoding='utf-8-sig')
    except (UnicodeDecodeError, OSError):
        continue
    original = text
    text = text.replace('GPTLock', 'GPTWork')
    text = re.sub(r'(?<![A-Za-z0-9_])GPTLOCK(?![A-Za-z0-9_-])', 'GPTWORK', text)
    for old, new in pairs:
        text = text.replace(old, new)
    # The repository slug is live infrastructure and must remain usable until a repo rename is performed.
    text = text.replace('b8vipvip/GPTWork', 'b8vipvip/GPTLock')
    if text != original:
        path.write_text(text, encoding='utf-8')

renames = {
    'packaging/windows/GPTLock.iss': 'packaging/windows/GPTWork.iss',
    'packaging/windows/Install-GPTLock.ps1': 'packaging/windows/Install-GPTWork.ps1',
    'packaging/windows/Repair-GPTLock.ps1': 'packaging/windows/Repair-GPTWork.ps1',
    'packaging/windows/Update-GPTLock.ps1': 'packaging/windows/Update-GPTWork.ps1',
    'packaging/linux/gptlock-core.deb.service': 'packaging/linux/gptwork-core.deb.service',
    'packaging/linux/gptlock-core.service': 'packaging/linux/gptwork-core.service',
}
for old, new in renames.items():
    if Path(old).exists():
        subprocess.run(['git', 'mv', old, new], check=True)

# Native Core data migration: new installs use GPTWORK_HOME/.gptwork; existing .gptlock is reused.
path = Path('native-core/src/config.rs')
text = path.read_text(encoding='utf-8')
text, count = re.subn(
    r'    pub fn discover\(\) -> Result<Self> \{.*?\n    \}\n\n    pub fn at',
    '''    pub fn discover() -> Result<Self> {
        for variable in ["GPTWORK_HOME", "GPTLOCK_HOME"] {
            if let Some(override_root) = env::var_os(variable) {
                if override_root.is_empty() {
                    bail!("{variable} is empty");
                }
                return Ok(Self::at(PathBuf::from(override_root)));
            }
        }
        let home = if cfg!(windows) {
            env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))
        } else {
            env::var_os("HOME")
        }
        .context("cannot determine the current user's home directory")?;
        let home = PathBuf::from(home);
        let preferred = home.join(".gptwork");
        let legacy = home.join(".gptlock");
        Ok(Self::at(if preferred.exists() || !legacy.exists() { preferred } else { legacy }))
    }

    pub fn at''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('ConfigStore::discover migration failed')
path.write_text(text, encoding='utf-8')

# Private engine canonical executable/env names with legacy fallback.
path = Path('native-core/src/private_engine.rs')
text = path.read_text(encoding='utf-8')
text = text.replace(
    'const PRIVATE_ENGINE_ENV: &str = "GPTLOCK_PRIVATE_ENGINE";',
    'const PRIVATE_ENGINE_ENV: &str = "GPTWORK_PRIVATE_ENGINE";\nconst LEGACY_PRIVATE_ENGINE_ENV: &str = "GPTLOCK_PRIVATE_ENGINE";',
)
text, count = re.subn(
    r'fn executable_name\(\) -> .*?\nfn usable_file',
    '''fn executable_name() -> &'static str {
    if cfg!(windows) { "gptwork-engine.exe" } else { "gptwork-engine" }
}

fn legacy_executable_name() -> &'static str {
    if cfg!(windows) { "gptlock-engine.exe" } else { "gptlock-engine" }
}

fn default_engine_path() -> Result<PathBuf> {
    let current = env::current_exe().context("resolve current executable")?;
    let directory = current.parent().context("resolve executable directory")?;
    let preferred = directory.join(executable_name());
    let legacy = directory.join(legacy_executable_name());
    Ok(if preferred.is_file() || !legacy.is_file() { preferred } else { legacy })
}

pub fn configured_path() -> Result<PathBuf> {
    for variable in [PRIVATE_ENGINE_ENV, LEGACY_PRIVATE_ENGINE_ENV] {
        if let Some(value) = env::var_os(variable) {
            let path = PathBuf::from(value);
            if path.as_os_str().is_empty() {
                anyhow::bail!("{variable} is empty");
            }
            return Ok(path);
        }
    }
    default_engine_path()
}

fn usable_file''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('private engine migration failed')
path.write_text(text, encoding='utf-8')

# Windows Setup keeps its existing AppId for upgrade lineage and terminates old process names too.
path = Path('packaging/windows/GPTWork.iss')
text = path.read_text(encoding='utf-8')
text = text.replace(
    '  CorePath: String;\n  EnginePath: String;',
    '  CorePath: String;\n  EnginePath: String;\n  LegacyCorePath: String;\n  LegacyEnginePath: String;',
)
text = text.replace(
    "  EnginePath := PowerShellSingleQuote(ExpandConstant('{app}\\bin\\gptwork-engine.exe'));",
    "  EnginePath := PowerShellSingleQuote(ExpandConstant('{app}\\bin\\gptwork-engine.exe'));\n"
    "  LegacyCorePath := PowerShellSingleQuote(ExpandConstant('{app}\\bin\\gptlock-core.exe'));\n"
    "  LegacyEnginePath := PowerShellSingleQuote(ExpandConstant('{app}\\bin\\gptlock-engine.exe'));",
)
text = text.replace(
    "'$targets=@([IO.Path]::GetFullPath(''' + CorePath + '''),[IO.Path]::GetFullPath(''' + EnginePath + ''')); ' +",
    "'$targets=@([IO.Path]::GetFullPath(''' + CorePath + '''),[IO.Path]::GetFullPath(''' + EnginePath + '''),[IO.Path]::GetFullPath(''' + LegacyCorePath + '''),[IO.Path]::GetFullPath(''' + LegacyEnginePath + ''')); ' +",
)
text = text.replace(
    "Get-Process -Name ''gptwork-core'',''gptwork-engine'' -ErrorAction",
    "Get-Process -Name ''gptwork-core'',''gptwork-engine'',''gptlock-core'',''gptlock-engine'' -ErrorAction",
)
text = text.replace(
    "     FileExists(ExpandConstant('{app}\\bin\\gptwork-engine.exe')) then",
    "     FileExists(ExpandConstant('{app}\\bin\\gptwork-engine.exe')) or\n"
    "     FileExists(ExpandConstant('{app}\\bin\\gptlock-core.exe')) or\n"
    "     FileExists(ExpandConstant('{app}\\bin\\gptlock-engine.exe')) then",
)
anchor = 'Type: filesandordirs; Name: "{app}\\extension"\n'
if anchor not in text:
    raise SystemExit('Windows InstallDelete anchor missing')
text = text.replace(
    anchor,
    anchor
    + 'Type: files; Name: "{app}\\bin\\gptlock-core.exe"\n'
    + 'Type: files; Name: "{app}\\bin\\gptlock-engine.exe"\n'
    + 'Type: files; Name: "{app}\\tools\\Update-GPTLock.ps1"\n'
    + 'Type: files; Name: "{app}\\tools\\Repair-GPTLock.ps1"\n',
    1,
)
path.write_text(text, encoding='utf-8')

# First GPTWork upgrade may still have the legacy Windows core process running.
path = Path('native-core/src/updater.rs')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "Get-Process -Name 'gptwork-core' -ErrorAction SilentlyContinue",
    "Get-Process -Name 'gptwork-core','gptlock-core' -ErrorAction SilentlyContinue",
)
path.write_text(text, encoding='utf-8')

# Debian package id remains gptlock only for dpkg upgrade continuity; visible payload/artifacts are GPTWork.
path = Path('packaging/linux/build-deb.sh')
text = path.read_text(encoding='utf-8')
text = text.replace('$package_root/usr/share/gptlock/extension', '$package_root/usr/share/gptwork/extension')
text = text.replace(
    'install -m 0755 "$script_dir/update.sh" "$package_root/usr/bin/gptwork-update"\n',
    'install -m 0755 "$script_dir/update.sh" "$package_root/usr/bin/gptwork-update"\n'
    'ln -s gptwork-core "$package_root/usr/bin/gptlock-core"\n'
    'if [[ -n "$private_engine_path" ]]; then ln -s gptwork-engine "$package_root/usr/bin/gptlock-engine"; fi\n'
    'ln -s gptwork-update "$package_root/usr/bin/gptlock-update"\n',
)
text = text.replace(
    'install -m 0644 "$script_dir/gptwork-core.deb.service" "$package_root/usr/lib/systemd/user/gptwork-core.service"\n',
    'install -m 0644 "$script_dir/gptwork-core.deb.service" "$package_root/usr/lib/systemd/user/gptwork-core.service"\n'
    'ln -s gptwork-core.service "$package_root/usr/lib/systemd/user/gptlock-core.service"\n',
)
text = text.replace('while IFS= read -r file; do\n', 'ln -s gptwork "$package_root/usr/share/gptlock"\nwhile IFS= read -r file; do\n', 1)
text = text.replace('output="$output_dir/gptlock_${version}_${architecture}.deb"', 'output="$output_dir/gptwork_${version}_${architecture}.deb"')
path.write_text(text, encoding='utf-8')

# Manual Linux install: new root for fresh installs, legacy root reused in place for upgrades.
path = Path('packaging/linux/install.sh')
text = path.read_text(encoding='utf-8')
text = text.replace(
    'install_dir="$data_home/gptlock/bin"\ninstalled_binary="$install_dir/gptwork-core"\ninstalled_updater="$install_dir/gptwork-update"\ninstalled_extension="$data_home/gptlock/extension"',
    'preferred_root="$data_home/gptwork"\nlegacy_root="$data_home/gptlock"\n'
    'if [[ -d "$legacy_root" && ! -e "$preferred_root" ]]; then\n  product_root="$legacy_root"\nelse\n  product_root="$preferred_root"\nfi\n'
    'install_dir="$product_root/bin"\ninstalled_binary="$install_dir/gptwork-core"\ninstalled_updater="$install_dir/gptwork-update"\ninstalled_extension="$product_root/extension"',
)
text = text.replace(
    'install -m 0755 "$script_dir/update.sh" "$installed_updater"\n',
    'install -m 0755 "$script_dir/update.sh" "$installed_updater"\n'
    'ln -sfn gptwork-core "$install_dir/gptlock-core"\n'
    'ln -sfn gptwork-update "$install_dir/gptlock-update"\n',
)
text = text.replace(
    'cat >"$systemd_dir/gptwork-core.service" <<EOF',
    'systemctl --user stop gptlock-core.service 2>/dev/null || true\ncat >"$systemd_dir/gptwork-core.service" <<EOF',
)
text = text.replace(
    'EOF\n\nif command -v systemctl >/dev/null 2>&1; then\n',
    'EOF\nln -sfn gptwork-core.service "$systemd_dir/gptlock-core.service"\n\nif command -v systemctl >/dev/null 2>&1; then\n',
    1,
)
path.write_text(text, encoding='utf-8')

path = Path('packaging/linux/gptwork-core.service')
path.write_text(path.read_text(encoding='utf-8').replace('/.local/share/gptlock/', '/.local/share/gptwork/'), encoding='utf-8')

# Linux updater prefers canonical GPTWork asset/service with legacy transition fallback.
path = Path('packaging/linux/update.sh')
text = path.read_text(encoding='utf-8')
text = text.replace(
    'preferred = f"gptlock_{version}_amd64.deb"\nif preferred in assets:\n    name = preferred\nelse:\n    candidates = sorted(name for name in assets if name.startswith("gptlock_") and name.endswith("_amd64.deb"))',
    'preferred = f"gptwork_{version}_amd64.deb"\nlegacy = f"gptlock_{version}_amd64.deb"\n'
    'if preferred in assets:\n    name = preferred\nelif legacy in assets:\n    name = legacy\nelse:\n'
    '    candidates = sorted(name for name in assets if (name.startswith("gptwork_") or name.startswith("gptlock_")) and name.endswith("_amd64.deb"))',
)
text = text.replace(
    'systemctl --user try-restart gptwork-core.service 2>/dev/null || true',
    'systemctl --user try-restart gptwork-core.service 2>/dev/null || systemctl --user try-restart gptlock-core.service 2>/dev/null || true',
)
path.write_text(text, encoding='utf-8')

# Extension updater canonical installer plus legacy-release fallback.
path = Path('extension/update-manager.js')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "export const WINDOWS_INSTALLER_NAME = 'GPTWorkSetup-x64.exe';",
    "export const WINDOWS_INSTALLER_NAME = 'GPTWorkSetup-x64.exe';\nexport const LEGACY_WINDOWS_INSTALLER_NAME = 'GPTLockSetup-x64.exe';",
)
text = text.replace(
    "? release.assets.find((asset) => asset?.name === WINDOWS_INSTALLER_NAME)\n    : null;",
    "? (release.assets.find((asset) => asset?.name === WINDOWS_INSTALLER_NAME)\n      || release.assets.find((asset) => asset?.name === LEGACY_WINDOWS_INSTALLER_NAME))\n    : null;",
)
path.write_text(text, encoding='utf-8')

# Public site hides legacy transition assets when a GPTWork equivalent is present.
path = Path('license-server/public/site.js')
text = path.read_text(encoding='utf-8')
helper = '''function canonicalAssetForLegacy(name) {
  const value = String(name || '');
  if (value === 'GPTLockSetup-x64.exe') return 'GPTWorkSetup-x64.exe';
  if (value.startsWith('gptlock-extension-')) return value.replace('gptlock-extension-', 'gptwork-extension-');
  if (value.startsWith('gptlock-core-')) return value.replace('gptlock-core-', 'gptwork-core-');
  if (value.startsWith('gptlock_')) return value.replace('gptlock_', 'gptwork_');
  return '';
}

'''
text = text.replace('async function loadReleaseFeed() {\n', helper + 'async function loadReleaseFeed() {\n', 1)
text = text.replace(
    "    const assets = node('div', 'asset-row');\n    for (const asset of release.assets || []) {",
    "    const assets = node('div', 'asset-row');\n"
    "    const releaseAssets = release.assets || [];\n"
    "    const releaseAssetNames = new Set(releaseAssets.map((asset) => String(asset?.name || '')));\n"
    "    for (const asset of releaseAssets) {\n"
    "      const canonical = canonicalAssetForLegacy(asset?.name);\n"
    "      if (canonical && releaseAssetNames.has(canonical)) continue;",
)
path.write_text(text, encoding='utf-8')

Path('docs/GPTWORK_MIGRATION.md').write_text('''# GPTWork 品牌迁移 / GPTWork Brand Migration

产品、扩展、网站、安装器、可执行文件和发布资产的正式名称统一为 **GPTWork**。

为了保证现有用户无损升级，GitHub 实际仓库路径 `b8vipvip/GPTLock`、线上域名 `gptlock.mv3.cn`、Native Messaging Host ID `com.gptlock.core`、`GPTLOCK_*` 环境变量、既有 storage/Cookie/数据库键、`.gptlock` 历史数据目录以及设备 ID/加密派生标签暂时作为兼容协议保留。它们不再属于用户可见产品名称，不能直接全量替换，否则会导致更新链、登录状态、设备身份或加密数据失效。

新安装优先使用 GPTWork 命名；旧安装自动复用原数据和兼容入口。过渡发布同时附带旧下载文件名别名，旧版更新器仍可升级；新界面只展示 GPTWork 正式资产。
''', encoding='utf-8')

Path('extension/tests/gptwork-brand.test.mjs').write_text('''import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

test('GPTWork is canonical product metadata', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.name, 'GPTWork');
  assert.equal(manifest.action.default_title, 'GPTWork');
  assert.equal(JSON.parse(read('extension/package.json')).name, 'gptwork-extension');
  assert.match(read('native-core/Cargo.toml'), /name = "gptwork-core"/);
  assert.match(read('private-engine/Cargo.toml'), /name = "gptwork-private-engine"/);
  assert.match(read('packaging/windows/GPTWork.iss'), /OutputBaseFilename=GPTWorkSetup-x64/);
});

test('user-facing HTML/CSS no longer exposes legacy product brand', () => {
  for (const rootName of ['extension', 'license-server/public']) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(?:html|css)$/.test(entry.name)) {
          assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /GPTLock|(?<![A-Za-z0-9_])GPTLOCK(?![A-Za-z0-9_-])/, path.relative(repo, file));
        }
      }
    };
    walk(path.join(repo, rootName));
  }
});

test('compatibility contracts remain available during rename transition', () => {
  assert.match(read('extension/update-manager.js'), /LEGACY_WINDOWS_INSTALLER_NAME = 'GPTLockSetup-x64\.exe'/);
  assert.match(read('extension/manifest.json'), /https:\/\/gptlock\.mv3\.cn\/\*/);
  assert.match(read('native-core/src/lib.rs'), /com\.gptlock\.core/);
});
''', encoding='utf-8')

print('GPTWork source transformation prepared.')
