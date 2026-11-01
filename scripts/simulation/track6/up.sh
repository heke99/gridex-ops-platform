#!/usr/bin/env bash
# Start assigned T6 app/mail resources using coordinator-qualified replay/build inputs.
# Backend provisioning, package/image download and build are the qualified producer's job.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
requested_mode=''
while (( $# )); do
  case "$1" in
    --mode) requested_mode="${2:-}"; (( $# >= 2 )) || t6_die 'missing mode'; shift 2 ;;
    --mode=*) requested_mode="${1#--mode=}"; shift ;;
    *) t6_die "unknown argument" ;;
  esac
done
t6_admit up
t6_load_env
[[ -z "$requested_mode" || "$requested_mode" == "$T6_MODE" ]] || t6_die 'mode differs from assigned environment'
t6_lock
node "$T6_DIR/lib/seed-cli.mjs" --prepare-paths
for receipt in "$PID_DIR/app-process.json" "$PID_DIR/app.pid" "$PID_DIR/counterparty-process.json" "$PID_DIR/counterparty.pid" "$PID_DIR/greenmail-container.json" "$PID_DIR/greenmail.pending-id" "$SIM_HOME/fixture.json" "$SIM_HOME/runtime-ready.json"; do
  [[ ! -e "$receipt" && ! -L "$receipt" ]] || t6_die 'previous runtime receipt exists; preserve it and use coordinator recovery'
done
mail_name="$(node "$T6_DIR/lib/seed-cli.mjs" --resource greenmailName up)"
mail_image="$(node "$T6_DIR/lib/seed-cli.mjs" --resource greenmailImage up)"
if docker inspect --type container --format '{{.Id}}' "$mail_name" >/dev/null 2>&1; then
  t6_die 'assigned mail container name already occupied'
fi
# No pull or replacement of an existing container; the coordinator preloads this exact digest.
mail_id="$(docker run --pull=never -d --name "$mail_name" --label "sim.environment=${mail_name%-greenmail}" --label sim.worker=codex-track6 \
  -p "127.0.0.1:${T6_IMAP_PLAIN_PORT}:3143" \
  -e "GREENMAIL_OPTS=-Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=${T6_IMAP_USER}:${T6_IMAP_PASS}@t6.sim.invalid" "$mail_image")"
printf '%s\n' "$mail_id" > "$PID_DIR/greenmail.pending-id"
node "$T6_DIR/lib/seed-cli.mjs" --record-greenmail "$mail_id"
(
  cd "$T6_DIR"
  exec setsid "${T6_EXEC_ENV[@]}" "T6_SMTP_USER=$T6_MAILBOX_ADDRESS" "$T6_NODE_BIN" "$T6_DIR/counterparty/mail-counterparty.mjs"
) > "$LOG_DIR/counterparty.log" 2>&1 < /dev/null &
counterparty_pid=$!
printf '%s\n' "$counterparty_pid" > "$PID_DIR/counterparty.pid"
node "$T6_DIR/lib/seed-cli.mjs" --record-process counterparty "$counterparty_pid"
t6_wait_for 'assigned mail control endpoint' 30 curl -fsS -m 3 "http://127.0.0.1:$T6_CONTROL_PORT/health"
# Rechecks prepared source/build/schema and every endpoint immediately before fixture writes.
"${T6_EXEC_ENV[@]}" node "$T6_DIR/lib/seed-cli.mjs" --mode "$T6_MODE" --out "$SIM_HOME/fixture.json"
node "$T6_DIR/lib/seed-cli.mjs" --apply-fixture
t6_load_env
(
  cd "$RUN_DIR"
  exec setsid "${T6_EXEC_ENV[@]}" "$T6_NODE_BIN" "$RUN_DIR/node_modules/next/dist/bin/next" start -p "$T6_APP_PORT" -H 127.0.0.1
) > "$LOG_DIR/app.log" 2>&1 < /dev/null &
app_pid=$!
printf '%s\n' "$app_pid" > "$PID_DIR/app.pid"
node "$T6_DIR/lib/seed-cli.mjs" --record-process app "$app_pid"
t6_wait_for 'assigned app endpoint' 120 curl -sS -m 5 -o /dev/null "http://127.0.0.1:$T6_APP_PORT/"
node "$T6_DIR/lib/seed-cli.mjs" --ready
t6_log 'assigned app/mail ready; qualified backend preserved under coordinator ownership'
