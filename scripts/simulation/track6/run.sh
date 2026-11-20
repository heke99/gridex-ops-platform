#!/usr/bin/env bash
# Run only assigned T6 scenarios; preserve raw reports privately without overwriting originals.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
(( $# )) || t6_die 'usage: run.sh <scenario-file...>'
t6_admit run
t6_load_env
t6_lock
[[ -z "$(git -C "$T6_DIR" status --porcelain -- "$T6_DIR")" ]] || t6_die 'harness checkout is dirty'
resolve_scenario() {
  local arg="$1" candidate file
  for candidate in "$arg" "$T6_DIR/$arg"; do
    [[ -f "$candidate" ]] || continue
    file="$(realpath "$candidate")"
    [[ "$file" == "$T6_DIR/scenarios/"*.test.ts && "$file" != *$'\n'* ]] || return 1
    printf '%s\n' "$file"; return
  done
  return 1
}
declare -a FILES=()
for arg in "$@"; do
  file="$(resolve_scenario "$arg")" || t6_die 'scenario must name an owned T6 scenarios/*.test.ts file'
  [[ " ${FILES[*]:-} " != *" $file "* ]] || t6_die 'duplicate scenario'
  FILES+=("$file")
done
curl -sS -m 5 -o /dev/null "$T6_APP_URL/" || t6_die 'assigned app is not responding'
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$T6_CONTROL_PORT/health" || t6_die 'assigned mail control is not responding'
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
RUN_ROOT="$SIM_HOME/runs/$RUN_ID"
mkdir "$RUN_ROOT"
node "$T6_DIR/lib/seed-cli.mjs" --run-identity > "$RUN_ROOT/run-identity.json"
overall=0
for file in "${FILES[@]}"; do
  name="$(basename "$file" .test.ts)"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || t6_die 'invalid scenario name'
  dir="$RUN_ROOT/$name"; mkdir "$dir"
  evidence="$SIM_HOME/evidence/$RUN_ID/$name"; mkdir -p "$evidence"
  started="$(t6_utc)"
  set +e
  (
    cd "$T6_DIR"
    "${T6_EXEC_ENV[@]}" "T6_RUN_ID=$RUN_ID" "T6_SCENARIO=$name" "T6_EVIDENCE_DIR=$evidence" "T6_REPORT_DIR=$dir" \
      node "$RUN_DIR/node_modules/vitest/vitest.mjs" run --config "$T6_DIR/vitest.config.ts" --reporter=default --reporter=json \
      --outputFile.json="$dir/vitest.json" "${file#"$T6_DIR"/}"
  ) > "$dir/log.txt" 2>&1
  code=$?
  set -e
  node "$T6_DIR/lib/make-report.mjs" --scenario "$name" --file "${file#"$T6_DIR"/}" --run-id "$RUN_ID" --exit "$code" \
    --started "$started" --ended "$(t6_utc)" --vitest "$dir/vitest.json" --log "$dir/log.txt" \
    --evidence "$evidence" --identity "$RUN_ROOT/run-identity.json" --out "$dir/report.json" || overall=2
  (( code == 0 )) || { (( overall == 2 )) || overall=1; }
done
node "$T6_DIR/lib/make-report.mjs" --merge "$RUN_ROOT" --run-id "$RUN_ID" --exit "$overall" --out "$SIM_REPORT" || overall=2
t6_log "run $RUN_ID exit $overall"
exit "$overall"
