#!/usr/bin/env bash
set -uo pipefail
status=0
node quality/mechanical/verify.mjs || status=1
node quality/mechanical/verify_compensation.mjs || status=1
exit "$status"

node scripts/gridex-canonical-architecture-57-point-regression.cjs
