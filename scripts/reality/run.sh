#!/usr/bin/env bash
# Runs reality scenarios against the world started by scripts/reality/up.sh.
#   bash scripts/reality/run.sh                                   # every scenario
#   bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts
#   bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts -t A1   # one step
# The scenario report (JSON) is written to $GRIDEX_REALITY_REPORT, default $REALITY_HOME/report.json; progress is
# written during long steps.
# Fast mode (scripts/helpers/reality/clock.ts): GRIDEX_REALITY_TICK_MS=3000 compresses the condition-polling loops
# (default 60000 = one look a minute). Wall-clock waits the product depends on are never compressed.
# Several scenarios at once: scripts/reality/run-many.sh (it knows which scenarios may share the world).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${REALITY_HOME:-/tmp/gridex-reality}"
cd "$ROOT"
[ -f "$HOME_DIR/app.env" ] || { echo "run scripts/reality/up.sh first" >&2; exit 1; }
set -a; # shellcheck disable=SC1091
. "$HOME_DIR/app.env"; set +a
export GRIDEX_NATIVE_STATUS="$HOME_DIR/status.json" GRIDEX_REALITY_REPORT="${GRIDEX_REALITY_REPORT:-$HOME_DIR/report.json}"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$(ls -d /opt/pw-browsers/chromium 2>/dev/null || true)}"
# Scenario simulators run detached and are only stopped by the scenario itself; a killed run leaves them polling the
# same counterparty mailbox, where they take the next run's messages. Stop every leftover before a run starts.
# That cleanup would also kill the simulators of a run that is still going (from any worktree), so refuse to start
# while one is; run-many.sh starts its scenarios with GRIDEX_REALITY_SKIP_CLEANUP=1 after doing the check once.
if [ "${GRIDEX_REALITY_SKIP_CLEANUP:-0}" != 1 ]; then
  if pgrep -f "reality-native[.]config[.]ts" >/dev/null 2>&1; then
    echo "another reality run is in progress (vitest with reality-native.config.ts):" >&2
    pgrep -af "reality-native[.]config[.]ts" >&2 || true
    echo "refusing to start: the simulator cleanup below would kill its counterparties. Wait for it or stop it first." >&2
    exit 1
  fi
  pkill -f "scripts/reality/simulators/(gridOwner[A-Za-z]*|mailFaults)[.]ts" 2>/dev/null || true
  sleep 1
fi
export GRIDEX_REALITY_ONLY="${1:-scripts/reality/**/*.test.ts}"
shift || true
npx vitest run -c scripts/reality/reality-native.config.ts "$@"
