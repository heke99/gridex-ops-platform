#!/usr/bin/env bash
# Spår 3: kör en eller flera scenariofiler mot den lokala kedjan.
#   run.sh <scenariofil...>      (sökväg relativt spårkatalogen, repo-roten eller absolut)
# Skriver SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json} samt runs/<run-id>/summary.json.
# Vägrar starta om en annan körning pågår (flock på SIM_HOME/run.lock).
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
(( $# )) || t3_die "användning: run.sh <scenariofil...>"
[[ -n "${SIM_REPORT:-}" && "$SIM_REPORT" == /* ]] || t3_die "SIM_REPORT måste vara en absolut privat rapportsökväg"
T3_REQUESTED_REPORT="$SIM_REPORT"
# Kontrollera den verkliga målsökvägen innan lås, nätanrop eller Vitest.
T3_REPORT_PATH="$(python3 - "$SIM_REPORT" <<'PY'
from pathlib import Path
import subprocess
import sys

target = Path(sys.argv[1])
if target.is_symlink() or (target.exists() and not target.is_file()):
    sys.exit('SIM_REPORT måste vara en vanlig fil, inte en länk eller katalog')
target = target.resolve()
parent = target.parent
while not parent.exists():
    parent = parent.parent
if not parent.is_dir():
    sys.exit('SIM_REPORT har ingen giltig föräldrakatalog')
for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
    result = subprocess.run(['git', '-C', str(parent), 'rev-parse', flag], capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip() == 'true':
        sys.exit('SIM_REPORT måste ligga utanför Git-arbetsytor och Git-metadata')
print(target)
PY
)" || t3_die "ogiltig SIM_REPORT"
umask 077
t3_admit run
t3_load_env
[[ "${SIM_REPORT:-}" == "$T3_REQUESTED_REPORT" ]] || t3_die "miljön ändrade SIM_REPORT; körningen startas inte"

mkdir -p "$SIM_HOME/runs"
t3_lock

mkdir -p -- "$(dirname "$T3_REPORT_PATH")" || t3_die "kunde inte skapa rapportkatalogen"
REPO_ROOT="$(cd "$T3_DIR/../../.." && pwd)"
resolve_scenario() {
  local a="$1" c
  for c in "$a" "$T3_DIR/$a" "$REPO_ROOT/$a"; do
    [[ -f "$c" ]] || continue
    c="$(realpath "$c")"
    [[ "$c" == "$T3_DIR/scenarios/"*.test.ts && "$c" != *$'\n'* ]] || return 1
    printf '%s\n' "$c"; return 0
  done
  return 1
}

# Förkontroll: appen och mailmotparten måste svara (annars är resultatet harnessfel, inte scenariofel).
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$T3_APP_PORT/" 2>/dev/null || t3_die "appen svarar inte på :$T3_APP_PORT (kör up.sh)"
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$T3_CONTROL_PORT/health" 2>/dev/null || t3_die "mailmotparten svarar inte på :$T3_CONTROL_PORT (kör up.sh)"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
RUN_ROOT="$SIM_HOME/runs/$RUN_ID"
mkdir -p "$RUN_ROOT"
node "$T3_DIR/lib/seed-cli.mjs" --run-identity > "$RUN_ROOT/run-identity.json" || t3_die "kunde inte binda köridentiteten"
t3_log "run-id $RUN_ID"
overall=0
declare -a SUMMARY_ITEMS=()
VITEST_BIN="$RUN_DIR/node_modules/vitest/vitest.mjs"
for arg in "$@"; do
  if ! file="$(resolve_scenario "$arg")"; then t3_log "scenariofil saknas: $arg" >&2; (( overall != 0 )) || overall=2; continue; fi
  rel="${file#"$T3_DIR"/}"
  name="$(basename "$file" .test.ts)"
  dir="$RUN_ROOT/$name"; mkdir -p "$dir"
  started="$(t3_utc)"
  t3_log "kör $rel"
  (
    export T3_RUN_ID="$RUN_ID" T3_SCENARIO="$name" T3_EVIDENCE_DIR="$SIM_HOME/evidence/$RUN_ID/$name" T3_REPORT_DIR="$dir"
    mkdir -p "$T3_EVIDENCE_DIR"
    cd "$T3_DIR"
    t3_admit run
    "${T3_EXEC_ENV[@]}" "T3_RUN_ID=$RUN_ID" "T3_SCENARIO=$name" "T3_EVIDENCE_DIR=$T3_EVIDENCE_DIR" "T3_REPORT_DIR=$dir" \
      node "$VITEST_BIN" run --config "$T3_DIR/vitest.config.ts" --reporter=default --reporter=json \
      --outputFile.json="$dir/vitest.json" "$rel"
  ) >"$dir/log.txt" 2>&1
  code=$?
  (( code == 0 || overall != 0 )) || overall="$code"
  ended="$(t3_utc)"
  node "$T3_DIR/lib/make-report.mjs" --scenario "$name" --file "$rel" --run-id "$RUN_ID" --exit "$code" \
    --started "$started" --ended "$ended" --vitest "$dir/vitest.json" --log "$dir/log.txt" \
    --evidence "$SIM_HOME/evidence/$RUN_ID/$name" --identity "$RUN_ROOT/run-identity.json" --out "$dir/report.json" || {
      t3_log "make-report misslyckades" >&2
      (( overall != 0 )) || overall=1
    }
  t3_log "$name: exit $code -> $dir/report.json"
  SUMMARY_ITEMS+=("{\"scenario\":\"$name\",\"exit\":$code,\"report\":\"$dir/report.json\"}")
done
printf '{"runId":"%s","exit":%s,"scenarios":[%s]}\n' "$RUN_ID" "$overall" "$(IFS=,; echo "${SUMMARY_ITEMS[*]:-}")" > "$RUN_ROOT/summary.json" || t3_die "kunde inte skriva summary.json"
node "$T3_DIR/lib/make-report.mjs" --summary "$RUN_ROOT/summary.json" --out "$T3_REPORT_PATH" || t3_die "kunde inte skriva SIM_REPORT"
echo "$RUN_ROOT"
exit "$overall"
