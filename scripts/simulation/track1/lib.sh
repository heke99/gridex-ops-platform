#!/usr/bin/env bash
# Shared helpers for the track 1 simulation harness (campaign 20261029-3f1a8ab1).
# Track-local copy by design: other tracks copy, they do not share this file.
set -euo pipefail

TRACK1_BASELINE="1c0c088cb4ed66d0dd8b3e34c9606019342a1a56"
TRACK1_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACK1_APP_DIR="${TRACK1_APP_DIR:-/root/sim-run/app}"
SIM_HOME="${SIM_HOME:-/root/sim-home/track1}"
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
