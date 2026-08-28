#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root" >&2
  exit 1
fi

SERVER_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${GPTLOCK_UPDATE_ENV_FILE:-$SERVER_DIR/.env}"
SERVICE="${GPTLOCK_UPDATE_SERVICE:-gptlock-license.service}"
NODE_BIN="${GPTLOCK_UPDATE_NODE_BIN:-/usr/local/bin/node22}"
REF="${GPTLOCK_UPDATE_REF:-main}"
REPO_DIR="${GPTLOCK_UPDATE_REPO_DIR:-$(git -C "$SERVER_DIR" rev-parse --show-toplevel)}"
RUNTIME_USER="${GPTLOCK_UPDATE_RUNTIME_USER:-$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)}"
RUNTIME_GROUP="${GPTLOCK_UPDATE_RUNTIME_GROUP:-$(systemctl show -p Group --value "$SERVICE" 2>/dev/null || true)}"
RUNTIME_USER="${RUNTIME_USER:-gptlock}"
RUNTIME_GROUP="${RUNTIME_GROUP:-$RUNTIME_USER}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
DB_PATH="${GPTLOCK_LICENSE_DB:-$SERVER_DIR/data/gptlock-license.sqlite3}"
DATA_DIR="${GPTLOCK_UPDATE_DATA_DIR:-$(dirname "$DB_PATH")}"
REQUEST_FILE="$DATA_DIR/update-request.json"
UPDATE_SCRIPT="$SERVER_DIR/scripts/update-server.sh"

[[ -d "$REPO_DIR/.git" ]] || { echo "Git repository not found: $REPO_DIR" >&2; exit 1; }
[[ -f "$UPDATE_SCRIPT" ]] || { echo "Updater script not found: $UPDATE_SCRIPT" >&2; exit 1; }
[[ -x "$NODE_BIN" ]] || { echo "Node 22 not found: $NODE_BIN" >&2; exit 1; }
id "$RUNTIME_USER" >/dev/null 2>&1 || { echo "Runtime user not found: $RUNTIME_USER" >&2; exit 1; }
mkdir -p "$DATA_DIR"
chown "$RUNTIME_USER:$RUNTIME_GROUP" "$DATA_DIR" || true
rm -f "$REQUEST_FILE"
chmod 750 "$SERVER_DIR/scripts" || true
chmod 750 "$UPDATE_SCRIPT" || true

cat > /etc/systemd/system/gptlock-license-update.service <<EOF
[Unit]
Description=GPTLock License Server GitHub Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment="GPTLOCK_UPDATE_SERVER_DIR=$SERVER_DIR"
Environment="GPTLOCK_UPDATE_REPO_DIR=$REPO_DIR"
Environment="GPTLOCK_UPDATE_ENV_FILE=$ENV_FILE"
Environment="GPTLOCK_UPDATE_DATA_DIR=$DATA_DIR"
Environment="GPTLOCK_UPDATE_NODE_BIN=$NODE_BIN"
Environment="GPTLOCK_UPDATE_REF=$REF"
Environment="GPTLOCK_UPDATE_SERVICE=$SERVICE"
Environment="GPTLOCK_UPDATE_RUNTIME_USER=$RUNTIME_USER"
Environment="GPTLOCK_UPDATE_RUNTIME_GROUP=$RUNTIME_GROUP"
ExecStart=/bin/bash $UPDATE_SCRIPT
TimeoutStartSec=10min
EOF

cat > /etc/systemd/system/gptlock-license-update.path <<EOF
[Unit]
Description=Watch GPTLock License Server update requests

[Path]
PathChanged=$REQUEST_FILE
Unit=gptlock-license-update.service

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gptlock-license-update.path

echo "GPTLock updater installed."
echo "  repository: $REPO_DIR"
echo "  server dir: $SERVER_DIR"
echo "  target ref: origin/$REF"
echo "  runtime user: $RUNTIME_USER:$RUNTIME_GROUP"
echo "  request: $REQUEST_FILE"
echo "  watcher: gptlock-license-update.path"
