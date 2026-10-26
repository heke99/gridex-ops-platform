#!/usr/bin/env bash
# Runs several reality scenarios against one world, concurrently where that is safe, each with its own report and log.
#   bash scripts/reality/run-many.sh all
#   bash scripts/reality/run-many.sh scripts/reality/chain-e-ediel-routing.test.ts scripts/reality/chain-g-dst.test.ts
#   GRIDEX_REALITY_TICK_MS=3000 bash scripts/reality/run-many.sh all          # fast mode (scripts/helpers/reality/clock.ts)
#
# Which scenarios may share the world at the same time (evidence in the comments; any scenario not listed is refused):
#
#  lane "als" (serial): A D F G H I J1 J2 J4 K. All but D go live in ALS through goLiveAlsSupplier and start a grid-owner
#    simulator on the one rewritten mailbox ediel-16700@example.invalid (scripts/helpers/reality/goLiveAls.ts:76; I and J1
#    start their own on the same mailbox). Every simulator reads all unseen mail there and marks it \Seen
#    (scripts/reality/simulators/gridOwner.ts poll()), so two at once take each other's Z03/Z01 and answer with the wrong
#    profile. They (and D) also re-import the platform actor registry, verify the shared platform grid owner 16700, and
#    write the external world's address/geocode book (127.0.0.1:3901 /__sim/address, /__sim/geocode), all global state.
#  lane "free" (serial, beside "als"): E, stuck-detector, grid-owner-wire. E uses configureTenant tenants with their own
#    grid-owner identities and mailboxes (scripts/helpers/live-chain-fixture.ts configureTenant), starts no simulator
#    process and touches neither 3901, 3902 nor the actor registry. The other two are a rolled-back transaction and a
#    pure wire test.
#  alone: C (fault injection on the shared external world 3901: spot/papapi/lantmateriet hang for every tenant; C1/C2b
#    count gateway round trips from the global Kong log and C4 bursts the rate limit) and J3 (mail faults on the shared
#    test platform mailbox and asserts that mailbox's lock/error state; J3-6 can pause GreenMail). These run first, one
#    at a time, with nothing else.
#
# Shared by every lane, and safe by product design: the platform's shared Ediel mailboxes (the inbound cron claims a
# mailbox with locked_at and skips a locked one, lib/inbound-mail/edielMailboxPoller.part-1.ts listDueEdielMailboxes), the
# cron endpoints (each scenario's slots also process the other tenants' work, as Vercel would) and the per-SHA release
# receipt (recorded once). Concurrency does add mail to the 25-mails-per-poll budget of those mailboxes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${REALITY_HOME:-/tmp/gridex-reality}"
cd "$ROOT"
[ -f "$HOME_DIR/app.env" ] || { echo "run scripts/reality/up.sh first" >&2; exit 1; }
[ $# -gt 0 ] || { echo "usage: $0 all | <scenario test file>..." >&2; exit 2; }

ALL=(scripts/reality/chain-c-api-faults.test.ts scripts/reality/chain-j3-inbound-robustness.test.ts
  scripts/reality/chain-a-website-switch.test.ts scripts/reality/chain-d-manual-intake.test.ts scripts/reality/chain-f-invoice.test.ts
  scripts/reality/chain-g-dst.test.ts scripts/reality/chain-h-customer-leaves.test.ts scripts/reality/chain-i-grid-owner-rejects.test.ts
  scripts/reality/chain-j1-inbound-prodat.test.ts scripts/reality/chain-j2-inbound-utilts.test.ts scripts/reality/chain-j4-parse-conformance.test.ts
  scripts/reality/chain-k-statistics.test.ts scripts/reality/chain-e-ediel-routing.test.ts scripts/reality/stuck-detector.test.ts
  scripts/reality/grid-owner-wire.test.ts)
if [ "$1" = all ]; then set -- "${ALL[@]}"; fi

lane_of() {
  case "$(basename "$1")" in
    chain-c-api-faults.test.ts|chain-j3-inbound-robustness.test.ts) echo alone ;;
    chain-a-*|chain-d-*|chain-f-*|chain-g-*|chain-h-*|chain-i-*|chain-j1-*|chain-j2-*|chain-j4-*|chain-k-*) echo als ;;
    chain-e-*|stuck-detector.test.ts|grid-owner-wire.test.ts) echo free ;;
    *) echo unknown ;;
  esac
}
# E's grid-owner files are test-environment Ediel and arrive at the shared test mailbox; the product answers only from the
# mailbox a file arrived at (T8), so E needs a world started with REALITY_EDIEL_LANE=test. In a production-lane world it
# is left out with a notice instead of failing E4 (FINDINGS E-B3, T37).
WORLD_SMTP_FROM="$(sed -n 's/^EDIEL_SMTP_FROM=//p' "$HOME_DIR/app.env" 2>/dev/null | tail -1)"
ALONE=() ALS=() FREE=()
for file in "$@"; do
  [ -f "$file" ] || { echo "no such scenario: $file" >&2; exit 2; }
  case "$(basename "$file")" in chain-e-*)
    if [ "$WORLD_SMTP_FROM" != "gridex-ediel-test@example.invalid" ]; then
      echo "[run-many] skip  $(basename "$file" .test.ts): needs a world started with REALITY_EDIEL_LANE=test (T8, T37)" >&2
      continue
    fi ;;
  esac
  case "$(lane_of "$file")" in
    alone) ALONE+=("$file") ;; als) ALS+=("$file") ;; free) FREE+=("$file") ;;
    *) echo "unclassified scenario $file: add it to lane_of in $0 with the evidence for its lane" >&2; exit 2 ;;
  esac
