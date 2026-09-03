from pathlib import Path

WORKFLOWS = [
    '.github/workflows/ci.yml',
    '.github/workflows/license-server.yml',
    '.github/workflows/private-core-boundary.yml',
    '.github/workflows/release.yml',
    '.github/workflows/repository-housekeeping.yml',
]

TARGET_DIR = Path('generated-workflows')
TARGET_DIR.mkdir(exist_ok=True)

TARGETED = [
    ('gptlock-private-engine', 'gptwork-private-engine'),
    ('gptlock-extension', 'gptwork-extension'),
    ('gptlock-core', 'gptwork-core'),
    ('gptlock-engine', 'gptwork-engine'),
    ('gptlock-update', 'gptwork-update'),
    ('gptlock-windows-setup', 'gptwork-windows-setup'),
    ('gptlock-linux-deb', 'gptwork-linux-deb'),
    ('GPTLock.iss', 'GPTWork.iss'),
    ('GPTLockSetup-x64.exe', 'GPTWorkSetup-x64.exe'),
    ('GPTLock-Release-Boundary-Inspect', 'GPTWork-Release-Boundary-Inspect'),
    ('Sign-GPTLockFile', 'Sign-GPTWorkFile'),
]

for source_name in WORKFLOWS:
    source = Path(source_name)
    text = source.read_text(encoding='utf-8')
    # Proper-case product branding is user/developer visible. Uppercase GPTLOCK_* compatibility
    # environment and secret names are intentionally left unchanged.
    text = text.replace('GPTLock', 'GPTWork')
    # Restore the real repository slug until the GitHub repository itself is renamed.
    text = text.replace('b8vipvip/GPTWork', 'b8vipvip/GPTLock')
    for old, new in TARGETED:
        text = text.replace(old, new)

    if source.name == 'ci.yml':
        # The package payload is canonical GPTWork. Legacy aliases are checked in dedicated
        # migration tests rather than used as the primary CI contract.
        text = text.replace('/usr/share/gptlock/extension/', '/usr/share/gptwork/extension/')
        text = text.replace('dist/linux/gptlock_*_amd64.deb', 'dist/linux/gptwork_*_amd64.deb')

    if source.name == 'release.yml':
        # The release boundary verifies the canonical Debian artifact; legacy copies below are
        # compatibility aliases for old update clients only.
        text = text.replace("-name 'gptlock_*_amd64.deb'", "-name 'gptwork_*_amd64.deb'")

        # A transition release must publish canonical GPTWork assets plus legacy aliases so
        # v0.5.35 and older update clients can discover the rename release safely.
        linux_anchor = '      - name: Enforce Linux release distribution boundary\n'
        linux_alias = '''      - name: Add legacy download aliases for pre-GPTWork clients
        env:
          RELEASE_VERSION: ${{ needs.metadata.outputs.version }}
        shell: bash
        run: |
          set -Eeuo pipefail
          cp "dist/gptwork-core-${RELEASE_VERSION}-linux-x64.tar.gz" "dist/gptlock-core-${RELEASE_VERSION}-linux-x64.tar.gz"
          cp "dist/gptwork-extension-${RELEASE_VERSION}.zip" "dist/gptlock-extension-${RELEASE_VERSION}.zip"
          cp "dist/gptwork_${RELEASE_VERSION}_amd64.deb" "dist/gptlock_${RELEASE_VERSION}_amd64.deb"
'''
        if 'Add legacy download aliases for pre-GPTWork clients' not in text:
            if linux_anchor not in text:
                raise SystemExit('Linux release boundary anchor missing')
            text = text.replace(linux_anchor, linux_alias + linux_anchor, 1)

        windows_anchor = '      - name: Enforce Windows release distribution boundary\n'
        windows_alias = '''      - name: Add legacy Windows installer alias for pre-GPTWork clients
        shell: pwsh
        run: Copy-Item -LiteralPath 'dist\\windows\\GPTWorkSetup-x64.exe' -Destination 'dist\\windows\\GPTLockSetup-x64.exe' -Force
'''
        if 'Add legacy Windows installer alias for pre-GPTWork clients' not in text:
            if windows_anchor not in text:
                raise SystemExit('Windows release boundary anchor missing')
            text = text.replace(windows_anchor, windows_alias + windows_anchor, 1)

        old_upload = '          path: dist/windows/GPTWorkSetup-x64.exe\n'
        new_upload = '          path: |\n            dist/windows/GPTWorkSetup-x64.exe\n            dist/windows/GPTLockSetup-x64.exe\n'
        if old_upload in text:
            text = text.replace(old_upload, new_upload, 1)

    target = TARGET_DIR / source.name
    target.write_text(text, encoding='utf-8')
    print(f'{source_name} -> {target}')
