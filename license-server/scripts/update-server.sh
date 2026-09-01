#!/usr/bin/env bash
set -Eeuo pipefail
# Git checkout files must remain readable by the low-privilege runtime user after
# root deploys a new commit. Sensitive updater artifacts are chmod 0600 below.
umask 022

SERVER_DIR="${GPTLOCK_UPDATE_SERVER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_DIR="${GPTLOCK_UPDATE_REPO_DIR:-$(git -C "$SERVER_DIR" rev-parse --show-toplevel 2>/dev/null || true)}"
REF="${GPTLOCK_UPDATE_REF:-main}"
SERVICE="${GPTLOCK_UPDATE_SERVICE:-gptlock-license.service}"
ENV_FILE="${GPTLOCK_UPDATE_ENV_FILE:-$SERVER_DIR/.env}"
NODE_BIN="${GPTLOCK_UPDATE_NODE_BIN:-/usr/local/bin/node22}"
DATA_DIR="${GPTLOCK_UPDATE_DATA_DIR:-}"
RUNTIME_USER="${GPTLOCK_UPDATE_RUNTIME_USER:-gptlock}"
RUNTIME_GROUP="${GPTLOCK_UPDATE_RUNTIME_GROUP:-$RUNTIME_USER}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [[ -z "$DATA_DIR" ]]; then
  DB_PATH="${GPTLOCK_LICENSE_DB:-$SERVER_DIR/data/gptlock-license.sqlite3}"
  DATA_DIR="$(dirname "$DB_PATH")"
else
  DB_PATH="${GPTLOCK_LICENSE_DB:-$DATA_DIR/gptlock-license.sqlite3}"
fi
FETCH_HELPER="${GPTLOCK_UPDATE_FETCH_HELPER:-$SERVER_DIR/scripts/github-fetch.sh}"
REQUEST_FILE="$DATA_DIR/update-request.json"
STATUS_FILE="$DATA_DIR/update-status.json"
LOG_FILE="$DATA_DIR/update.log"
DEPLOYMENT_FILE="$DATA_DIR/deployment.json"
LOCK_FILE="$DATA_DIR/update.lock"
BACKUP_DIR="$DATA_DIR/update-backups"
RELEASE_MIRROR_DIR="${GPTLOCK_RELEASE_MIRROR_DIR:-$DATA_DIR/releases}"
mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$RELEASE_MIRROR_DIR"
chown "$RUNTIME_USER:$RUNTIME_GROUP" "$RELEASE_MIRROR_DIR" 2>/dev/null || true
chmod 750 "$RELEASE_MIRROR_DIR" 2>/dev/null || true
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" || true
chown "$RUNTIME_USER:$RUNTIME_GROUP" "$LOG_FILE" 2>/dev/null || true

REQUEST_ID="$($NODE_BIN -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(j.requestId||''))}catch{}" "$REQUEST_FILE" 2>/dev/null || true)"
[[ "$REQUEST_ID" =~ ^[A-Za-z0-9._:-]{8,160}$ ]] || REQUEST_ID="manual-$(date +%s)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FROM_COMMIT=""
TARGET_COMMIT=""
DEPLOYED_COMMIT=""
ROLLBACK_COMMIT=""
FETCH_ROUTE=""
STAGE_DIR=""
CURRENT_STAGE="idle"
CURRENT_PERCENT=0

