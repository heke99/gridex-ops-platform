#!/usr/bin/env bash
# No destructive fallback: existing down --processes-only is NOT full cleanup.
set -euo pipefail
printf '%s\n' 'HOLD: full exact-ID backend/network/volume/descendant cleanup is not implemented; no resources were removed' >&2
exit 78
