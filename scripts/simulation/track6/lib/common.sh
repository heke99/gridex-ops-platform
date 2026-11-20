#!/usr/bin/env bash
# T6 lifecycle helpers. Runtime resources are explicitly assigned by the coordinator.
T6_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${SIM_RUN_DIR:-}"
SIM_HOME="${SIM_HOME:-}"
ENV_FILE="$SIM_HOME/env/track6.json"
PID_DIR="$SIM_HOME/pids"
LOG_DIR="$SIM_HOME/logs"
export SIM_RUN_DIR="${SIM_RUN_DIR:-}" T6_APP_COMMIT="${T6_APP_COMMIT:-}" SIM_HOME T6_DB_URL="${T6_DB_URL:-}"
export T6_RUNTIME_ASSIGNMENT_FILE="${T6_RUNTIME_ASSIGNMENT_FILE:-}" T6_BACKEND_ASSIGNMENT_FILE="${T6_BACKEND_ASSIGNMENT_FILE:-}"
umask 077

t6_log() { printf '[track6 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
t6_die() { t6_log "BLOCKED: T6 runtime $*" >&2; exit 1; }
t6_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
t6_admit() { node "$T6_DIR/lib/seed-cli.mjs" --admit "$1" || t6_die "admission failed"; }
t6_load_env() {
  local parsed item
  T6_PRIVATE_ENV=()
  parsed="$(mktemp "$SIM_HOME/env/.parsed.XXXXXXXX")" || t6_die "private environment temp file failed"
  node "$T6_DIR/lib/seed-cli.mjs" --env-values > "$parsed" || { rm -f "$parsed"; t6_die "private JSON environment invalid"; }
  while IFS= read -r -d '' item; do export "$item"; T6_PRIVATE_ENV+=("$item"); done < "$parsed"
  rm -f "$parsed"
  T6_NODE_BIN="$(node -p 'process.execPath')"
  T6_EXEC_ENV=(env -i "PATH=$PATH" "SIM_HOME=$SIM_HOME" "SIM_RUN_DIR=$SIM_RUN_DIR" "T6_APP_COMMIT=$T6_APP_COMMIT"
    "T6_RUNTIME_ASSIGNMENT_FILE=$T6_RUNTIME_ASSIGNMENT_FILE" "T6_BACKEND_ASSIGNMENT_FILE=$T6_BACKEND_ASSIGNMENT_FILE"
    "NEXT_TELEMETRY_DISABLED=1" "${T6_PRIVATE_ENV[@]}")
}
t6_lock() {
  mkdir "$SIM_HOME/run.lock" 2>/dev/null || t6_die "run.lock already exists; coordinator recovery required"
  printf '%s\n' "$$" > "$SIM_HOME/run.lock/pid"
  trap 'if [[ "$(cat "$SIM_HOME/run.lock/pid" 2>/dev/null)" == "$$" ]]; then rm -f "$SIM_HOME/run.lock/pid"; rmdir "$SIM_HOME/run.lock"; fi' EXIT
}
t6_wait_for() {
  local what="$1" timeout="$2"; shift 2
  local end=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS < end )) || t6_die "timeout waiting for $what"
    sleep 1
  done
}
