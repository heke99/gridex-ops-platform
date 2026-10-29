#!/usr/bin/env bash
# Stop track 1's stack and app; verify nothing of it remains; write cleanup.json.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_DIR="$(current_env_dir)"
acquire_lock

if [[ -f "$ENV_DIR/app.pid" ]]; then
  pid="$(cat "$ENV_DIR/app.pid")"
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL "$pid" 2>/dev/null || true
fi
pkill -f "next start -H 127.0.0.1 -p $TRACK1_APP_PORT" 2>/dev/null || true
( cd "$TRACK1_APP_DIR" && supabase stop --no-backup ) > "$ENV_DIR/logs/down.log" 2>&1 || true

left_containers="$(stack_containers | wc -l)"
left_app="$(pgrep -fc "next start -H 127.0.0.1 -p $TRACK1_APP_PORT" || true)"
left_volumes="$(docker volume ls -q --filter "label=com.supabase.cli.project" | wc -l)"
python3 - "$ENV_DIR/cleanup.json" <<PY
import json, sys
json.dump({"environmentId": "$(basename "$ENV_DIR")", "stoppedAtUtc": "$(utc)",
           "remainingContainers": $left_containers, "remainingAppProcesses": ${left_app:-0},
           "remainingSupabaseVolumes": $left_volumes,
           "clean": $left_containers == 0 and ${left_app:-0} == 0 and $left_volumes == 0},
          open(sys.argv[1], "w"), indent=2)
PY
cat "$ENV_DIR/cleanup.json"
[[ "$left_containers" == 0 && "${left_app:-0}" == 0 && "$left_volumes" == 0 ]] || die "cleanup incomplete"
clear_markers
rm -f "$SIM_HOME/current"
log "stack $(basename "$ENV_DIR") stopped"
