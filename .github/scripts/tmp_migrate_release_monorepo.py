from pathlib import Path

path = Path('.github/workflows/release.yml')
text = path.read_text(encoding='utf-8')

linux_start = text.index('  linux:\n')
windows_start = text.index('  windows:\n')
publish_start = text.index('  publish:\n')

linux = text[linux_start:windows_start]
windows = text[windows_start:publish_start]

old_cache = '          workspaces: native-core\n'
new_cache = '          workspaces: |\n            native-core\n            private-engine\n'
if linux.count(old_cache) != 1 or windows.count(old_cache) != 1:
    raise SystemExit('unexpected release rust-cache workspace layout')
linux = linux.replace(old_cache, new_cache, 1)
windows = windows.replace(old_cache, new_cache, 1)

linux_stage = linux.index('      - name: Stage private engine when configured\n')
linux_assets = linux.index('      - name: Build assets\n', linux_stage)
linux_engine = '''      - name: Build private engine from this commit
        shell: bash
        run: |
          set -Eeuo pipefail
          cargo build --release --manifest-path private-engine/Cargo.toml
          engine="$GITHUB_WORKSPACE/private-engine/target/release/gptlock-private-engine"
          test -x "$engine"
          echo "GPTLOCK_PRIVATE_ENGINE=$engine" >> "$GITHUB_ENV"
          echo "GPTLOCK_REQUIRE_PRIVATE_ENGINE=1" >> "$GITHUB_ENV"
'''
linux = linux[:linux_stage] + linux_engine + linux[linux_assets:]

windows_stage = windows.index('      - name: Stage private engine when configured\n')
windows_setup = windows.index('      - name: Build Setup\n', windows_stage)
windows_engine = '''      - name: Build private engine from this commit
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          cargo build --release --manifest-path private-engine/Cargo.toml
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          $engine = (Resolve-Path 'private-engine\\target\\release\\gptlock-private-engine.exe').Path
          if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw 'Private engine build output is missing.' }
          Add-Content -LiteralPath $env:GITHUB_ENV -Value "GPTLOCK_PRIVATE_ENGINE=$engine"
          Add-Content -LiteralPath $env:GITHUB_ENV -Value 'GPTLOCK_REQUIRE_PRIVATE_ENGINE=1'
'''
windows = windows[:windows_stage] + windows_engine + windows[windows_setup:]

linux_upload = '''      - uses: actions/upload-artifact@v4
        with:
          name: release-linux
'''
if linux.count(linux_upload) != 1:
    raise SystemExit('unexpected Linux release upload block')
linux_boundary = '''      - name: Enforce Linux release distribution boundary
        shell: bash
        run: |
          set -Eeuo pipefail
          version="$(python -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')"
          extension_zip="dist/gptlock-extension-${version}.zip"
          core_tar="dist/gptlock-core-${version}-linux-x64.tar.gz"
          deb="$(find dist -maxdepth 1 -type f -name 'gptlock_*_amd64.deb' -print -quit)"
          test -f "$extension_zip"
          test -f "$core_tar"
          test -n "$deb" && test -f "$deb"
          if unzip -Z1 "$extension_zip" | grep -Eq '(^|/)(private-engine|Cargo\\.(toml|lock)|[^/]+\\.rs)(/|$)'; then
            echo 'Private engine source leaked into extension archive.' >&2
            exit 1
          fi
          entries="$(tar -tzf "$core_tar")"
          grep -qx 'gptlock-core' <<<"$entries"
          grep -qx 'gptlock-engine' <<<"$entries"
          if grep -Eq '(^|/)(private-engine|Cargo\\.(toml|lock)|[^/]+\\.rs)(/|$)' <<<"$entries"; then
            echo 'Private engine source leaked into Linux core archive.' >&2
            exit 1
          fi
          deb_entries="$(dpkg-deb --contents "$deb")"
          grep -q '/usr/bin/gptlock-engine$' <<<"$deb_entries"
          if grep -Eq 'private-engine|Cargo\\.(toml|lock)|\\.rs($|[[:space:]])' <<<"$deb_entries"; then
            echo 'Private engine source leaked into Linux deb.' >&2
            exit 1
          fi
'''
linux = linux.replace(linux_upload, linux_boundary + linux_upload, 1)

windows_upload = '''      - uses: actions/upload-artifact@v4
        with:
          name: release-windows
'''
if windows.count(windows_upload) != 1:
    raise SystemExit('unexpected Windows release upload block')
windows_boundary = '''      - name: Enforce Windows release distribution boundary
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $setup = (Resolve-Path 'dist\\windows\\GPTLockSetup-x64.exe').Path
          $root = Join-Path $env:RUNNER_TEMP 'GPTLock-Release-Boundary-Inspect'
          Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
          & $setup /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- "/DIR=$root"
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          foreach ($required in @(
            (Join-Path $root 'bin\\gptlock-core.exe'),
            (Join-Path $root 'bin\\gptlock-engine.exe'),
            (Join-Path $root 'extension\\manifest.json')
          )) {
            if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing release payload: $required" }
          }
          $leaks = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
            $_.Extension -eq '.rs' -or $_.Name -in @('Cargo.toml', 'Cargo.lock') -or $_.FullName -match '[\\\\/]private-engine[\\\\/]'
          })
          if ($leaks.Count -gt 0) {
            $leaks.FullName | Write-Error
            throw 'Private engine source leaked into Windows Setup.'
          }
'''
windows = windows.replace(windows_upload, windows_boundary + windows_upload, 1)

result = text[:linux_start] + linux + windows + text[publish_start:]

obsolete = (
    'GPTLOCK_PRIVATE_CORE_REPOSITORY',
    'GPTLOCK_PRIVATE_CORE_TOKEN',
    'Stage private engine when configured',
    'gh release download',
)
for marker in obsolete:
    if marker in result:
        raise SystemExit(f'obsolete cross-repository release marker remains: {marker}')

required = (
    'Build private engine from this commit',
    'private-engine/Cargo.toml',
    'GPTLOCK_REQUIRE_PRIVATE_ENGINE=1',
    'Enforce Linux release distribution boundary',
    'Enforce Windows release distribution boundary',
)
for marker in required:
    if marker not in result:
        raise SystemExit(f'missing monorepo release marker: {marker}')

path.write_text(result, encoding='utf-8')
