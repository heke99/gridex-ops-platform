#!/usr/bin/env bash
# Run one whole scenario file against the active track 1 stack.
# Usage: run.sh <scenario-file.test.ts> [run-label]
# Requires SIM_REPORT (path of the JSON report). One run at a time per
# container (SIM_HOME/run.lock, atomic; a stale lock is left for sim-runner). Each run gets its own directory with
# report.json (vitest JSON reporter), run.log and a final "exit <code>" line.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ -n "${TRACK1_ASSIGNMENT_FILE:-}" ]] && [[ "$(python3 "$TRACK1_DIR/packet.py" --assignment-mode)" == coordinator_prepared_fresh ]]; then
  exec python3 "$TRACK1_DIR/../runtime/assigned_backend.py" run --assignment "$TRACK1_ASSIGNMENT_FILE" \
    --scenario "${1:-}" --label "${2:-}" --report "${SIM_REPORT:-}"
fi

require_runtime_assignment run

[[ -n "${SIM_REPORT:-}" ]] || die "SIM_REPORT (path for the JSON report) is required"
[[ -f "${1:-}" ]] || die "scenario file required"
SCENARIO="$(readlink -f "${1:?scenario file required}")"
LABEL="${2:-$(basename "$SCENARIO" .test.ts)}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid run label"
ENV_DIR="$(current_env_dir)"
[[ -f "$ENV_DIR/stack.json" ]] || die "stack not ready"
acquire_lock

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$LABEL"
RUN_DIR="$ENV_DIR/runs/$RUN_ID"
mkdir "$RUN_DIR" || die "run directory already exists"
load_private_env
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
mkdir -p "$(dirname "$SIM_REPORT")"
python3 - "$RUN_DIR/report.json" "$SIM_REPORT" "$SCENARIO" "$RUN_ID" "$RUN_DIR" "$CODE" "$MS" <<'PY'
import json, re, sys, os, tempfile
vit, out, scenario, run_id, run_dir, code, ms = sys.argv[1:]
# Only the thirteen assigned canonical IDs and the two declared SITE01.05
# substeps are reportable. Consume the entire leading token: a suffix must
# never backtrack to SITE01 or silently create another campaign ID.
idre = re.compile(r"^\s*([A-Z][A-Z0-9]*\d+(?:\.[A-Za-z0-9]+)*)(?=\s|$)")
canonical = {*(f"MAIN03.{n:02d}" for n in range(1, 6)), "MAIN04.01", "MAIN04.03", "MAIN04.04", *(f"SITE01.{n:02d}" for n in range(1, 6))}
declared = {**{k: k for k in canonical}, "SITE01.05a": "SITE01.05", "SITE01.05b": "SITE01.05"}
raw, err = {}, None
try: raw = json.load(open(vit))
except Exception as e: err = f"vitest report unreadable: {e}"
norm = {"passed": "passed", "failed": "failed"}
steps = []
seen = set()
for tr in raw.get("testResults", []):
    for a in tr.get("assertionResults", []):
        title = a.get("title", ""); full = a.get("fullName") or title
        m = idre.match(title) or idre.match(full) or next((x for x in map(idre.match, a.get("ancestorTitles", [])) if x), None)
        step_id = m.group(1) if m else None
        if step_id not in declared or step_id in seen:
            raise ValueError(f"undeclared or duplicate scenario step: {step_id}")
        seen.add(step_id)
        fm = a.get("failureMessages") or []
        steps.append({"scenarioId": declared[step_id], "declaredStepId": step_id, "step": title,
                      "status": norm.get(a.get("status"), "skipped"),
                      "durationMs": a.get("duration"),
                      "failure": (fm[0].splitlines()[0][:300] if fm else None)})
site05 = {"SITE01.05", "SITE01.05a", "SITE01.05b"}
if seen & site05 and not site05 <= seen:
    raise ValueError("SITE01.05 requires preparation, consolidation and file substeps in the report")
per = {}
for st in steps:
    k = st["scenarioId"] or "UNASSIGNED"; per.setdefault(k, []).append(st["status"])
rank = lambda l: "failed" if "failed" in l else ("skipped" if "skipped" in l else "passed")
rep = {"runId": run_id, "scenarioFile": scenario.split("/scripts/simulation/", 1)[-1],
       "runDir": run_dir, "exitCode": int(code), "wallMs": int(ms), "error": err,
       "vitest": {k: raw.get(k) for k in ("numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numTotalTestSuites", "numFailedTestSuites", "success", "startTime")},
       "steps": steps, "scenarios": {k: rank(v) for k, v in per.items()}}
# Exclusive unpredictable temporary file, then atomic no-overwrite publication.
# A racing writer or a stale original can never be replaced.
fd, tmp = tempfile.mkstemp(prefix=".track1-report-", suffix=".json", dir=os.path.dirname(out))
try:
    with os.fdopen(fd, "w") as stream:
        json.dump(rep, stream, indent=2)
    os.link(tmp, out, follow_symlinks=False)
finally:
    os.unlink(tmp)
PY
log "run $RUN_ID exit $CODE (${MS} ms) -> $RUN_DIR"
exit $CODE
