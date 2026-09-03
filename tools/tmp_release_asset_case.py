from pathlib import Path

source = Path('.github/workflows/release.yml').read_text(encoding='utf-8')
source = source.replace('dist/gptwork-core-${RELEASE_VERSION}-linux-x64.tar.gz', 'dist/GPTWork-core-${RELEASE_VERSION}-linux-x64.tar.gz')
source = source.replace('../dist/gptwork-extension-${RELEASE_VERSION}.zip', '../dist/GPTWork-extension-${RELEASE_VERSION}.zip')
source = source.replace('dist/gptwork-extension-${version}.zip', 'dist/GPTWork-extension-${version}.zip')
source = source.replace('dist/gptwork-core-${version}-linux-x64.tar.gz', 'dist/GPTWork-core-${version}-linux-x64.tar.gz')
source = source.replace("-name 'gptwork_*_amd64.deb'", "-name 'GPTWork_*_amd64.deb'")
Path('release-v0537.generated.yml').write_text(source, encoding='utf-8')
