#!/usr/bin/env bash
# Exact owned resources only. Unknown identity remains HOLD; no prune/fallback.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -B "$HERE/qualify-runtime.py" --operation down
