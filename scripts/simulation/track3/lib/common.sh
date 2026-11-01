#!/usr/bin/env bash
# T3 lifecycle helpers. Runtime resources are explicitly assigned by the coordinator.
T3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${SIM_RUN_DIR:-}"
SIM_HOME="${SIM_HOME:-}"
ENV_FILE="$SIM_HOME/env/track3.json"
PID_DIR="$SIM_HOME/pids"
LOG_DIR="$SIM_HOME/logs"
export SIM_RUN_DIR="${SIM_RUN_DIR:-}" T3_APP_COMMIT="${T3_APP_COMMIT:-}" SIM_HOME T3_DB_URL="${T3_DB_URL:-}"
export T3_RUNTIME_ASSIGNMENT_FILE="${T3_RUNTIME_ASSIGNMENT_FILE:-}" T3_BACKEND_ASSIGNMENT_FILE="${T3_BACKEND_ASSIGNMENT_FILE:-}"
umask 077

t3_log() { printf '[track3 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
t3_die() { t3_log "BLOCKED: T3 runtime $*" >&2; exit 1; }
t3_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
t3_admit() { node "$T3_DIR/lib/seed-cli.mjs" --admit "$1" || t3_die "admission failed"; }
t3_load_env() {
  local parsed item
  T3_PRIVATE_ENV=()
  parsed="$(mktemp "$SIM_HOME/env/.parsed.XXXXXXXX")" || t3_die "private environment temp file failed"
  node "$T3_DIR/lib/seed-cli.mjs" --env-values > "$parsed" || { rm -f "$parsed"; t3_die "private JSON environment invalid"; }
  while IFS= read -r -d '' item; do export "$item"; T3_PRIVATE_ENV+=("$item"); done < "$parsed"
  rm -f "$parsed"
  T3_NODE_BIN="$(node -p 'process.execPath')"
  T3_EXEC_ENV=(env -i "PATH=$PATH" "SIM_HOME=$SIM_HOME" "SIM_RUN_DIR=$SIM_RUN_DIR" "T3_APP_COMMIT=$T3_APP_COMMIT"
    "T3_RUNTIME_ASSIGNMENT_FILE=$T3_RUNTIME_ASSIGNMENT_FILE" "T3_BACKEND_ASSIGNMENT_FILE=$T3_BACKEND_ASSIGNMENT_FILE"
    "DOCKER_HOST=${DOCKER_HOST:-}" "NEXT_TELEMETRY_DISABLED=1" "${T3_PRIVATE_ENV[@]}")
}
t3_lock() {
  [[ -d "$SIM_HOME" && ! -L "$SIM_HOME/run.lock" ]] || t3_die 'private home or run.lock changed'
  exec 9>"$SIM_HOME/run.lock" || t3_die 'could not open run.lock'
  flock -n 9 || t3_die 'another assigned operation holds run.lock'
}
t3_wait_for() {
  local what="$1" timeout="$2"; shift 2
  local end=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS < end )) || t3_die "timeout waiting for $what"
    sleep 1
  done
}
