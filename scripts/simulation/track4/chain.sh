#!/usr/bin/env bash
# Build the genuine billing source (supplier, customer on a fixed-price offer, Z03/Z04 supply, UTILTS E66 for Jul-Sep 2026)
# through the product's own paths with a local grid-owner process and GreenMail. Writes SIM_HOME/chain.json.
# Takes the run lock. Slow (tens of minutes). run.sh's FX00 calls the same vitest config when no unused chain.json exists.
set -uo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
t4_init; t4_load_env; t4_assert_local
t4_lock_acquire "$@" || exit 4
t4_db_ready || { echo "T4 database not ready (run up.sh)" >&2; exit 3; }
t4_mail_running || { echo "GreenMail is not running (run up.sh)" >&2; exit 3; }
rm -f "$SIM_HOME/chain.json"
cd "$APP_DIR"
export SIM_HOME T4_CHAIN_VITEST_JSON="${T4_CHAIN_VITEST_JSON:-$SIM_HOME/chain-vitest.json}"
npx vitest run -c scripts/simulation/track4/chain/vitest.chain.config.ts
exit $?
