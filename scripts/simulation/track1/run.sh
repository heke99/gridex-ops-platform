#!/usr/bin/env bash
# Run one whole scenario file against the active track 1 stack.
# Usage: run.sh <scenario-file.test.ts> [run-label]
# One run at a time per container (flock). Each run gets its own directory with
# report.json (vitest JSON reporter), run.log and a final "exit <code>" line.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SCENARIO="$(readlink -f "${1:?scenario file required}")"
LABEL="${2:-$(basename "$SCENARIO" .test.ts)}"
ENV_DIR="$(current_env_dir)"
[[ -f "$ENV_DIR/stack.json" ]] || die "stack not ready"
exec 9>"$SIM_HOME/run.lock"
flock -n 9 || die "another run is active"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$LABEL"
RUN_DIR="$ENV_DIR/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
set -a; source "$ENV_DIR/private/app.env"; set +a
export TRACK1_RUN_DIR="$RUN_DIR" TRACK1_STACK_JSON="$ENV_DIR/stack.json" TRACK1_APP_URL="http://127.0.0.1:$TRACK1_APP_PORT"
log "run $RUN_ID"
python3 - "$RUN_DIR/run-meta.json" "$SCENARIO" "$ENV_DIR/stack.json" "$TRACK1_DIR" "$TRACK1_APP_DIR" <<'PY'
import json, hashlib, subprocess, sys, datetime
out, scenario, stack, harness, app = sys.argv[1:]
git = lambda d, *a: subprocess.check_output(["git", "-C", d, *a], text=True).strip()
json.dump({
  "runStartedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
  "scenarioFile": scenario.split("/scripts/simulation/", 1)[-1],
  "scenarioSha256": hashlib.sha256(open(scenario, "rb").read()).hexdigest(),
  "harnessCommit": git(harness, "rev-parse", "HEAD"),
  "harnessDirty": bool(git(harness, "status", "--porcelain", "--", ".")),
  "appCommit": git(app, "rev-parse", "HEAD"),
  "appDirty": bool(git(app, "status", "--porcelain")),
  "stack": json.load(open(stack)),
}, open(out, "w"), indent=2)
PY
T0=$(date +%s%N)
set +e
HARNESS_ROOT="$(git -C "$TRACK1_DIR" rev-parse --show-toplevel)"
( cd "$HARNESS_ROOT" && TRACK1_APP_DIR="$TRACK1_APP_DIR" "$TRACK1_APP_DIR/node_modules/.bin/vitest" run \
    --config "$TRACK1_DIR/vitest.config.mts" --root "$HARNESS_ROOT" \
    --reporter=default --reporter=json --outputFile.json="$RUN_DIR/report.json" \
    "$SCENARIO" ) > "$RUN_DIR/run.log" 2>&1
CODE=$?
set -e
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
echo "wallMs $MS" >> "$RUN_DIR/run.log"
echo "exit $CODE" >> "$RUN_DIR/run.log"
log "run $RUN_ID exit $CODE (${MS} ms) -> $RUN_DIR"
exit $CODE
