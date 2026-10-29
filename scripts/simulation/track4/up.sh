#!/usr/bin/env bash
# Track 4 harness: start an own local stack from the run directory's HEAD (contract: .claude/agents/sim-builder.md).
#   1. NEW replay: sources scripts/gridex-aud-003-clean-replay.sh from the run directory root (cwd = run dir; supabase/config.toml and
#      the replay script are never modified), then LOCAL_STACK_START_ATTEMPTED=0; cleanup; trap - EXIT; set -euo pipefail, so the
#      stack stays up. Aborts with "BLOCKED: stacken upptagen" when a supabase_db_ container already runs. Never `supabase start`.
#      SKIP_REPLAY=1 reuses the running stack (markers from the earlier replay must exist).
#   2. SIM_HOME/env with local keys and random secrets (never committed, never logged)
#   3. GreenMail (local SMTPS/IMAPS counterparty, local CA), automation user, `npm run build` (SKIP_BUILD=1 reuses a build of the
#      same app commit) and next start on 127.0.0.1:$T4_APP_PORT (default 3104), loopback sink for every external URL
# Markers (SIM_HOME): after a NEW replay only: fingerprint (the replay script's own EXPECTED_FINGERPRINT), replay-commit, replay-at,
# empty applied-migrations.tsv; db-url (one line) whenever the stack is up; built-commit after a successful build.
# Idempotent for app, mail and sink.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
t4_init
cd "$APP_DIR"
T4_HEAD_SHA="$(t4_head)"

command -v supabase >/dev/null || t4_die "supabase CLI not found (expected $SIM_HOME/cli/node_modules/.bin/supabase, v2.101.0)"
[ "$(supabase --version | tr -d '[:space:]')" = "2.101.0" ] || t4_die "supabase CLI must be exactly 2.101.0"
command -v psql >/dev/null || t4_die "psql missing"
command -v docker >/dev/null || t4_die "docker missing"

# ---- 1: stack ------------------------------------------------------------------------------------------
if [ "${SKIP_REPLAY:-0}" = 1 ]; then
  t4_db_ready || t4_die "SKIP_REPLAY=1 but no replayed schema on 127.0.0.1:$T4_DB_PORT"
  [ -s "$SIM_HOME/replay-commit" ] || t4_die "SKIP_REPLAY=1 but $SIM_HOME/replay-commit is missing (the stack was not replayed by this harness)"
  t4_log "reusing replayed stack (replay-commit $(cat "$SIM_HOME/replay-commit"), HEAD $T4_HEAD_SHA)"
else
  if [ -n "$(docker ps --filter name=supabase_db_ -q)" ]; then
    echo "BLOCKED: stacken upptagen ($(docker ps --filter name=supabase_db_ --format '{{.Names}}' | tr '\n' ' '))" >&2
    exit 1
  fi
  t4_log "clean migration replay (several minutes), log $LOG_DIR/replay.log"
  # The sourced script overwrites ROOT, DB_URL, MIGRATIONS, SEED, HOLD and installs its own EXIT trap: nothing below depends on those.
  # shellcheck disable=SC1091
  source scripts/gridex-aud-003-clean-replay.sh > "$LOG_DIR/replay.log" 2>&1
  T4_REPLAY_FINGERPRINT="$EXPECTED_FINGERPRINT"   # the script has already verified the schema against this value and aborts on mismatch
  LOCAL_STACK_START_ATTEMPTED=0
  cleanup
  trap - EXIT
  set -euo pipefail
  [[ "$T4_REPLAY_FINGERPRINT" =~ ^[0-9a-f]{64}$ ]] || t4_die "replay script gave no fingerprint"
  printf '%s\n' "$T4_REPLAY_FINGERPRINT" > "$SIM_HOME/fingerprint"
  printf '%s\n' "$T4_HEAD_SHA" > "$SIM_HOME/replay-commit"
  t4_now > "$SIM_HOME/replay-at"
  : > "$SIM_HOME/applied-migrations.tsv"
fi
printf '%s\n' "$T4_DBURL" > "$SIM_HOME/db-url"
chmod 600 "$SIM_HOME/db-url"

# ---- 3: env ----------------------------------------------------------------------------------------
if [ -d "$ENV_FILE" ]; then mv "$ENV_FILE" "$ENV_FILE.dir.$(date +%s)"; t4_log "moved aside a directory named env"; fi
STATUS_ENV="$SIM_HOME/status.env"
supabase status -o env > "$STATUS_ENV" 2>/dev/null || t4_die "supabase status failed (is the stack running?)"
chmod 600 "$STATUS_ENV"
t4_tls_prepare
python3 - "$STATUS_ENV" "$ENV_FILE" "$T4_API_PORT" "$T4_DB_PORT" "$T4_APP_PORT" "$T4_SINK_PORT" "$T4_HEAD_SHA" "$TLS_DIR" "$T4_SMTPS_PORT" "$T4_IMAPS_PORT" "$T4_MAIL_API_PORT" <<'PY'
import os, pathlib, secrets, sys, uuid
status_path, env_path, api, db, app, sink, head, tls, smtps, imaps, mailapi = sys.argv[1:]
status = {}
for line in pathlib.Path(status_path).read_text().splitlines():
    if '=' in line:
        k, v = line.split('=', 1); status[k] = v.strip().strip('"')
