#!/usr/bin/env bash
# Stop only receipt-bound T6 app/mail resources. Backend/retention remain coordinator-owned.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
(( $# == 0 )) || t6_die '--stack/--purge require separate backend/retention admission; no cleanup performed'
t6_admit down
t6_lock
node "$T6_DIR/lib/seed-cli.mjs" --cleanup
t6_log 'owned app/mail cleanup verified; backend and all original evidence preserved'
