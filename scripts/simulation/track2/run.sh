#!/usr/bin/env bash
# Kör en scenariofil mot stacken: run.sh <scenarios/xxx.test.ts>
# Rapport: SIM_HOME/reports/<namn>-<utc>.json, logg: SIM_HOME/logs/run-<namn>-<utc>.log
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[[ $# -eq 1 ]] || die "användning: run.sh <scenariofil>"
SCEN="$1"
[[ -f "$SCEN" ]] || SCEN="$HARNESS_DIR/$1"
[[ -f "$SCEN" ]] || die "scenariofil saknas: $1"
SCEN="$(cd "$(dirname "$SCEN")" && pwd)/$(basename "$SCEN")"
[[ "$SCEN" == "$HARNESS_DIR"/* ]] || die "scenariofilen måste ligga under $HARNESS_DIR"
REL="${SCEN#"$HARNESS_DIR"/}"
[[ -f "$SIM_HOME/app.env" ]] || die "app.env saknas; kör up.sh först"
[[ -x "$RUN_DIR/node_modules/.bin/vitest" ]] || die "RUN_DIR/node_modules/.bin/vitest saknas"

# Lås: en körning i taget. Gammal lås (död pid) rensas.
LOCK="$SIM_HOME/run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  other="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$other" ]] && kill -0 "$other" 2>/dev/null; then
    die "annan körning pågår (pid $other, $(cat "$LOCK/scenario" 2>/dev/null)); vägrar starta"
  fi
  log "rensar gammal lås (pid ${other:-okänd} finns inte)"; rm -rf "$LOCK"; mkdir "$LOCK" || die "kunde inte ta lås"
fi
echo $$ >"$LOCK/pid"; echo "$REL" >"$LOCK/scenario"
trap 'rm -rf "$LOCK"' EXIT

ensure_node_modules
NAME="$(basename "$SCEN" .test.ts)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RAW="$SIM_HOME/reports/.${NAME}-${TS}.raw.json"
OUT="$SIM_HOME/reports/${NAME}-${TS}.json"
LOGF="$SIM_HOME/logs/run-${NAME}-${TS}.log"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

(
  cd "$HARNESS_DIR" && set -a && . "$SIM_HOME/app.env" && set +a
  export SIM_HOME RUN_DIR
  exec "$RUN_DIR/node_modules/.bin/vitest" run --root "$HARNESS_DIR" --config "$HARNESS_DIR/vitest.config.ts" \
    --reporter=default --reporter=json --outputFile.json="$RAW" "$REL"
) >"$LOGF" 2>&1
RC=$?

META="$(mktemp)"
jq -n --arg started "$STARTED" --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson rc "$RC" \
  --arg app "$(git -C "$RUN_DIR" rev-parse HEAD)" --arg replay "$(cat "$SIM_HOME/replay-commit" 2>/dev/null || echo)" \
  --arg built "$(cat "$SIM_HOME/built-commit" 2>/dev/null || echo)" --arg replayAt "$(cat "$SIM_HOME/replay-at" 2>/dev/null || echo)" \
  --arg file "$REL" --arg log "$LOGF" \
  '{scenarioFile:$file, startedAt:$started, finishedAt:$finished, exitCode:$rc, appCommit:$app, replayCommit:$replay, replayAt:$replayAt, builtCommit:$built, log:$log}' >"$META"
node "$HARNESS_DIR/lib/make-report.mjs" "$RAW" "$OUT" "$NAME" "$META"
rm -f "$META" "$RAW"
log "rapport: $OUT (exit $RC)"
exit "$RC"