if status.get('API_URL') != f'http://127.0.0.1:{api}':
    raise SystemExit(f'T4 stack must be local on port {api}, got {status.get("API_URL")}')
cur = {}
p = pathlib.Path(env_path)
if p.exists():
    for line in p.read_text().splitlines():
        if '=' in line:
            k, v = line.split('=', 1); cur[k] = v
auto = cur.get('GRIDEX_AUTOMATION_USER_ID') or str(uuid.uuid4())
cron = cur.get('CRON_SECRET') or secrets.token_hex(24)
sinkurl = f'http://127.0.0.1:{sink}'
env = {
  'NEXT_PUBLIC_SUPABASE_URL': status['API_URL'], 'NEXT_PUBLIC_SUPABASE_ANON_KEY': status['ANON_KEY'],
  'SUPABASE_SERVICE_ROLE_KEY': status['SERVICE_ROLE_KEY'],
  'CRON_SECRET': cron, 'EDIEL_INBOUND_CRON_SECRET': cron,
  'WEBSITE_OFFER_REFERENCE_SECRET': cur.get('WEBSITE_OFFER_REFERENCE_SECRET') or secrets.token_hex(24),
  'GRIDEX_AUTOMATION_USER_ID': auto, 'EDIEL_AUTOMATION_ACTOR_USER_ID': auto,
  'NEXT_PUBLIC_SITE_URL': f'http://127.0.0.1:{app}', 'NEXT_TELEMETRY_DISABLED': '1',
  'GIT_COMMIT_SHA': head,
  # Every third party is the local sink; nothing leaves the machine.
  'ELPRISETJUSTNU_BASE_URL': sinkurl, 'RESEND_BASE_URL': sinkurl, 'RESEND_API_KEY': 're_t4_sink',
  'PAPILITE_GEOCODE_URL': sinkurl + '/papapi/lite/', 'PAPILITE_API_KEY': 't4-sink',
  'LANTMATERIET_BELAGENHETSADRESS_BASE_URL': sinkurl + '/lantmateriet',
  'LANTMATERIET_BELAGENHETSADRESS_USERNAME': 't4', 'LANTMATERIET_BELAGENHETSADRESS_PASSWORD': 't4',
  # Harness-only (read by run.sh / runner, ignored by the app).
  'T4_DB_URL': f'postgresql://postgres:postgres@127.0.0.1:{db}/postgres',
  'T4_APP_URL': f'http://127.0.0.1:{app}', 'T4_SINK_URL': sinkurl,
}
# ---- mail counterparty (GreenMail) and Ediel mailboxes, TEST lane. Origin of the key set: claude/gifted-hamilton-vss1hj
# @ 2711f862 scripts/reality/up.sh step 3 (app environment); ports and lane are T4's.
test_box, prod_box = 'gridex-ediel-test@example.invalid', 'gridex-ediel@example.invalid'
test_pw = cur.get('GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS') or secrets.token_hex(12)
prod_pw = cur.get('GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS') or secrets.token_hex(12)
env.update({
  # The one Ediel SMTP account is the test lane's mailbox (SMTP and IMAP password must match: GreenMail pins it at first login).
  'EDIEL_SMTP_HOST': 'localhost', 'EDIEL_SMTP_PORT': smtps, 'EDIEL_SMTP_SECURE': 'true',
  'EDIEL_SMTP_USER': test_box, 'EDIEL_SMTP_PASS': test_pw, 'EDIEL_SMTP_FROM': test_box,
  'GRIDEX_SHARED_EDIEL_TEST_EMAIL': test_box, 'GRIDEX_SHARED_EDIEL_TEST_IMAP_HOST': 'localhost', 'GRIDEX_SHARED_EDIEL_TEST_IMAP_PORT': imaps,
  'GRIDEX_SHARED_EDIEL_TEST_IMAP_SECURE': 'true', 'GRIDEX_SHARED_EDIEL_TEST_IMAP_USERNAME': test_box, 'GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS': test_pw,
  'GRIDEX_SHARED_EDIEL_TEST_SMTP_HOST': 'localhost', 'GRIDEX_SHARED_EDIEL_TEST_SMTP_PORT': smtps, 'GRIDEX_SHARED_EDIEL_TEST_SMTP_FROM': test_box,
  'GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL': prod_box, 'GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS': prod_pw,
  'GRIDEX_MANUAL_OPERATIONS_MAILBOX_PASS': test_pw,
  'NODE_EXTRA_CA_CERTS': f'{tls}/combined-ca.pem',
  # harness-only
  'T4_SMTPS_PORT': smtps, 'T4_IMAPS_PORT': imaps, 'T4_MAIL_API_PORT': mailapi, 'T4_PROJECT_ID': os.environ['T4_PROJECT_ID'],
  'GRIDEX_LIVE_APP_URL': f'http://127.0.0.1:{app}',
})
p.write_text(''.join(f'{k}={v}\n' for k, v in env.items()))
p.chmod(0o600)
PY
t4_load_env
t4_assert_local
t4_mail_up
t4_mail_claim

