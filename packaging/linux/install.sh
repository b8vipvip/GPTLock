#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
GPTWork Linux 安装器 / Linux installer

用法 / Usage:
  ./install.sh [--extension-id <32位ID>] [--binary <gptwork-core>] [--browser all|chrome|chromium|edge]

默认使用项目固定扩展 ID，并把扩展复制到 ~/.local/share/gptlock/extension。
The stable project extension ID is used by default and the extension is copied to ~/.local/share/gptlock/extension.
EOF
}

extension_id="bhchcpeodphgjfjoookncemnamdbfcof"
binary_path=""
browser="all"

while (($#)); do
  case "$1" in
    --extension-id)
      extension_id="${2:-}"
      shift 2
      ;;
    --binary)
      binary_path="${2:-}"
      shift 2
      ;;
    --browser)
      browser="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数 / Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  echo "扩展 ID 必须是 32 位 a-p 字符 / Extension ID must contain 32 characters in a-p." >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
if [[ -z "$binary_path" ]]; then
  binary_path="$repo_root/native-core/target/release/gptwork-core"
fi
if [[ ! -f "$binary_path" ]]; then
  echo "找不到二进制文件 / Binary not found: $binary_path" >&2
  echo "请先运行 / Build first: cargo build --release --manifest-path native-core/Cargo.toml" >&2
  exit 1
fi

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
preferred_root="$data_home/gptwork"
legacy_root="$data_home/gptlock"
if [[ -d "$legacy_root" && ! -e "$preferred_root" ]]; then
  product_root="$legacy_root"
else
  product_root="$preferred_root"
fi
install_dir="$product_root/bin"
installed_binary="$install_dir/gptwork-core"
installed_updater="$install_dir/gptwork-update"
installed_extension="$product_root/extension"
mkdir -p "$install_dir"
install -m 0755 "$binary_path" "$installed_binary"
install -m 0755 "$script_dir/update.sh" "$installed_updater"
ln -sfn gptwork-core "$install_dir/gptlock-core"
ln -sfn gptwork-update "$install_dir/gptlock-update"
mkdir -p "$installed_extension"
for file in background.js content.js diagnostics.css diagnostics.html diagnostics.js guard.js manifest.json native-status.js network-evidence.js network-monitor.js options.css options.html options.js policy.js popup.css popup.html popup.js runtime-log.js; do
  install -m 0644 "$repo_root/extension/$file" "$installed_extension/$file"
done

write_manifest() {
  local directory="$1"
  mkdir -p "$directory"
  local escaped_binary="${installed_binary//\\/\\\\}"
  escaped_binary="${escaped_binary//\"/\\\"}"
  cat >"$directory/com.gptlock.core.json" <<EOF
{
  "name": "com.gptlock.core",
  "description": "GPTWork 本地验证核心 / GPTWork Local Verification Core",
  "path": "$escaped_binary",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extension_id/"]
}
EOF
  chmod 0600 "$directory/com.gptlock.core.json"
}

case "$browser" in
  all)
    write_manifest "$config_home/google-chrome/NativeMessagingHosts"
    write_manifest "$config_home/chromium/NativeMessagingHosts"
    write_manifest "$config_home/microsoft-edge/NativeMessagingHosts"
    ;;
  chrome)
    write_manifest "$config_home/google-chrome/NativeMessagingHosts"
    ;;
  chromium)
    write_manifest "$config_home/chromium/NativeMessagingHosts"
    ;;
  edge)
    write_manifest "$config_home/microsoft-edge/NativeMessagingHosts"
    ;;
  *)
    echo "不支持的浏览器 / Unsupported browser: $browser" >&2
    exit 2
    ;;
esac

systemd_dir="$config_home/systemd/user"
mkdir -p "$systemd_dir"
systemctl --user stop gptlock-core.service 2>/dev/null || true
cat >"$systemd_dir/gptwork-core.service" <<EOF
[Unit]
Description=GPTWork 本地验证 API / GPTWork Local Verification API

[Service]
Type=simple
ExecStart="$installed_binary" serve
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
UMask=0077
LockPersonality=true

[Install]
WantedBy=default.target
EOF
ln -sfn gptwork-core.service "$systemd_dir/gptlock-core.service"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user daemon-reload && systemctl --user enable --now gptwork-core.service; then
    active_state="$(systemctl --user is-active gptwork-core.service 2>/dev/null || true)"
    if [[ "$active_state" == "active" ]]; then
      echo "systemd 用户服务已启动 / systemd user service started."
    else
      echo "警告：systemd 未确认服务已运行；Native Messaging 仍可使用。" >&2
      echo "Warning: systemd did not confirm an active service; Native Messaging remains available." >&2
    fi
  else
    echo "警告：无法启动 systemd 用户服务；Native Messaging 仍可使用。" >&2
    echo "Warning: systemd user service could not start; Native Messaging remains available." >&2
  fi
fi

echo "GPTWork Linux 安装完成 / Linux installation completed."
echo "扩展目录 / Extension directory: $installed_extension"
echo "更新命令 / Updater: $installed_updater"
echo "请重新启动浏览器 / Restart the browser."
