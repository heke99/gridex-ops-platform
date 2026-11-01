#!/usr/bin/env bash
# Track 4 harness: stop everything up.sh started (app, sink, Supabase containers and volumes) and verify
# that no T4 container, volume or listener remains. Exit 1 if anything is left.
# T4_KEEP_DB=1 keeps the Supabase stack (app and sink are still stopped).
set -uo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
mkdir -p "$PID_DIR" "$LOG_DIR"

stop_pid() {
  local file="$1" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

stop_pid "$PID_DIR/app.pid"
stop_pid "$PID_DIR/sink.pid"
# Listeners on T4's own ports only (these ports belong to T4 by assignment).
for port in "$T4_APP_PORT" "$T4_SINK_PORT"; do fuser -k "${port}/tcp" >/dev/null 2>&1 || true; done

docker rm -f "$T4_MAIL_CONTAINER" >/dev/null 2>&1 || true
# simulators the source-chain run started (grid owner) and any vitest chain run
for f in "$PID_DIR"/gridowner-*.pid; do [ -f "$f" ] && stop_pid "$f"; done
rm -f "$SIM_HOME/app-env.sha"
if [ "${T4_KEEP_DB:-0}" != 1 ]; then
  if command -v supabase >/dev/null; then
    ( cd "$APP_DIR" && supabase stop --no-backup >/dev/null 2>&1 ) || true
  fi
  # Anything the CLI left behind for this project id (containers, volumes, network).
  docker ps -aq --filter "name=_${T4_PROJECT_ID}\$" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=_${T4_PROJECT_ID}\$" | xargs -r docker volume rm -f >/dev/null 2>&1 || true
  docker network ls -q --filter "name=_${T4_PROJECT_ID}\$" | xargs -r docker network rm >/dev/null 2>&1 || true
  rm -f "$SIM_HOME/replay-commit" "$SIM_HOME/replay-at" "$SIM_HOME/applied-migrations.tsv" "$SIM_HOME/built-commit" "$SIM_HOME/fixture.json" "$SIM_HOME/chain.json" "$SIM_HOME/fingerprint" "$SIM_HOME/db-url"
fi

left=0
c="$(docker ps -a --format '{{.Names}}' | grep -x "$T4_MAIL_CONTAINER" || true)"; [ -z "$c" ] || { echo "[t4 down] REMAINS: container $c" >&2; left=1; }
for port in "$T4_SMTPS_PORT" "$T4_IMAPS_PORT" "$T4_MAIL_API_PORT"; do t4_port_open "$port" && { echo "[t4 down] REMAINS: port $port open" >&2; left=1; }; done
report() { echo "[t4 down] REMAINS: $*" >&2; left=1; }
if [ "${T4_KEEP_DB:-0}" != 1 ]; then
  c="$(docker ps -a --format '{{.Names}}' | grep -E "_${T4_PROJECT_ID}\$" || true)"; [ -z "$c" ] || report "containers: $c"
  v="$(docker volume ls --format '{{.Name}}' | grep -E "_${T4_PROJECT_ID}\$" || true)"; [ -z "$v" ] || report "volumes: $v"
  for port in "$T4_API_PORT" "$T4_DB_PORT"; do t4_port_open "$port" && report "port $port still open"; done
fi
for port in "$T4_APP_PORT" "$T4_SINK_PORT"; do t4_port_open "$port" && report "port $port still open"; done
p="$(pgrep -af "next start .*-p ${T4_APP_PORT}|counterparties/sink[.]mjs" || true)"; [ -z "$p" ] || report "processes: $p"
[ "$left" = 0 ] && echo "[t4 down] clean: no T4 containers, volumes, listeners or processes remain"
exit "$left"
