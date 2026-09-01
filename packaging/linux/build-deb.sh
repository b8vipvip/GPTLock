#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
output_dir="${1:-$repo_root/dist/linux}"
binary_path="${GPTLOCK_BINARY:-$repo_root/native-core/target/release/gptlock-core}"
private_engine_path="${GPTLOCK_PRIVATE_ENGINE:-}"
require_private_engine="${GPTLOCK_REQUIRE_PRIVATE_ENGINE:-0}"
version="${GPTLOCK_VERSION:-$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$repo_root/native-core/Cargo.toml" | head -n 1)}"
architecture="${GPTLOCK_DEB_ARCH:-amd64}"
extension_id="$(tr -d '\r\n' < "$repo_root/packaging/EXTENSION_ID")"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+~-][A-Za-z0-9.-]+)?$ ]]; then
  echo "版本号无效 / Invalid version: $version" >&2
  exit 2
fi
if [[ ! -x "$binary_path" ]]; then
  echo "找不到可执行文件 / Executable not found: $binary_path" >&2
  exit 1
fi
if [[ "$require_private_engine" == "1" && -z "$private_engine_path" ]]; then
  echo "缺少私有核心制品 / Private engine artifact is required but not staged." >&2
  exit 1
fi
if [[ -n "$private_engine_path" && ! -x "$private_engine_path" ]]; then
  echo "私有核心制品不可执行 / Private engine artifact is not executable: $private_engine_path" >&2
  exit 1
fi
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  echo "固定扩展 ID 无效 / Stable extension ID is invalid." >&2
  exit 1
fi
if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "需要 dpkg-deb / dpkg-deb is required." >&2
  exit 1
fi

package_root="$(mktemp -d)"
trap 'rm -rf -- "$package_root"' EXIT
chmod 0755 "$package_root"
mkdir -p \
  "$package_root/DEBIAN" \
  "$package_root/usr/bin" \
  "$package_root/usr/share/gptlock/extension" \
  "$package_root/usr/lib/systemd/user" \
  "$package_root/etc/opt/chrome/native-messaging-hosts" \
  "$package_root/etc/chromium/native-messaging-hosts" \
  "$package_root/etc/opt/edge/native-messaging-hosts"

install -m 0755 "$binary_path" "$package_root/usr/bin/gptlock-core"
if [[ -n "$private_engine_path" ]]; then
  install -m 0755 "$private_engine_path" "$package_root/usr/bin/gptlock-engine"
fi
install -m 0755 "$script_dir/update.sh" "$package_root/usr/bin/gptlock-update"
install -m 0644 "$script_dir/gptlock-core.deb.service" "$package_root/usr/lib/systemd/user/gptlock-core.service"
while IFS= read -r file; do
  install -m 0644 "$file" "$package_root/usr/share/gptlock/extension/$(basename "$file")"
done < <(find "$repo_root/extension" -maxdepth 1 -type f \
  \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name 'manifest.json' \) -print | sort)

manifest_content=$(cat <<EOF
{
  "name": "com.gptlock.core",
  "description": "GPTLock 本地验证核心 / GPTLock Local Verification Core",
  "path": "/usr/bin/gptlock-core",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extension_id/"]
}
EOF
)
for directory in \
  "$package_root/etc/opt/chrome/native-messaging-hosts" \
  "$package_root/etc/chromium/native-messaging-hosts" \
  "$package_root/etc/opt/edge/native-messaging-hosts"; do
  printf '%s\n' "$manifest_content" > "$directory/com.gptlock.core.json"
  chmod 0644 "$directory/com.gptlock.core.json"
done

installed_size="$(du -sk "$package_root/usr" | awk '{print $1}')"
cat > "$package_root/DEBIAN/control" <<EOF
Package: gptlock
Version: $version
Section: utils
Priority: optional
Architecture: $architecture
Maintainer: GPTLock Maintainers <noreply@github.com>
Installed-Size: $installed_size
Depends: libc6
Homepage: https://github.com/b8vipvip/GPTLock
Description: ChatGPT model policy guard and evidence verifier
 GPTLock 为 chatgpt.com 提供模型策略、响应元数据验证、发送守卫和本地审计。
 It provides model policy enforcement, response-metadata verification, a send guard,
 and a local privacy-conscious audit trail for official ChatGPT web chats.
EOF
chmod 0755 "$package_root/DEBIAN"
chmod 0644 "$package_root/DEBIAN/control"

mkdir -p "$output_dir"
output="$output_dir/gptlock_${version}_${architecture}.deb"
dpkg-deb --root-owner-group --build "$package_root" "$output"
echo "$output"
