#!/usr/bin/env bash
# Read-only host observation. Never creates an ACTIVE assignment or starts services.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ $# == 1 && "$1" == --observe-host ]] || {
  echo 'HOLD: only --observe-host is implemented; authenticated provisioning is not admitted' >&2
  exit 78
}
exec python3 "$HERE/qualify-runtime.py" --observe-host
