#!/usr/bin/env bash
# Spår 6: kör en eller flera scenariofiler mot den lokala kedjan.
#   run.sh <scenariofil...>      (sökväg relativt spårkatalogen, repo-roten eller absolut)
# Skriver SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json} samt runs/<run-id>/summary.json.
# Vägrar starta om en annan körning pågår (flock på SIM_HOME/run.lock).
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
(( $# )) || t6_die "användning: run.sh <scenariofil...>"

[[ -n "${SIM_REPORT:-}" ]] || t6_die "SIM_REPORT saknas (sökväg till JSON-rapporten)"
mkdir -p "$SIM_HOME/runs"
exec 9>>"$SIM_HOME/run.lock"
if ! flock -n 9; then t6_die "en annan körning pågår (lås: $SIM_HOME/run.lock)"; fi
# Lås med PID och starttid (kvarlämnat lås tas bara bort av sim-runner); tas bort vid avslut.
printf 'pid=%s\nstarted=%s\n' "$$" "$(t6_utc)" > "$SIM_HOME/run.lock"
trap 'rm -f "$SIM_HOME/run.lock"' EXIT

t6_load_env
export T6_SIM_HOME="$SIM_HOME"
REPO_ROOT="$(cd "$T6_DIR/../../.." && pwd)"
resolve_scenario() {
  local a="$1" c
  for c in "$a" "$T6_DIR/$a" "$REPO_ROOT/$a" "$RUN_DIR/$a"; do
    [[ -f "$c" ]] && { realpath "$c"; return 0; }
  done
  return 1
}

# Förkontroll: appen och mailmotparten måste svara (annars är resultatet harnessfel, inte scenariofel).
curl -sS -m 5 -o /dev/null "http://127.0.0.1:$T6_APP_PORT/" 2>/dev/null || t6_die "appen svarar inte på :$T6_APP_PORT (kör up.sh)"
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$T6_CONTROL_PORT/health" 2>/dev/null || t6_die "mailmotparten svarar inte på :$T6_CONTROL_PORT (kör up.sh)"

# Körkatalogens identitet: HEAD, rent träd (annars vägrar körningen), builtCommit och ändrade sökvägar sedan appbasen.
T6_APP_BASE="${T6_APP_BASE:-6454d540b6978a9c25434b8c66bcd7a0e335c99c}"
ID_HEAD="$(git -C "$RUN_DIR" rev-parse HEAD)" || t6_die "git rev-parse HEAD misslyckades i $RUN_DIR"
ID_STATUS="$(git -C "$RUN_DIR" status --porcelain)"
if [[ -n "$ID_STATUS" ]]; then
  printf 'körkatalogen %s är inte ren (git status --porcelain):\n%s\n' "$RUN_DIR" "$ID_STATUS" >&2
  t6_die "NEKAD: smutsig körkatalog, körningen startas inte"
fi
ID_BUILT="$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)"
ID_OUTSIDE="$(git -C "$RUN_DIR" diff --name-only "$T6_APP_BASE" HEAD | grep -v -e '^scripts/simulation/' -e '^quality/' || true)"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
RUN_ROOT="$SIM_HOME/runs/$RUN_ID"
mkdir -p "$RUN_ROOT"
ID_JSON="$RUN_ROOT/run-identity.json"
ID_HEAD="$ID_HEAD" ID_STATUS="$ID_STATUS" ID_BUILT="$ID_BUILT" ID_OUTSIDE="$ID_OUTSIDE" ID_BASE="$T6_APP_BASE" ID_RUN="$RUN_ID" ID_DIR="$RUN_DIR" node -e '
const e=process.env,l=v=>v?v.split("\n").filter(Boolean):[];
const o={runId:e.ID_RUN,runDir:e.ID_DIR,runDirHead:e.ID_HEAD,gitStatusPorcelain:l(e.ID_STATUS),runDirClean:l(e.ID_STATUS).length===0,
 builtCommit:e.ID_BUILT||null,appBase:e.ID_BASE,changedPathsOutsideSimulationAndQuality:l(e.ID_OUTSIDE),appCodeEqualsBase:l(e.ID_OUTSIDE).length===0};
require("fs").writeFileSync(process.argv[1],JSON.stringify(o,null,2)+"\n");' "$ID_JSON" || t6_die "kunde inte skriva run-identity.json"
t6_log "run-id $RUN_ID"
overall=0
declare -a SUMMARY_ITEMS=()
VITEST_BIN="$RUN_DIR/node_modules/vitest/vitest.mjs"
for arg in "$@"; do
  if ! file="$(resolve_scenario "$arg")"; then t6_log "scenariofil saknas: $arg" >&2; overall=2; continue; fi
  rel="${file#"$T6_DIR"/}"
  name="$(basename "$file" .test.ts)"
  dir="$RUN_ROOT/$name"; mkdir -p "$dir"
  started="$(t6_utc)"
  t6_log "kör $rel"
  (
    export T6_RUN_ID="$RUN_ID" T6_SCENARIO="$name" T6_EVIDENCE_DIR="$SIM_HOME/evidence/$RUN_ID/$name" T6_REPORT_DIR="$dir"
    mkdir -p "$T6_EVIDENCE_DIR"
    cd "$T6_DIR"
    node "$VITEST_BIN" run --config "$T6_DIR/vitest.config.ts" --reporter=default --reporter=json \
      --outputFile.json="$dir/vitest.json" "$rel"
  ) >"$dir/log.txt" 2>&1
  code=$?
  ended="$(t6_utc)"
  node "$T6_DIR/lib/make-report.mjs" --scenario "$name" --file "$rel" --run-id "$RUN_ID" --exit "$code" \
    --started "$started" --ended "$ended" --vitest "$dir/vitest.json" --log "$dir/log.txt" \
    --evidence "$SIM_HOME/evidence/$RUN_ID/$name" --out "$dir/report.json" || t6_log "make-report misslyckades" >&2
  node -e 'const fs=require("fs");const [,r,i]=process.argv;try{const j=JSON.parse(fs.readFileSync(r,"utf8"));j.runIdentity=JSON.parse(fs.readFileSync(i,"utf8"));fs.writeFileSync(r,JSON.stringify(j,null,2))}catch(e){console.error("runIdentity ej inlagd:",e.message)}' "$dir/report.json" "$ID_JSON"
  t6_log "$name: exit $code -> $dir/report.json"
  (( code == 0 )) || overall=1
  SUMMARY_ITEMS+=("{\"scenario\":\"$name\",\"exit\":$code,\"report\":\"$dir/report.json\"}")
done
printf '{"runId":"%s","exit":%s,"scenarios":[%s]}\n' "$RUN_ID" "$overall" "$(IFS=,; echo "${SUMMARY_ITEMS[*]:-}")" > "$RUN_ROOT/summary.json"
# Sammanställd rapport till SIM_REPORT: alla scenariorapporter (steg med scenario-ID, status, vitest-sammanfattning).
node -e '
const fs=require("fs");const [,sum,out]=process.argv;const s=JSON.parse(fs.readFileSync(sum,"utf8"));
const reports=s.scenarios.map(x=>{try{return JSON.parse(fs.readFileSync(x.report,"utf8"))}catch{return {scenario:x.scenario,exit:x.exit,error:"report saknas"}}});
fs.mkdirSync(require("path").dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({runId:s.runId,exit:s.exit,scenarios:reports},null,2));' "$RUN_ROOT/summary.json" "$SIM_REPORT" || t6_log "kunde inte skriva SIM_REPORT" >&2
echo "$RUN_ROOT"
exit "$overall"
