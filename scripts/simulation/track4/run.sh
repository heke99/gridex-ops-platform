#!/usr/bin/env bash
# Track 4 harness: run one scenario file against the live T4 stack.
#   bash scripts/simulation/track4/run.sh scripts/simulation/track4/scenarios/billing-invoice-files.mjs [--only MAIN04.02] [--keep-fixture]
# One run at a time (lock in SIM_HOME). Output: $SIM_HOME/runs/<run-id>/{run.log,run.json,report-<scenario>.json,summary.json}
# SIM_REPORT=<path> is required: the merged JSON report (scenario ID per step, status per step, vitest-style summary) is written
# there; the per-scenario reports and the log stay under SIM_HOME/runs/<run-id>/.
# Exit code: 0 all executed steps passed (skips allowed), 1 at least one step failed, 2 usage/no SIM_REPORT, 3 stack not ready,
# 4 run.lock exists.
set -uo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

[ -n "${SIM_REPORT:-}" ] || { echo "refusing to start: SIM_REPORT (path of the JSON report) is not set" >&2; exit 2; }
SCENARIO="${1:-}"
# Accept a path relative to track4/ (scenarios/x.mjs), to the repo root, or to the cwd.
for cand in "$SCENARIO" "$T4_DIR/$SCENARIO" "$APP_DIR/$SCENARIO"; do
  if [ -n "$SCENARIO" ] && [ -f "$cand" ]; then SCENARIO="$cand"; break; fi
done
[ -n "$SCENARIO" ] && [ -f "$SCENARIO" ] || { echo "usage: run.sh <scenario-file.mjs> [runner options]" >&2; exit 2; }
shift
SCENARIO="$(cd "$(dirname "$SCENARIO")" && pwd)/$(basename "$SCENARIO")"
t4_init
t4_load_env
t4_assert_local

mkdir -p "$(dirname "$SIM_REPORT")"
t4_lock_acquire "$@" || exit 4

t4_db_ready || { echo "T4 database not ready on :$T4_DB_PORT (run up.sh)" >&2; exit 3; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$T4_APP_URL/login" 2>/dev/null)" = 200 ] || { echo "T4 app not answering at $T4_APP_URL (run up.sh)" >&2; exit 3; }

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$RUNS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"
STARTED="$(t4_now)"
SINK_BEFORE="$(wc -l < "$LOG_DIR/sink-requests.jsonl" 2>/dev/null || echo 0)"

T4_SIM_HOME="$SIM_HOME" T4_RUN_DIR="$RUN_DIR" T4_RUN_ID="$RUN_ID" \
  node "$T4_DIR/runner/run-scenarios.mjs" --scenario "$SCENARIO" --out "$RUN_DIR" --report "$SIM_REPORT" "$@" 2>&1 | tee "$RUN_DIR/run.log"
EXIT="${PIPESTATUS[0]}"

FINISHED="$(t4_now)"
SINK_AFTER="$(wc -l < "$LOG_DIR/sink-requests.jsonl" 2>/dev/null || echo 0)"
cat > "$RUN_DIR/run.json" <<JSON
{"runId":"$RUN_ID","scenarioFile":"$SCENARIO","exitCode":$EXIT,"startedAt":"$STARTED","finishedAt":"$FINISHED","appCommit":"$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)","replayCommit":"$(cat "$SIM_HOME/replay-commit" 2>/dev/null || true)","sinkRequestsDuringRun":$((SINK_AFTER - SINK_BEFORE))}
JSON
echo "[t4 run] $RUN_ID exit=$EXIT reports in $RUN_DIR"
exit "$EXIT"
