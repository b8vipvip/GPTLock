#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TRUSTED_REPOSITORY="b8vipvip/GPTLock"
CANONICAL_SSH="git@github.com:${TRUSTED_REPOSITORY}.git"
CANONICAL_SSH_443="ssh://git@ssh.github.com:443/${TRUSTED_REPOSITORY}.git"
CANONICAL_HTTPS="https://github.com/${TRUSTED_REPOSITORY}.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_KNOWN_HOSTS="$SCRIPT_DIR/github-known-hosts"

MODE="${GPTLOCK_UPDATE_TRANSPORT:-auto}"
FETCH_RETRIES="${GPTLOCK_UPDATE_FETCH_RETRIES:-2}"
FETCH_TIMEOUT="${GPTLOCK_UPDATE_FETCH_TIMEOUT_SECONDS:-60}"
SSH_CONNECT_TIMEOUT="${GPTLOCK_UPDATE_SSH_CONNECT_TIMEOUT_SECONDS:-12}"
SSH_KEEPALIVE="${GPTLOCK_UPDATE_SSH_KEEPALIVE_SECONDS:-10}"
HTTPS_LOW_SPEED_TIME="${GPTLOCK_UPDATE_HTTPS_LOW_SPEED_TIME_SECONDS:-30}"
HTTPS_LOW_SPEED_LIMIT="${GPTLOCK_UPDATE_HTTPS_LOW_SPEED_LIMIT_BYTES:-1024}"
KNOWN_HOSTS="${GPTLOCK_UPDATE_SSH_KNOWN_HOSTS:-$DEFAULT_KNOWN_HOSTS}"

validate_positive_int() {
  local name="$1" value="$2" minimum="${3:-1}" maximum="${4:-3600}"
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "$name must be an integer" >&2; return 1; }
  (( value >= minimum && value <= maximum )) || { echo "$name must be between $minimum and $maximum" >&2; return 1; }
}

validate_settings() {
  case "$MODE" in
    auto|ssh|https|origin) ;;
    *) echo "GPTLOCK_UPDATE_TRANSPORT must be auto, ssh, https, or origin" >&2; return 1 ;;
  esac
  validate_positive_int GPTLOCK_UPDATE_FETCH_RETRIES "$FETCH_RETRIES" 1 8
  validate_positive_int GPTLOCK_UPDATE_FETCH_TIMEOUT_SECONDS "$FETCH_TIMEOUT" 10 600
  validate_positive_int GPTLOCK_UPDATE_SSH_CONNECT_TIMEOUT_SECONDS "$SSH_CONNECT_TIMEOUT" 3 120
  validate_positive_int GPTLOCK_UPDATE_SSH_KEEPALIVE_SECONDS "$SSH_KEEPALIVE" 3 120
  validate_positive_int GPTLOCK_UPDATE_HTTPS_LOW_SPEED_TIME_SECONDS "$HTTPS_LOW_SPEED_TIME" 5 180
  validate_positive_int GPTLOCK_UPDATE_HTTPS_LOW_SPEED_LIMIT_BYTES "$HTTPS_LOW_SPEED_LIMIT" 1 1048576
}

trusted_url() {
  local url="$1"
  [[ "$url" == "https://github.com/${TRUSTED_REPOSITORY}" \
    || "$url" == "https://github.com/${TRUSTED_REPOSITORY}.git" \
    || "$url" == "git@github.com:${TRUSTED_REPOSITORY}" \
    || "$url" == "git@github.com:${TRUSTED_REPOSITORY}.git" \
    || "$url" == "ssh://git@github.com/${TRUSTED_REPOSITORY}" \
    || "$url" == "ssh://git@github.com/${TRUSTED_REPOSITORY}.git" \
    || "$url" == "ssh://git@ssh.github.com:443/${TRUSTED_REPOSITORY}" \
    || "$url" == "ssh://git@ssh.github.com:443/${TRUSTED_REPOSITORY}.git" ]]
}

transport_of() {
  case "$1" in
    https://*) printf 'https\n' ;;
    git@github.com:*|ssh://git@github.com/*|ssh://git@ssh.github.com:443/*) printf 'ssh\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

LABELS=()
KINDS=()
URLS=()

append_candidate() {
  local label="$1" kind="$2" url="$3" existing
  for existing in "${URLS[@]:-}"; do
    [[ "$existing" == "$url" ]] && return 0
  done
  LABELS+=("$label")
  KINDS+=("$kind")
  URLS+=("$url")
}

build_candidates() {
  local origin="$1" origin_kind
  trusted_url "$origin" || { echo "untrusted Git origin: $origin" >&2; return 1; }
  origin_kind="$(transport_of "$origin")"

  LABELS=(); KINDS=(); URLS=()
  case "$MODE" in
    auto)
      if [[ "$origin_kind" == ssh ]]; then append_candidate "origin-ssh" ssh "$origin"; fi
      append_candidate "ssh-22" ssh "$CANONICAL_SSH"
      append_candidate "ssh-443" ssh "$CANONICAL_SSH_443"
      if [[ "$origin_kind" == https ]]; then append_candidate "origin-https" https "$origin"; fi
      append_candidate "https-http1" https "$CANONICAL_HTTPS"
      ;;
    ssh)
      if [[ "$origin_kind" == ssh ]]; then append_candidate "origin-ssh" ssh "$origin"; fi
      append_candidate "ssh-22" ssh "$CANONICAL_SSH"
      append_candidate "ssh-443" ssh "$CANONICAL_SSH_443"
      ;;
    https)
      if [[ "$origin_kind" == https ]]; then append_candidate "origin-https" https "$origin"; fi
      append_candidate "https-http1" https "$CANONICAL_HTTPS"
      ;;
    origin)
      append_candidate "origin-$origin_kind" "$origin_kind" "$origin"
      ;;
  esac
}

