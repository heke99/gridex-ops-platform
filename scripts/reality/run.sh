#!/usr/bin/env bash
# Runs reality scenarios against the world started by scripts/reality/up.sh.
#   bash scripts/reality/run.sh                                   # every scenario
#   bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts
#   bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts -t A1   # one step
# The scenario report (JSON) is written to $REALITY_HOME/report.json; progress is written during long steps.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${REALITY_HOME:-/tmp/gridex-reality}"
cd "$ROOT"
[ -f "$HOME_DIR/app.env" ] || { echo "run scripts/reality/up.sh first" >&2; exit 1; }
set -a; # shellcheck disable=SC1091
. "$HOME_DIR/app.env"; set +a
export GRIDEX_NATIVE_STATUS="$HOME_DIR/status.json" GRIDEX_REALITY_REPORT="$HOME_DIR/report.json"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$(ls -d /opt/pw-browsers/chromium 2>/dev/null || true)}"
export GRIDEX_REALITY_ONLY="${1:-scripts/reality/**/*.test.ts}"
shift || true
npx vitest run -c scripts/reality/reality-native.config.ts "$@"