# ---- 4: automation user, build, app ----------------------------------------------------------------
# Origin of the user-creation pattern: claude/gifted-hamilton-vss1hj 2711f862:scripts/reality/up.sh (step 4).
AUTH=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
if ! curl -sf "${AUTH[@]}" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users/$GRIDEX_AUTOMATION_USER_ID" >/dev/null; then
  curl -sf "${AUTH[@]}" -H 'content-type: application/json' -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
    -d "{\"id\":\"$GRIDEX_AUTOMATION_USER_ID\",\"email\":\"t4-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid\",\"email_confirm\":true}" >/dev/null
fi
psql "$T4_DBURL" -X -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.user_profiles(id,email,full_name,user_status)
VALUES('$GRIDEX_AUTOMATION_USER_ID','t4-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid','T4 automation','active')
ON CONFLICT (id) DO UPDATE SET user_status='active';
SQL

BUILT="$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)"
if [ "${SKIP_BUILD:-0}" = 1 ] && t4_same_app "$BUILT" && [ -s "$APP_DIR/.next/BUILD_ID" ]; then
  t4_log "reusing build of $BUILT"
else
  t4_log "npm run build (log $LOG_DIR/next-build.log)"
  rm -f "$SIM_HOME/built-commit" "$APP_DIR/.next/BUILD_ID"
  ( cd "$APP_DIR" && npm run -s build ) > "$LOG_DIR/next-build.log" 2>&1 || true
  [ -s "$APP_DIR/.next/BUILD_ID" ] || t4_die "build failed, see $LOG_DIR/next-build.log"
  echo "$T4_HEAD_SHA" > "$SIM_HOME/built-commit"
fi

# sink first (the app's env points to it)
if ! t4_pid_alive "$PID_DIR/sink.pid"; then
  : > "$LOG_DIR/sink-requests.jsonl"
  T4_SINK_PORT="$T4_SINK_PORT" T4_SINK_LOG="$LOG_DIR/sink-requests.jsonl" \
    setsid nohup node "$T4_DIR/counterparties/sink.mjs" > "$LOG_DIR/sink.log" 2>&1 < /dev/null &
  echo $! > "$PID_DIR/sink.pid"
  t4_wait_port "$T4_SINK_PORT" 15 || t4_die "sink did not open port $T4_SINK_PORT"
fi

ENV_SHA="$(sha256sum "$ENV_FILE" | cut -d' ' -f1)"
if t4_pid_alive "$PID_DIR/app.pid" && t4_same_app "$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)" && [ "$(cat "$SIM_HOME/app-env.sha" 2>/dev/null || true)" = "$ENV_SHA" ]; then
  t4_log "app already running (pid $(cat "$PID_DIR/app.pid"))"
else
  if t4_pid_alive "$PID_DIR/app.pid"; then kill "$(cat "$PID_DIR/app.pid")" 2>/dev/null || true; sleep 1; fi
  if t4_port_open "$T4_APP_PORT"; then t4_die "port $T4_APP_PORT is taken by a process T4 did not start"; fi
  t4_log "next start on 127.0.0.1:$T4_APP_PORT"
  ( cd "$APP_DIR" && exec setsid nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$T4_APP_PORT" \
      > "$LOG_DIR/next-start.log" 2>&1 < /dev/null ) &
  echo $! > "$PID_DIR/app.pid"
  echo "$ENV_SHA" > "$SIM_HOME/app-env.sha"
  up=0
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$T4_APP_PORT/login" 2>/dev/null)" = 200 ] && { up=1; break; }
    sleep 2
  done
  [ "$up" = 1 ] || t4_die "app did not answer 200 on /login, see $LOG_DIR/next-start.log"
fi
t4_log "ready: app http://127.0.0.1:$T4_APP_PORT, api $NEXT_PUBLIC_SUPABASE_URL, db :$T4_DB_PORT, SIM_HOME=$SIM_HOME"