log_line() {
  local message="$1" logfile="${2:-}"
  if [[ -n "$logfile" ]]; then
    printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message" >>"$logfile"
  fi
  printf '%s\n' "$message" >&2
}

ssh_command() {
  [[ -f "$KNOWN_HOSTS" ]] || { echo "pinned GitHub known_hosts file missing: $KNOWN_HOSTS" >&2; return 1; }
  printf 'ssh -oBatchMode=yes -oConnectionAttempts=2 -oConnectTimeout=%q -oServerAliveInterval=%q -oServerAliveCountMax=3 -oStrictHostKeyChecking=yes -oUserKnownHostsFile=%q -oGlobalKnownHostsFile=/dev/null' \
    "$SSH_CONNECT_TIMEOUT" "$SSH_KEEPALIVE" "$KNOWN_HOSTS"
}

fetch_once() {
  local repo_dir="$1" ref="$2" kind="$3" url="$4"
  local git_dir fetch_head
  git_dir="$(git -C "$repo_dir" rev-parse --absolute-git-dir)"
  fetch_head="$git_dir/FETCH_HEAD"
  rm -f "$fetch_head"

  if [[ "$kind" == ssh ]]; then
    local command
    command="$(ssh_command)"
    GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$command" \
      timeout --foreground --signal=TERM --kill-after=5 "${FETCH_TIMEOUT}s" \
      git -C "$repo_dir" fetch --no-tags --force "$url" "$ref"
  else
    GIT_TERMINAL_PROMPT=0 \
      timeout --foreground --signal=TERM --kill-after=5 "${FETCH_TIMEOUT}s" \
      git -C "$repo_dir" \
        -c http.version=HTTP/1.1 \
        -c "http.lowSpeedTime=$HTTPS_LOW_SPEED_TIME" \
        -c "http.lowSpeedLimit=$HTTPS_LOW_SPEED_LIMIT" \
        fetch --no-tags --force "$url" "$ref"
  fi

  [[ -s "$fetch_head" ]] || return 1
  git -C "$repo_dir" rev-parse --verify 'FETCH_HEAD^{commit}' >/dev/null 2>&1
}

fetch_with_fallback() {
  local repo_dir="$1" ref="$2" logfile="${3:-}" origin index attempt delay label kind url
  [[ -d "$repo_dir/.git" ]] || { echo "Git repository not found: $repo_dir" >&2; return 1; }
  [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ && "$ref" != -* && "$ref" != *..* ]] || { echo "invalid ref: $ref" >&2; return 1; }
  command -v git >/dev/null || { echo "git is unavailable" >&2; return 1; }
  command -v timeout >/dev/null || { echo "timeout is unavailable" >&2; return 1; }

  origin="$(git -C "$repo_dir" remote get-url origin)"
  build_candidates "$origin"

  for index in "${!URLS[@]}"; do
    label="${LABELS[$index]}"; kind="${KINDS[$index]}"; url="${URLS[$index]}"
    for attempt in $(seq 1 "$FETCH_RETRIES"); do
      log_line "GitHub fetch route=$label transport=$kind attempt=$attempt/$FETCH_RETRIES" "$logfile"
      if fetch_once "$repo_dir" "$ref" "$kind" "$url" >>"${logfile:-/dev/null}" 2>&1; then
        log_line "GitHub fetch succeeded route=$label" "$logfile"
        printf '%s\n' "$label"
        return 0
      fi
      if (( attempt < FETCH_RETRIES )); then
        delay=$(( attempt * attempt * 2 ))
        log_line "GitHub fetch failed route=$label; retrying in ${delay}s" "$logfile"
        sleep "$delay"
      else
        log_line "GitHub fetch exhausted route=$label" "$logfile"
      fi
    done
  done

  log_line "All GitHub fetch routes failed" "$logfile"
  return 1
}

main() {
  validate_settings
  case "${1:-}" in
    --validate-url)
      [[ $# -eq 2 ]] || { echo "usage: $0 --validate-url URL" >&2; return 2; }
      trusted_url "$2"
      ;;
    --plan)
      [[ $# -ge 2 && $# -le 3 ]] || { echo "usage: $0 --plan ORIGIN [MODE]" >&2; return 2; }
      if [[ $# -eq 3 ]]; then MODE="$3"; validate_settings; fi
      build_candidates "$2"
      local i
      for i in "${!URLS[@]}"; do printf '%s|%s|%s\n' "${LABELS[$i]}" "${KINDS[$i]}" "${URLS[$i]}"; done
      ;;
    *)
      [[ $# -ge 2 && $# -le 3 ]] || { echo "usage: $0 REPO_DIR REF [LOG_FILE]" >&2; return 2; }
      fetch_with_fallback "$1" "$2" "${3:-}"
      ;;
  esac
}

main "$@"
