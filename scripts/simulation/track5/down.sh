#!/usr/bin/env bash
# Stoppar allt up.sh startat (app, motparter, supabase-containrar och volymer) och verifierar att inget finns kvar.
# dockerd lämnas igång (imagecachen är dyr att bygga om; stoppa manuellt vid behov).
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

for p in app counterparts; do
  f="$SIM_HOME/pids/$p.pid"
  if [[ -f "$f" ]]; then
    pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true   # setsid => egen processgrupp
      for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$f"
  fi
done
# Reservspärr: ingen next/counterparts-process från detta SIM_HOME/RUN_DIR får leva kvar.
pkill -f "$HARNESS_DIR/lib/counterparts.mjs" 2>/dev/null || true
pkill -f "next start -H 127.0.0.1 -p $SIM_APP_PORT" 2>/dev/null || true

if docker info >/dev/null 2>&1; then
  if [[ -d "$REPLAY_ROOT/supabase" ]]; then sb stop --no-backup >>"$SIM_HOME/logs/down.log" 2>&1 || true; fi
  # Sopning på label/namn om CLI:t lämnat något (t.ex. avbruten start).
  ids="$(docker ps -aq --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")"
  [[ -z "$ids" ]] || docker rm -f $ids >/dev/null 2>&1 || true
  vols="$(docker volume ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")"
  [[ -z "$vols" ]] || docker volume rm -f $vols >/dev/null 2>&1 || true
  nets="$(docker network ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")"
  [[ -z "$nets" ]] || docker network rm $nets >/dev/null 2>&1 || true
fi

rc=0
if docker info >/dev/null 2>&1; then
  left_c="$(docker ps -aq --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID"; docker ps -a --format '{{.Names}}' | grep -E "_${SIM_PROJECT_ID}\$" || true)"
  left_v="$(docker volume ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID"; docker volume ls -q | grep -E "_${SIM_PROJECT_ID}\$" || true)"
  [[ -z "$left_c" ]] || { log "KVAR containrar: $left_c"; rc=1; }
  [[ -z "$left_v" ]] || { log "KVAR volymer: $left_v"; rc=1; }
fi
for p in app counterparts; do [[ ! -f "$SIM_HOME/pids/$p.pid" ]] || { log "KVAR pid-fil $p"; rc=1; }; done
if (echo >"/dev/tcp/127.0.0.1/$SIM_APP_PORT") 2>/dev/null; then log "KVAR: port $SIM_APP_PORT lyssnar"; rc=1; fi
rm -f "$SIM_HOME/replay-commit" "$SIM_HOME/replay-at" "$SIM_HOME/applied-migrations.tsv" "$SIM_HOME/app.env" "$SIM_HOME/db-url" "$SIM_HOME/fingerprint" "$SIM_HOME/built-commit"
rm -rf "$SIM_HOME/run.lock"
[[ $rc == 0 ]] && log "down: inget kvar" || log "down: rester kvar (se ovan)"
exit $rc