done
if [ "${GRIDEX_REALITY_DRY_RUN:-0}" = 1 ]; then
  echo "alone (serial, first): ${ALONE[*]-}"; echo "lane als (serial):      ${ALS[*]-}"; echo "lane free (serial, beside als): ${FREE[*]-}"; exit 0
fi

# Same guard as run.sh: never clean up simulators under a run that is still going.
if pgrep -f "reality-native[.]config[.]ts" >/dev/null 2>&1; then
  echo "another reality run is in progress:" >&2; pgrep -af "reality-native[.]config[.]ts" >&2 || true; exit 1
fi
stop_simulators() { pkill -f "scripts/reality/simulators/(gridOwner[A-Za-z]*|mailFaults)[.]ts" 2>/dev/null || true; sleep 1; }
stop_simulators

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOGS="$HOME_DIR/logs"; mkdir -p "$LOGS"
RESULTS="$(mktemp -d)"
run_one() {
  local file="$1" name; name="$(basename "$file" .test.ts)"
  local report="$HOME_DIR/report-$name-$STAMP.json" log="$LOGS/run-many-$STAMP-$name.log" started=$SECONDS status=0
  echo "[run-many] start $name (report $report, log $log)"
  GRIDEX_REALITY_SKIP_CLEANUP=1 GRIDEX_REALITY_REPORT="$report" bash scripts/reality/run.sh "$file" >"$log" 2>&1 || status=$?
  echo "$status $((SECONDS - started))s $name $report $log" >>"$RESULTS/summary"
  echo "[run-many] done  $name exit=$status in $((SECONDS - started))s"
}
run_lane() {
  local lane="$1"; shift
  for file in "$@"; do
    # A scenario of the "als" lane that died without its afterAll leaves its grid-owner simulator on ediel-16700; the
    # next one would lose mail to it. Only this lane starts simulator processes, so stopping them here is safe.
    if [ "$lane" = als ]; then stop_simulators; fi
    run_one "$file"
  done
}

for file in "${ALONE[@]+"${ALONE[@]}"}"; do run_one "$file"; stop_simulators; done
pids=()
if [ ${#ALS[@]} -gt 0 ]; then run_lane als "${ALS[@]}" & pids+=($!); fi
if [ ${#FREE[@]} -gt 0 ]; then run_lane free "${FREE[@]}" & pids+=($!); fi
for pid in "${pids[@]+"${pids[@]}"}"; do wait "$pid" || true; done

echo "[run-many] summary (exit, wall time, scenario, report, log):"
sort -k3 "$RESULTS/summary" | sed 's/^/  /'
failed=$(awk '$1 != 0' "$RESULTS/summary" | wc -l)
rm -rf "$RESULTS"
[ "$failed" -eq 0 ]