log() {
  printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

write_status() {
  local status="$1" stage="$2" percent="$3" message="$4" error="${5:-}"
  CURRENT_STAGE="$stage"
  CURRENT_PERCENT="$percent"
  STATUS="$status" STAGE="$stage" PERCENT="$percent" MESSAGE="$message" ERROR_TEXT="$error" \
  REQUEST_ID="$REQUEST_ID" STARTED_AT="$STARTED_AT" FROM_COMMIT="$FROM_COMMIT" TARGET_COMMIT="$TARGET_COMMIT" \
  DEPLOYED_COMMIT="$DEPLOYED_COMMIT" ROLLBACK_COMMIT="$ROLLBACK_COMMIT" REF="$REF" FETCH_ROUTE="$FETCH_ROUTE" \
  "$NODE_BIN" -e '
    const fs=require("fs");
    const out=process.argv[1], tmp=`${out}.tmp`;
    const e=process.env;
    const body={status:e.STATUS,stage:e.STAGE,percent:Number(e.PERCENT),message:e.MESSAGE,requestId:e.REQUEST_ID,startedAt:e.STARTED_AT,updatedAt:new Date().toISOString(),ref:e.REF,fetchRoute:e.FETCH_ROUTE||null,fromCommit:e.FROM_COMMIT||null,targetCommit:e.TARGET_COMMIT||null,deployedCommit:e.DEPLOYED_COMMIT||null,rollbackCommit:e.ROLLBACK_COMMIT||null,error:e.ERROR_TEXT||null};
    fs.writeFileSync(tmp,JSON.stringify(body,null,2),{mode:0o600}); fs.renameSync(tmp,out);
  ' "$STATUS_FILE"
  chown "$RUNTIME_USER:$RUNTIME_GROUP" "$STATUS_FILE" 2>/dev/null || true
  chmod 600 "$STATUS_FILE" || true
}

cleanup() {
  [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" ]] && git -C "$REPO_DIR" worktree remove --force "$STAGE_DIR" >/dev/null 2>&1 || true
  rm -f "$REQUEST_FILE"
}

fail() {
  trap - ERR
  local message="$1" failed_stage="${CURRENT_STAGE:-failed}" failed_percent="${CURRENT_PERCENT:-1}"
  if ! [[ "$failed_percent" =~ ^[0-9]+$ ]] || (( failed_percent < 1 || failed_percent >= 100 )); then
    failed_percent=1
  fi
  log "FAILED: $message"
  if [[ -n "$FROM_COMMIT" && -n "$TARGET_COMMIT" && "$FROM_COMMIT" != "$TARGET_COMMIT" ]]; then
    write_status rolling_back rollback 94 "更新失败，正在回滚到上一版本" "$message" || true
    log "Rolling back to $FROM_COMMIT"
    git -C "$REPO_DIR" reset --hard "$FROM_COMMIT" >>"$LOG_FILE" 2>&1 || true
    systemctl restart "$SERVICE" >>"$LOG_FILE" 2>&1 || true
    ROLLBACK_COMMIT="$FROM_COMMIT"
  fi
  write_status failed "$failed_stage" "$failed_percent" "更新失败（阶段：$failed_stage）" "$message" || true
  cleanup
  exit 1
}

trap 'fail "第 ${LINENO} 行执行失败"' ERR
trap cleanup EXIT

exec 9>"$LOCK_FILE"
chmod 600 "$LOCK_FILE" || true
if ! flock -n 9; then
  write_status failed busy 1 "已有更新任务正在执行" "UPDATE_BUSY"
  exit 0
fi

write_status running preflight 5 "正在检查更新环境"
log "Update request $REQUEST_ID started; ref=$REF transport=${GPTLOCK_UPDATE_TRANSPORT:-auto}"
[[ -n "$REPO_DIR" && -d "$REPO_DIR/.git" ]] || fail "未找到 Git 仓库"
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != -* && "$REF" != *..* ]] || fail "更新分支配置无效"
command -v git >/dev/null || fail "git 不可用"
command -v systemctl >/dev/null || fail "systemctl 不可用"
command -v curl >/dev/null || fail "curl 不可用"
command -v timeout >/dev/null || fail "timeout 不可用"
[[ -x "$NODE_BIN" ]] || fail "Node 22 不可用: $NODE_BIN"
[[ -f "$FETCH_HELPER" ]] || fail "GitHub 传输助手不存在: $FETCH_HELPER"
REMOTE_URL="$(git -C "$REPO_DIR" remote get-url origin)"
bash "$FETCH_HELPER" --validate-url "$REMOTE_URL" || fail "Git origin 不是受信任的 b8vipvip/GPTLock 仓库"
git -C "$REPO_DIR" diff --quiet || fail "生产仓库存在未提交的已跟踪文件修改"
git -C "$REPO_DIR" diff --cached --quiet || fail "生产仓库存在未提交的暂存修改"
FROM_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"

write_status running fetch 18 "正在通过 SSH/HTTPS 自适应链路获取最新代码"
log "Fetching $REF with resilient GitHub transport"
if ! FETCH_ROUTE="$(bash "$FETCH_HELPER" "$REPO_DIR" "$REF" "$LOG_FILE")"; then
  fail "所有 GitHub 拉取链路均失败；请检查服务器 SSH/HTTPS 网络和 update.log"
fi
TARGET_COMMIT="$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)"
write_status running compare 30 "已通过 $FETCH_ROUTE 获取最新版本，正在比较提交"
log "Fetch route=$FETCH_ROUTE Current=$FROM_COMMIT Target=$TARGET_COMMIT"
if [[ "$FROM_COMMIT" == "$TARGET_COMMIT" ]]; then
  DEPLOYED_COMMIT="$FROM_COMMIT"
  write_status succeeded current 100 "当前已经是最新版本"
  log "Already up to date"
  exit 0
fi

