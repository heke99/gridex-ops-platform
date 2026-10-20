#!/usr/bin/env bash
# Stops the reality world: app, simulators, GreenMail and the local Supabase stack.
# All world data is synthetic; `REALITY_KEEP_DB=1` keeps the stack for inspection.
set -uo pipefail
for port in 3100 3901 3389 3902; do fuser -k "$port/tcp" >/dev/null 2>&1; done
docker rm -f gx-mail >/dev/null 2>&1
[ "${REALITY_KEEP_DB:-0}" = "1" ] || supabase stop --no-backup >/dev/null 2>&1
echo "[reality-down] stopped"
