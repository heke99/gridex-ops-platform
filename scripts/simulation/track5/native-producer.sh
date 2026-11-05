#!/usr/bin/env bash
# Explicit manual producer entry. Requires an independently admitted PRIVATE bundle;
# this profile neither claims resources nor creates a runtime grant.
set -euo pipefail
umask 077

t5_canonical_flow() {
  local T5_APP="$1" T5_BUNDLE="$2" T5_HARNESS T5_STATUS=0 T5_GROUP
  T5_HARNESS="$T5_APP/scripts/simulation/track5"
  python3 -B -I "$T5_HARNESS/lib/native-supervisor.py" --check-realm "$T5_BUNDLE"
  trap 'exit 143' TERM
  trap 'exit 130' INT
  python3 -B -I "$T5_HARNESS/lib/prepared-backend.py" stage \
    --assignment "$SIM_RUNTIME_ASSIGNMENT_FILE" --receipt "$SIM_HOME/prepared-backend.json" --replay-log "$SIM_HOME/logs/replay.log"
  python3 -B -I "$T5_HARNESS/lib/native-supervisor.py" --check-realm "$T5_BUNDLE"
  cd "$SIM_HOME/replay-root"
  unset GRIDEX_REPLAY_DB_URL
  export SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NEXT_TELEMETRY_DISABLED=1
  ( set -o noclobber; : > "$SIM_HOME/logs/replay.log" )
  # Bare sourcing is deliberate. No if/||/subshell disables errexit or ends the
  # canonical EXIT trap before up/scenarios. Canonical variables stay in this shell.
  source scripts/gridex-aud-003-clean-replay.sh >> "$SIM_HOME/logs/replay.log" 2>&1
  python3 -B -I "$T5_HARNESS/lib/native-supervisor.py" --check-realm "$T5_BUNDLE"
  python3 -B -I "$T5_HARNESS/lib/prepared-backend.py" record \
    --assignment "$SIM_RUNTIME_ASSIGNMENT_FILE" --receipt "$SIM_HOME/prepared-backend.json" --replay-log "$SIM_HOME/logs/replay.log"
  python3 -B -I "$T5_HARNESS/lib/native-supervisor.py" --check-realm "$T5_BUNDLE"
  bash "$T5_HARNESS/up.sh"
  for T5_GROUP in $T5_GROUPS; do
    python3 -B -I "$T5_HARNESS/lib/native-supervisor.py" --check-realm "$T5_BUNDLE"
    if SIM_REPORT="$SIM_HOME/reports/$T5_GROUP-report.json" bash "$T5_HARNESS/run.sh" "scenarios/$T5_GROUP.test.ts"; then
      :
    else
      T5_STATUS=1
    fi
  done
  if bash "$T5_HARNESS/down.sh" --processes-only; then :; else T5_STATUS=1; fi
  return "$T5_STATUS"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ $# == 2 ]] || { printf '%s\n' '{"state":"HOLD","error":"private_bundle_required"}'; exit 1; }
  T5_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  case "$1" in
    --supervise) exec python3 -B -I "$T5_SCRIPT_DIR/lib/native-supervisor.py" --supervise "$2" ;;
    --inside-shell) t5_canonical_flow "${RUN_DIR:?}" "$2" ;;
    *) printf '%s\n' '{"state":"HOLD","error":"explicit_mode_required"}'; exit 1 ;;
  esac
fi