write_status running stage 40 "正在创建隔离测试工作区"
STAGE_DIR="$(mktemp -d /tmp/gptlock-license-update.XXXXXX)"
rmdir "$STAGE_DIR"
git -C "$REPO_DIR" worktree add --detach "$STAGE_DIR" "$TARGET_COMMIT" >>"$LOG_FILE" 2>&1

write_status running test 52 "正在执行新版本语法检查"
"$NODE_BIN" --check "$STAGE_DIR/license-server/server.mjs" >>"$LOG_FILE" 2>&1
"$NODE_BIN" --check "$STAGE_DIR/license-server/update-manager.mjs" >>"$LOG_FILE" 2>&1
"$NODE_BIN" --check "$STAGE_DIR/license-server/public/admin.js" >>"$LOG_FILE" 2>&1
bash -n "$STAGE_DIR/license-server/scripts/update-server.sh"
bash -n "$STAGE_DIR/license-server/scripts/github-fetch.sh"
[[ -s "$STAGE_DIR/license-server/scripts/github-known-hosts" ]] || fail "新版本缺少 GitHub SSH host key 固定文件"
write_status running test 62 "正在执行新版本自动化测试"
(cd "$STAGE_DIR/license-server" && GPTLOCK_UPDATE_ALLOW_WITHOUT_SYSTEMD=1 "$NODE_BIN" --test test/*.test.mjs) >>"$LOG_FILE" 2>&1

write_status running backup 70 "测试通过，正在备份授权数据库"
BACKUP_PATH="$BACKUP_DIR/gptlock-license-$(date -u +%Y%m%dT%H%M%SZ)-${FROM_COMMIT:0:8}.sqlite3"
if [[ -f "$DB_PATH" ]]; then
  DB_PATH_ENV="$DB_PATH" BACKUP_PATH_ENV="$BACKUP_PATH" "$NODE_BIN" --input-type=module -e '
    import { DatabaseSync, backup } from "node:sqlite";
    const db=new DatabaseSync(process.env.DB_PATH_ENV);
    await backup(db, process.env.BACKUP_PATH_ENV);
    db.close();
  ' >>"$LOG_FILE" 2>&1
  chmod 600 "$BACKUP_PATH" || true
  log "Database backup: $BACKUP_PATH"
fi

write_status running deploy 80 "正在部署已验证的最新代码"
log "Deploying $TARGET_COMMIT"
git -C "$REPO_DIR" reset --hard "$TARGET_COMMIT" >>"$LOG_FILE" 2>&1
DEPLOYED_COMMIT="$TARGET_COMMIT"

write_status restarting restart 90 "代码部署完成，正在重启授权服务"
systemctl restart "$SERVICE" >>"$LOG_FILE" 2>&1

write_status running verify 95 "服务已重启，正在执行健康检查"
HEALTH_URL="http://${GPTLOCK_LICENSE_HOST:-127.0.0.1}:${GPTLOCK_LICENSE_PORT:-3188}/api/v1/health"
HEALTH_OK=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then HEALTH_OK=1; break; fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  log "Health check failed for $HEALTH_URL; collecting service diagnostics before rollback"
  systemctl status "$SERVICE" --no-pager -l >>"$LOG_FILE" 2>&1 || true
  journalctl -u "$SERVICE" -n 100 --no-pager >>"$LOG_FILE" 2>&1 || true
  fail "新版本启动后健康检查失败"
fi

VERSION="$($NODE_BIN -e "const p=require(process.argv[1]);process.stdout.write(String(p.version||''))" "$REPO_DIR/license-server/package.json")"
VERSION="$VERSION" DEPLOYED_COMMIT="$DEPLOYED_COMMIT" REF="$REF" FETCH_ROUTE="$FETCH_ROUTE" "$NODE_BIN" -e '
  const fs=require("fs"), out=process.argv[1], tmp=`${out}.tmp`, e=process.env;
  fs.writeFileSync(tmp,JSON.stringify({version:e.VERSION,commit:e.DEPLOYED_COMMIT,ref:e.REF,fetchRoute:e.FETCH_ROUTE||null,deployedAt:new Date().toISOString()},null,2),{mode:0o600}); fs.renameSync(tmp,out);
' "$DEPLOYMENT_FILE"
chown "$RUNTIME_USER:$RUNTIME_GROUP" "$DEPLOYMENT_FILE" 2>/dev/null || true
chmod 600 "$DEPLOYMENT_FILE" || true
write_status succeeded complete 100 "更新完成，服务已运行最新版本"
log "Update completed successfully: $DEPLOYED_COMMIT route=$FETCH_ROUTE"
