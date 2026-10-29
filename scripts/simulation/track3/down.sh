#!/usr/bin/env bash
# Spår 3: stoppa allt up.sh startat. Verifierar att inget spårprocess/container finns kvar och skriver kvitto.
#   down.sh [--stack] [--purge]
#     --stack  stoppar även den lokala Supabase-stacken (supabase stop --no-backup => containrar + volymer)
#     --purge  raderar dessutom genererat tillstånd i SIM_HOME (env, ca, secrets, mail, pids, runs, evidence, fixture)
#              (behåller logs/ och sim-runnerns shim/replay-kvitton)
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
STACK=0; PURGE=0
for a in "$@"; do case "$a" in --stack) STACK=1 ;; --purge) PURGE=1 ;; *) t3_die "okänd parameter: $a" ;; esac; done

stop_pid() { # <pidfil> <namn>
  local f="$1" name="$2" pid
  [[ -s "$f" ]] || return 0
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    t3_log "stoppar $name (pid $pid)"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && { kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true; }
  fi
  rm -f "$f"
}

stop_pid "$PID_DIR/app.pid" "next start"
rm -f "$PID_DIR/app.env-sha"
stop_pid "$PID_DIR/counterparty.pid" "mailmotpart"
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$T3_GREENMAIL_NAME"; then
  t3_log "stoppar container $T3_GREENMAIL_NAME"
  docker rm -f -v "$T3_GREENMAIL_NAME" >/dev/null 2>&1 || true
fi
# Alla containrar märkta för spåret (inkl. ev. kvarglömda).
mapfile -t LABELLED < <(docker ps -aq --filter label=sim.track=track3 2>/dev/null)
(( ${#LABELLED[@]} )) && docker rm -f -v "${LABELLED[@]}" >/dev/null 2>&1

if (( STACK )); then
  t3_log "stoppar Supabase-stacken (supabase stop --no-backup)"
  ( cd "$RUN_DIR" && "$T3_SUPABASE_BIN" stop --no-backup ) >"$LOG_DIR/supabase-stop.log" 2>&1 || t3_log "supabase stop returnerade fel (se $LOG_DIR/supabase-stop.log)"
fi

# ---- verifiering ----
left=()
for p in "$T3_APP_PORT" "$T3_SMTP_PORT" "$T3_IMAP_TLS_PORT" "$T3_IMAP_PLAIN_PORT" "$T3_CONTROL_PORT"; do
  t3_port_open "$p" && left+=("port:$p")
done
pgrep -f "simulation/track3/counterparty/mail-counterparty.mjs" >/dev/null 2>&1 && left+=("process:mail-counterparty")
pgrep -f "next start -p $T3_APP_PORT" >/dev/null 2>&1 && left+=("process:next-start")
docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$T3_GREENMAIL_NAME" && left+=("container:$T3_GREENMAIL_NAME")
if (( STACK )); then
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q 'supabase_.*_gridex-ops-platform' && left+=("containers:supabase")
  docker volume ls -q 2>/dev/null | grep -q 'supabase_.*gridex-ops-platform' && left+=("volumes:supabase")
fi
if (( PURGE )); then
  for d in env ca secrets mail pids runs evidence; do rm -rf "${SIM_HOME:?}/$d"; done
  rm -f "$SIM_HOME/fixture.json" "$SIM_HOME/mode" "$SIM_HOME/built-commit"
fi

mkdir -p "$SIM_HOME"
RECEIPT="$SIM_HOME/cleanup-receipt.json"
{
  printf '{\n  "at": "%s",\n  "stack_stopped": %s,\n  "purged": %s,\n  "left": [' "$(t3_utc)" "$( ((STACK)) && echo true || echo false)" "$( ((PURGE)) && echo true || echo false)"
  first=1; for l in "${left[@]:-}"; do [[ -z "$l" ]] && continue; (( first )) || printf ','; first=0; printf '"%s"' "$l"; done
  printf '],\n  "clean": %s\n}\n' "$( ((${#left[@]})) && echo false || echo true)"
} > "$RECEIPT"
cat "$RECEIPT"
if (( ${#left[@]} )); then t3_log "KVAR: ${left[*]}" >&2; exit 1; fi
t3_log "rent: inga spårprocesser/containrar kvar"
