#!/usr/bin/env bash
# Shared helpers for the track 1 simulation harness (campaign 20261029-3f1a8ab1).
# Track-local copy by design: other tracks copy, they do not share this file.
set -euo pipefail

TRACK1_BASELINE="1c0c088cb4ed66d0dd8b3e34c9606019342a1a56"
TRACK1_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACK1_APP_DIR="${TRACK1_APP_DIR:-}"
SIM_HOME="${SIM_HOME:-}"
TRACK1_APP_PORT="${TRACK1_APP_PORT:-}"
TRACK1_DB_URL="${TRACK1_DB_URL:-}"
umask 077

log(){ printf '[track1 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die(){ log "FAIL: $*"; exit 1; }
utc(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
require_runtime_assignment(){ python3 "$TRACK1_DIR/packet.py" --admit "$1" || die "runtime assignment/identity admission failed"; }
load_private_env(){
  local parsed item
  parsed="$(mktemp "$ENV_DIR/private/parsed-env.XXXXXX")"
  python3 "$TRACK1_DIR/packet.py" --env-values "$ENV_DIR/private/app.env" > "$parsed" || { rm -f "$parsed"; die "private environment could not be parsed"; }
  while IFS= read -r -d '' item; do export "$item"; done < "$parsed"
  rm -f "$parsed"
}

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
clear_markers(){ ( cd "$SIM_HOME" && rm -f replay-commit replay-at applied-migrations.tsv built-commit built-build-id fingerprint db-url ); }

# Only the PID/session recorded by up.sh may be stopped. Never kill by port/name.
stop_owned_app(){
  python3 - "$ENV_DIR/app-process.json" "$TRACK1_APP_DIR" <<'PY'
import json, os, pathlib, signal, sys, time
p = pathlib.Path(sys.argv[1])
if not p.exists():
    if p.with_name('app.pid').exists(): raise SystemExit('app process has no owned session receipt')
    raise SystemExit(0)
r = json.loads(p.read_text()); pid = r['pid']; proc = pathlib.Path('/proc') / str(pid)
def members():
    found = []
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pid and fields[0] != 'Z': found.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found
def owned():
    if not proc.exists():
        if members(): raise SystemExit('recorded app leader is gone but assigned process group is not empty; coordinator recovery required')
        return False
    # /proc/stat command names may contain spaces or parentheses.
    try:
        fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        if int(fields[19]) != r['startTicks'] or os.getpgid(pid) != pid or str((proc / 'cwd').resolve()) != sys.argv[2]:
            raise SystemExit('app PID/session identity differs; coordinator recovery required')
        return fields[0] != 'Z'
    except (FileNotFoundError, ProcessLookupError):
        return False
if owned():
    os.killpg(pid, signal.SIGTERM)
    for _ in range(20):
        if not proc.exists(): break
        time.sleep(.1)
    if owned():
        os.killpg(pid, signal.SIGKILL)
        for _ in range(20):
            if not owned(): break
            time.sleep(.1)
    if owned() or members(): raise SystemExit('owned app process group did not stop; coordinator recovery required')
elif members():
    raise SystemExit('recorded app leader is gone but assigned process group is not empty; coordinator recovery required')
PY
}
