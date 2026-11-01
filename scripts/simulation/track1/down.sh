#!/usr/bin/env bash
# Stop track 1's stack and app; verify nothing of it remains; write cleanup.json.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ -n "${TRACK1_ASSIGNMENT_FILE:-}" ]] && [[ "$(python3 "$TRACK1_DIR/packet.py" --assignment-mode)" == coordinator_prepared_fresh ]]; then
  exec python3 "$TRACK1_DIR/../runtime/assigned_backend.py" down --assignment "$TRACK1_ASSIGNMENT_FILE"
fi

require_runtime_assignment down

ENV_DIR="$(current_env_dir)"
acquire_lock

stop_owned_app
( cd "$TRACK1_APP_DIR" && supabase stop --no-backup ) > "$ENV_DIR/logs/down.log" 2>&1 || die "owned stack stop failed"

left_containers="$(stack_containers | wc -l)"
left_app=0 # stop_owned_app verified and stopped the recorded process session.
project="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["projectId"])' "$ENV_DIR/stack.json")"
left_volumes="$(docker volume ls -q --filter "label=com.supabase.cli.project=$project" | wc -l)"
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
