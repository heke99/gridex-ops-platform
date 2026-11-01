#!/usr/bin/env bash
# Same-host T6 producer. No allocation is acquired and no shared GEN is produced.
set -euo pipefail
umask 077
T6_PREPARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T6_PREPARE_MODULE="$T6_PREPARE_DIR/lib/prepare.mjs"
if [[ "${1:-}" == '--check' && $# == 1 ]]; then
  exec node "$T6_PREPARE_MODULE" --check
fi
if [[ "${1:-}" != '--inner' ]]; then
  exec node "$T6_PREPARE_MODULE" --execute "$@"
fi
shift
# Only the producer may reach this phase; --begin reauthenticates the allocation,
# exact source, empty assigned daemon, capacity and fresh one-attempt output paths.
: "${T6_PRODUCER_NODE:?explicit producer Node required}"
: "${T6_PRODUCER_REPLAY:?explicit replay checkout required}"
: "${T6_PRODUCER_APP:?explicit app checkout required}"
: "${T6_PRODUCER_HARNESS:?explicit harness checkout required}"
: "${T6_PRODUCER_HOME:?explicit private output required}"
"$T6_PRODUCER_NODE" "$T6_PREPARE_MODULE" --begin
T6_SUPABASE_BIN="$(type -P supabase)"
[[ -n "$T6_SUPABASE_BIN" ]]
# Keep canonical cleanup, including its source restoration, but bound the one
# local stop subprocess. Never introduce a global Docker/process/DB cleanup.
supabase() {
  if [[ "${1:-}" == stop ]]; then
    timeout --signal=TERM --kill-after=10s 120s "$T6_SUPABASE_BIN" "$@"
  else
    "$T6_SUPABASE_BIN" "$@"
  fi
}
trap 'exit 143' TERM INT HUP
cd "$T6_PRODUCER_REPLAY"
# No GRIDEX_REPLAY_DB_URL: external schema reconstruction has no canonical ledger.
[[ -z "${GRIDEX_REPLAY_DB_URL:-}" ]]
# On replay failure its own reviewed EXIT cleanup still runs. On success retain
# that cleanup until both producer and scenario consumers finish in this shell.
source "$T6_PRODUCER_REPLAY/scripts/gridex-aud-003-clean-replay.sh" >> "$T6_PRODUCER_HOME/producer/replay.log" 2>&1
T6_CONSUMER_STARTED=0
t6_finish_producer() {
  local t6_status=$? t6_cleanup_status=0
  trap - EXIT
  set +e
  if [[ "$T6_CONSUMER_STARTED" == 1 ]]; then
    bash "$T6_PRODUCER_HARNESS/scripts/simulation/track6/down.sh" > "$T6_PRODUCER_HOME/producer/down.log" 2>&1 || t6_cleanup_status=1
  fi
  # Only the exact containers observed after our fresh replay may be cleaned.
  if "$T6_PRODUCER_NODE" "$T6_PREPARE_MODULE" --cleanup-check before; then
    cleanup
    "$T6_PRODUCER_NODE" "$T6_PREPARE_MODULE" --cleanup-check after || t6_cleanup_status=1
  else
    t6_cleanup_status=1
    printf '%s\n' 'BLOCKED: T6 prepare unknown/drifted backend preserved for reconciliation' >&2
  fi
  (( t6_cleanup_status == 0 )) || t6_status=1
  exit "$t6_status"
}
trap t6_finish_producer EXIT
"$T6_PRODUCER_NODE" "$T6_PREPARE_MODULE" --replay-complete
"$T6_PRODUCER_NODE" "$T6_PREPARE_MODULE" --produce
export SIM_RUN_DIR="$T6_PRODUCER_APP" SIM_HOME="$T6_PRODUCER_HOME"
export T6_APP_COMMIT
T6_APP_COMMIT="$(git -C "$SIM_RUN_DIR" rev-parse HEAD)"
export T6_RUNTIME_ASSIGNMENT_FILE="$SIM_HOME/runtime-assignment.json" T6_BACKEND_ASSIGNMENT_FILE="$SIM_HOME/backend-assignment.json"
export T6_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export SIM_REPORT="$SIM_HOME/reports/scenario-run.json"
T6_CONSUMER_STARTED=1
bash "$T6_PRODUCER_HARNESS/scripts/simulation/track6/up.sh" > "$SIM_HOME/producer/up.log" 2>&1
bash "$T6_PRODUCER_HARNESS/scripts/simulation/track6/run.sh" "$@" > "$SIM_HOME/producer/scenarios.log" 2>&1
