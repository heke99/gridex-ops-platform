#!/usr/bin/env bash
# Spår 3: kör en eller flera scenariofiler mot den lokala kedjan.
#   run.sh <scenariofil...>      (sökväg relativt spårkatalogen, repo-roten eller absolut)
# Skriver SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json} samt runs/<run-id>/summary.json.
# Vägrar starta om en annan körning pågår (flock på SIM_HOME/run.lock).
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
(( $# )) || t3_die "användning: run.sh <scenariofil...>"

mkdir -p "$SIM_HOME/runs"
exec 9>"$SIM_HOME/run.lock"
if ! flock -n 9; then t3_die "en annan körning pågår (lås: $SIM_HOME/run.lock)"; fi

t3_load_env
REPO_ROOT="$(cd "$T3_DIR/../../.." && pwd)"
resolve_scenario() {
  local a="$1" c
  for c in "$a" "$T3_DIR/$a" "$REPO_ROOT/$a" "$RUN_DIR/$a"; do
    [[ -f "$c" ]] && { realpath "$c"; return 0; }
  done
  return 1
}

# Förkontroll: appen och mailmotparten måste svara (annars är resultatet harnessfel, inte scenariofel).
curl -sS -m 5 -o /dev/null "http://127.0.0.1:$T3_APP_PORT/" 2>/dev/null || t3_die "appen svarar inte på :$T3_APP_PORT (kör up.sh)"
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$T3_CONTROL_PORT/health" 2>/dev/null || t3_die "mailmotparten svarar inte på :$T3_CONTROL_PORT (kör up.sh)"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
RUN_ROOT="$SIM_HOME/runs/$RUN_ID"
mkdir -p "$RUN_ROOT"
t3_log "run-id $RUN_ID"
overall=0
declare -a SUMMARY_ITEMS=()
VITEST_BIN="$RUN_DIR/node_modules/vitest/vitest.mjs"
for arg in "$@"; do
  if ! file="$(resolve_scenario "$arg")"; then t3_log "scenariofil saknas: $arg" >&2; overall=2; continue; fi
  rel="${file#"$T3_DIR"/}"
  name="$(basename "$file" .test.ts)"
  dir="$RUN_ROOT/$name"; mkdir -p "$dir"
  started="$(t3_utc)"
  t3_log "kör $rel"
  (
    export T3_RUN_ID="$RUN_ID" T3_SCENARIO="$name" T3_EVIDENCE_DIR="$SIM_HOME/evidence/$RUN_ID/$name" T3_REPORT_DIR="$dir"
    mkdir -p "$T3_EVIDENCE_DIR"
    cd "$T3_DIR"
    node "$VITEST_BIN" run --config "$T3_DIR/vitest.config.ts" --reporter=default --reporter=json \
      --outputFile.json="$dir/vitest.json" "$rel"
  ) >"$dir/log.txt" 2>&1
  code=$?
  ended="$(t3_utc)"
  node "$T3_DIR/lib/make-report.mjs" --scenario "$name" --file "$rel" --run-id "$RUN_ID" --exit "$code" \
    --started "$started" --ended "$ended" --vitest "$dir/vitest.json" --log "$dir/log.txt" \
    --evidence "$SIM_HOME/evidence/$RUN_ID/$name" --out "$dir/report.json" || t3_log "make-report misslyckades" >&2
  t3_log "$name: exit $code -> $dir/report.json"
  (( code == 0 )) || overall=1
  SUMMARY_ITEMS+=("{\"scenario\":\"$name\",\"exit\":$code,\"report\":\"$dir/report.json\"}")
done
printf '{"runId":"%s","exit":%s,"scenarios":[%s]}\n' "$RUN_ID" "$overall" "$(IFS=,; echo "${SUMMARY_ITEMS[*]:-}")" > "$RUN_ROOT/summary.json"
echo "$RUN_ROOT"
exit "$overall"
