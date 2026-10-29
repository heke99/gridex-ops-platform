#!/usr/bin/env bash
# Shared shell helpers for the Track 4 (T4) simulation harness. Sourced by up.sh, down.sh, run.sh.
# Everything T4 owns lives under $SIM_HOME; nothing here writes into tracked base files.

T4_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T4_DIR="$(cd "$T4_LIB_DIR/.." && pwd)"
# The run directory is the checkout this harness lives in (scripts/simulation/track4 -> repo root).
APP_DIR="${T4_APP_DIR:-$(cd "$T4_DIR/../../.." && pwd)}"

SIM_HOME="${SIM_HOME:-/home/user/sim-t4/home}"
T4_PROJECT_ID="${T4_PROJECT_ID:-gridex-sim-t4}"
T4_API_PORT="${T4_API_PORT:-55421}"
T4_DB_PORT="${T4_DB_PORT:-55422}"
T4_SHADOW_PORT="${T4_SHADOW_PORT:-55420}"
T4_MAIL_PORT="${T4_MAIL_PORT:-55424}"
T4_STUDIO_PORT="${T4_STUDIO_PORT:-55423}"
T4_POOLER_PORT="${T4_POOLER_PORT:-55429}"
T4_ANALYTICS_PORT="${T4_ANALYTICS_PORT:-55427}"
T4_APP_PORT="${T4_APP_PORT:-3104}"
T4_SINK_PORT="${T4_SINK_PORT:-3194}"

STACK_SRC="$SIM_HOME/stack-src"
ENV_FILE="$SIM_HOME/env"
LOG_DIR="$SIM_HOME/logs"
PID_DIR="$SIM_HOME/pids"
RUNS_DIR="$SIM_HOME/runs"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${T4_DB_PORT}/postgres"

# Supabase CLI is pinned: the replay script requires exactly 2.101.0.
if [ -d "$SIM_HOME/cli/node_modules/.bin" ]; then PATH="$SIM_HOME/cli/node_modules/.bin:$PATH"; fi
export PATH
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-ghcr.io}"

t4_log() { echo "[t4 $(basename "${0:-t4}")] $*"; }
t4_die() { echo "[t4 $(basename "${0:-t4}")] ERROR: $*" >&2; exit 1; }
t4_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
t4_head() { git -C "$APP_DIR" rev-parse HEAD; }

t4_init() {
  mkdir -p "$SIM_HOME" "$LOG_DIR" "$PID_DIR" "$RUNS_DIR"
  chmod 700 "$SIM_HOME" 2>/dev/null || true
}

t4_port_open() { (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
t4_wait_port() {
  local port="$1" tries="${2:-90}"
  for _ in $(seq 1 "$tries"); do t4_port_open "$port" && return 0; sleep 1; done
  return 1
}

# True when the replayed schema is present in the T4 database.
t4_db_ready() {
  [ "$(PGCONNECT_TIMEOUT=3 psql "$DB_URL" -X -At -c "select to_regclass('public.companies') is not null" 2>/dev/null || true)" = "t" ]
}

t4_load_env() {
  [ -f "$ENV_FILE" ] || t4_die "missing $ENV_FILE (run up.sh first)"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

# Local-only guard: the harness refuses to run against anything but the T4 loopback ports.
t4_assert_local() {
  case "${NEXT_PUBLIC_SUPABASE_URL:-}" in
    "http://127.0.0.1:${T4_API_PORT}") ;;
    *) t4_die "refusing: NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-<unset>} is not http://127.0.0.1:${T4_API_PORT}" ;;
  esac
}

t4_pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
