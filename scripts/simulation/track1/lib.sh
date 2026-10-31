#!/usr/bin/env bash
# Shared helpers for the track 1 simulation harness (campaign 20261029-3f1a8ab1).
# Track-local copy by design: other tracks copy, they do not share this file.
set -euo pipefail

TRACK1_BASELINE="1c0c088cb4ed66d0dd8b3e34c9606019342a1a56"
TRACK1_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACK1_APP_DIR="${TRACK1_APP_DIR:-/root/sim-run/app}"
SIM_HOME="${SIM_HOME:-$HOME/sim-home/track1}"
TRACK1_APP_PORT="${TRACK1_APP_PORT:-3101}"
TRACK1_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

log(){ printf '[track1 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die(){ log "FAIL: $*"; exit 1; }
utc(){ date -u +%Y-%m-%dT%H:%M:%SZ; }

current_env_dir(){
  [[ -L "$SIM_HOME/current" ]] || die "no active stack (run up.sh)"
  readlink -f "$SIM_HOME/current"
}

# Supabase containers belonging to the app dir's project (config.toml project_id).
stack_containers(){
  local project
  project="$(python3 -c 'import sys,tomllib;print(tomllib.load(open(sys.argv[1],"rb"))["project_id"])' "$TRACK1_APP_DIR/supabase/config.toml")"
  docker ps -aq --filter "label=com.supabase.cli.project=$project"
}

app_tree_clean(){
  [[ -z "$(git -C "$TRACK1_APP_DIR" status --porcelain --untracked-files=normal)" ]]
}

# --- run.lock: atomic (noclobber), "<pid>\n<start utc>\n". A lock left behind
# is never removed here; only sim-runner removes a stale one by hand.
LOCK_FILE="$SIM_HOME/run.lock"
LOCK_HELD=0
acquire_lock(){
  mkdir -p "$SIM_HOME"
  if ! ( set -o noclobber; printf '%s\n%s\n' "$$" "$(utc)" > "$LOCK_FILE" ) 2>/dev/null; then
    die "run.lock exists ($(tr '\n' ' ' < "$LOCK_FILE" 2>/dev/null)); refusing. A stale lock is removed only by sim-runner"
  fi
  LOCK_HELD=1
  trap release_lock EXIT
}
release_lock(){
  if [[ "$LOCK_HELD" == 1 && "$(head -n1 "$LOCK_FILE" 2>/dev/null)" == "$$" ]]; then rm -f "$LOCK_FILE"; fi
  LOCK_HELD=0
}
# Marker files at the top level of SIM_HOME (describe the active stack).
clear_markers(){ ( cd "$SIM_HOME" && rm -f replay-commit replay-at applied-migrations.tsv built-commit fingerprint db-url ); }
