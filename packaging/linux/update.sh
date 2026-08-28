#!/usr/bin/env bash
set -euo pipefail

repository="b8vipvip/GPTLock"
api_url="https://api.github.com/repos/$repository/releases/latest"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "$temp_dir"' EXIT

curl_github() {
  curl -fsSL --proto '=https' --tlsv1.2 \
    --retry 6 --retry-all-errors --retry-delay 2 --retry-max-time 180 \
    --connect-timeout 15 --max-time 300 \
    --speed-time 30 --speed-limit 1024 \
    "$@"
}

echo "正在检查 GPTLock 更新 / Checking for GPTLock updates…"
release_json="$temp_dir/release.json"
curl_github \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: GPTLock-Updater' \
  "$api_url" -o "$release_json"

readarray -t release_data < <(python3 - "$release_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    release = json.load(handle)
assets = {asset["name"]: asset["browser_download_url"] for asset in release.get("assets", [])}
debs = sorted(name for name in assets if name.startswith("gptlock_") and name.endswith("_amd64.deb"))
if not debs or "SHA256SUMS.txt" not in assets:
    raise SystemExit("latest release does not contain the required Linux assets")
name = debs[-1]
print(release.get("tag_name", "unknown"))
print(name)
print(assets[name])
print(assets["SHA256SUMS.txt"])
PY
)

tag="${release_data[0]}"
asset="${release_data[1]}"
asset_url="${release_data[2]}"
checksums_url="${release_data[3]}"
echo "正在下载 $asset；网络失败会自动重试 / Downloading $asset with automatic retries…"
curl_github "$asset_url" -o "$temp_dir/$asset"
curl_github "$checksums_url" -o "$temp_dir/SHA256SUMS.txt"

expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name {print $1; exit}' "$temp_dir/SHA256SUMS.txt")"
actual="$(sha256sum "$temp_dir/$asset" | awk '{print $1}')"
if [[ -z "$expected" || "$expected" != "$actual" ]]; then
  echo "校验和验证失败，已停止更新 / Checksum verification failed; update aborted." >&2
  exit 1
fi

echo "正在安装 $tag / Installing $tag…"
sudo dpkg -i "$temp_dir/$asset"
systemctl --user daemon-reload 2>/dev/null || true
systemctl --user try-restart gptlock-core.service 2>/dev/null || true
echo "更新完成；请完全重启浏览器 / Update complete; fully restart the browser."
