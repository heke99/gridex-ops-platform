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
# Harnessens eget innehåll (sha256 per fil, node_modules undantagen), scope, ren RUN_DIR och loggens hash.
HFILES="$(mktemp)"
( cd "$HARNESS_DIR" && find . -name node_modules -prune -o -type f -print | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s\t%s\n' "${f#./}" "$(sha256sum "$f" | cut -d' ' -f1)"
  done ) | jq -R -s 'split("\n") | map(select(length>0) | split("\t") | {path: .[0], sha256: .[1]})' >"$HFILES"
HCOMMIT="$(git -C "$HARNESS_DIR" rev-parse HEAD 2>/dev/null || true)"
SCOPE="$(grep -m1 -oE '^// executionScope:[[:space:]]*[A-Z_]+' "$SCEN" | sed -E 's#^// executionScope:[[:space:]]*##' || true)"
if [[ -z "$(git -C "$RUN_DIR" status --porcelain 2>/dev/null)" ]]; then RUNCLEAN=true; else RUNCLEAN=false; fi
LOGSHA="$(sha256sum "$LOGF" | cut -d' ' -f1)"
jq -n --arg started "$STARTED" --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson rc "$RC" \
  --arg app "$(git -C "$RUN_DIR" rev-parse HEAD)" --arg replay "$(cat "$SIM_HOME/replay-commit" 2>/dev/null || echo)" \
  --arg built "$(cat "$SIM_HOME/built-commit" 2>/dev/null || echo)" --arg replayAt "$(cat "$SIM_HOME/replay-at" 2>/dev/null || echo)" \
  --arg file "$REL" --arg log "$LOGF" --arg logsha "$LOGSHA" --arg scope "$SCOPE" --argjson clean "$RUNCLEAN" \
  --arg hdir "$HARNESS_DIR" --arg hcommit "$HCOMMIT" --slurpfile hfiles "$HFILES" \
  '{scenarioFile:$file, startedAt:$started, finishedAt:$finished, exitCode:$rc, appCommit:$app, replayCommit:$replay, replayAt:$replayAt, builtCommit:$built, log:$log, logSha256:$logsha,
    executionScope:(if $scope=="" then null else $scope end), runDirClean:$clean,
    harness:{dir:$hdir, gitCommitIfAny:(if $hcommit=="" then null else $hcommit end), files:$hfiles[0]}}' >"$META"
rm -f "$HFILES"
node "$HARNESS_DIR/lib/make-report.mjs" "$RAW" "$OUT" "$NAME" "$META"
sha256sum "$OUT" | cut -d' ' -f1 >"$OUT.sha256"
rm -f "$META" "$RAW"
log "rapport: $OUT (exit $RC)"
exit "$RC"
