#!/usr/bin/env bash
# Endast registrerade processer; backend/volymer behöver separat admission.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
[[ $# == 1 && "$1" == --processes-only ]] || die "backend-/volymcleanup saknar kvalificerad tilldelning; endast --processes-only är tillåtet"
LOCK="$SIM_HOME/run.lock"
mkdir "$LOCK" 2>/dev/null || die "run.lock finns; samordnaren måste avstämma kvarlämnad låsning"
printf '%s\n' "$$" > "$LOCK/pid"
trap 'if [[ "$(cat "$LOCK/pid" 2>/dev/null)" == "$$" ]]; then rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true; fi' EXIT
t2_process_custody stop
