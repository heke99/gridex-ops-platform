#!/usr/bin/env bash
# Stoppa endast kvitterade processledare. Backend och nät har separat ägare.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
[[ $# == 1 && "$1" == --processes-only ]] \
  || die "endast --processes-only är kvalificerat; ingen backend-, volym- eller nätstädning utförs"
t5_acquire_runtime_lock
t5_process_custody stop
