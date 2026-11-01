#!/usr/bin/env bash
# All actual replay/build logs remain private; failure emits only a fixed code.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# == 1 && "$1" == --observe-host ]]; then
  exec python3 -B "$HERE/qualify-runtime.py" --observe-host
fi
[[ $# == 1 && "$1" == --execute ]] || {
  echo 'HOLD: explicit signed runtime admission required' >&2
  exit 78
}
# Assignment authentication occurs before private directory/resource creation.
exec python3 -B "$HERE/qualify-runtime.py" --operation execute
