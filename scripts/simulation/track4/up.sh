#!/usr/bin/env bash
# Track 4 harness: start an own local stack from the run directory's HEAD.
#   1. stack-src: copy of this checkout's supabase/ + scripts/ under SIM_HOME, with T4 ports and project_id
#      patched in the COPY (tracked base files are never modified)
#   2. clean migration replay (scripts/gridex-aud-003-clean-replay.sh in the copy) into a local Supabase
#      (CLI, project gridex-sim-t4, API 55421, DB 55422). SKIP_REPLAY=1 reuses/adopts a running stack.
#   3. SIM_HOME/env with local keys and random secrets (never committed, never logged)
#   4. automation user, then `npm run build` (SKIP_BUILD=1 reuses a build of the same commit) and next start
#      on 127.0.0.1:$T4_APP_PORT (default 3104)
#   5. synthetic counterparty sink on loopback (see counterparties/sink.mjs)
# Idempotent: a running, up-to-date stack/app/sink is left alone.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
t4_init
cd "$APP_DIR"
HEAD_SHA="$(t4_head)"

command -v supabase >/dev/null || t4_die "supabase CLI not found (expected $SIM_HOME/cli/node_modules/.bin/supabase, v2.101.0)"
[ "$(supabase --version | tr -d '[:space:]')" = "2.101.0" ] || t4_die "supabase CLI must be exactly 2.101.0"
command -v psql >/dev/null || t4_die "psql missing"
command -v docker >/dev/null || t4_die "docker missing"

# ---- 1+2: stack ------------------------------------------------------------------------------------
prepare_stack_src() {
  t4_log "preparing stack-src copy (ports api=$T4_API_PORT db=$T4_DB_PORT, project $T4_PROJECT_ID)"
  rm -rf "$STACK_SRC"
  mkdir -p "$STACK_SRC"
  tar -C "$APP_DIR" --exclude='scripts/simulation' --exclude='supabase/.temp' --exclude='supabase/.branches' \
    -cf - supabase scripts | tar -C "$STACK_SRC" -xf -
  mkdir -p "$STACK_SRC/e2e-artifacts"
  python3 - "$STACK_SRC" "$T4_PROJECT_ID" "$T4_API_PORT" "$T4_DB_PORT" "$T4_SHADOW_PORT" "$T4_POOLER_PORT" "$T4_STUDIO_PORT" "$T4_MAIL_PORT" "$T4_ANALYTICS_PORT" "$LOG_DIR" <<'PY'
import pathlib, re, sys, difflib
src, project, api, db, shadow, pooler, studio, mail, analytics, logdir = sys.argv[1:]
root = pathlib.Path(src)

# config.toml: project id, ports, analytics off (same set of changes as the runner's manual stack).
cfg = root / 'supabase/config.toml'
orig = cfg.read_text()
section = None
lines = []
want = {('api', 'port'): api, ('db', 'port'): db, ('db', 'shadow_port'): shadow, ('db.pooler', 'port'): pooler,
        ('studio', 'port'): studio, ('inbucket', 'port'): mail, ('analytics', 'port'): analytics}
for line in orig.splitlines():
    m = re.match(r'^\[([^\]]+)\]\s*$', line)
    if m: section = m.group(1)
    if re.match(r'^project_id\s*=', line): line = f'project_id = "{project}"'
    k = re.match(r'^(port|shadow_port)\s*=', line)
    if k and (section, k.group(1)) in want: line = f'{k.group(1)} = {want[(section, k.group(1))]}'
    if section == 'analytics' and re.match(r'^enabled\s*=', line): line = 'enabled = false'
    lines.append(line)
new = '\n'.join(lines) + '\n'
cfg.write_text(new)
pathlib.Path(logdir, 'config.diff').write_text(''.join(difflib.unified_diff(orig.splitlines(True), new.splitlines(True), 'base/supabase/config.toml', 'supabase/config.toml')))

# replay script: DB port (2 places) and keep-stack-on-exit switch (T4_KEEP_STACK=1).
rs = root / 'scripts/gridex-aud-003-clean-replay.sh'
o = rs.read_text()
n = o
for old, repl in (('127.0.0.1:54322/postgres', f'127.0.0.1:{db}/postgres'), ("'-p','54322'", f"'-p','{db}'"),
                  ('    supabase stop --no-backup >/dev/null 2>&1 || true\n  fi\n  if [[ -n "${REPLAY_PG_VERSION_PINNED:-}" ]]',
                   '    [[ "${T4_KEEP_STACK:-}" == 1 ]] || supabase stop --no-backup >/dev/null 2>&1 || true\n  fi\n  if [[ -n "${REPLAY_PG_VERSION_PINNED:-}" ]]')):
    if n.count(old) != 1: raise SystemExit(f'replay script patch anchor not found exactly once: {old[:40]!r}')
    n = n.replace(old, repl)
rs.write_text(n)
pathlib.Path(logdir, 'replay-script.diff').write_text(''.join(difflib.unified_diff(o.splitlines(True), n.splitlines(True), 'base/scripts/gridex-aud-003-clean-replay.sh', 'scripts/gridex-aud-003-clean-replay.sh')))
PY
}

run_replay() {
  prepare_stack_src
  ( cd "$STACK_SRC" && supabase stop --no-backup >/dev/null 2>&1 || true )
  t4_log "clean migration replay (several minutes), log $LOG_DIR/replay.log"
  ( cd "$STACK_SRC" && T4_KEEP_STACK=1 bash scripts/gridex-aud-003-clean-replay.sh ) > "$LOG_DIR/replay.log" 2>&1 \
    || t4_die "replay failed, see $LOG_DIR/replay.log"
  grep -o 'schema fingerprint verified: [0-9a-f]*' "$LOG_DIR/replay.log" | tail -1 > "$SIM_HOME/fingerprint.txt" || true
  echo "$HEAD_SHA" > "$SIM_HOME/replay-commit"
  t4_now > "$SIM_HOME/replay-at"
  : > "$SIM_HOME/applied-migrations.tsv"
}

if [ "${SKIP_REPLAY:-0}" = 1 ]; then
  t4_db_ready || t4_die "SKIP_REPLAY=1 but no replayed schema on 127.0.0.1:$T4_DB_PORT"
  if [ ! -s "$SIM_HOME/replay-commit" ]; then
    # Adopting a stack that was replayed by hand: record the commit it is assumed to match.
    echo "$HEAD_SHA" > "$SIM_HOME/replay-commit"; t4_now > "$SIM_HOME/replay-at"; : > "$SIM_HOME/applied-migrations.tsv"
    t4_log "adopted running stack (assumed replayed from $HEAD_SHA)"
  fi
  [ -d "$STACK_SRC" ] || t4_die "SKIP_REPLAY=1 needs $STACK_SRC to read stack keys"
elif t4_db_ready && [ "$(cat "$SIM_HOME/replay-commit" 2>/dev/null || true)" = "$HEAD_SHA" ]; then
  t4_log "stack already replayed from $HEAD_SHA"
else
  run_replay
fi

# ---- 3: env ----------------------------------------------------------------------------------------
STATUS_ENV="$SIM_HOME/status.env"
( cd "$STACK_SRC" && supabase status -o env ) > "$STATUS_ENV" 2>/dev/null || t4_die "supabase status failed (is the stack running?)"
chmod 600 "$STATUS_ENV"
python3 - "$STATUS_ENV" "$ENV_FILE" "$T4_API_PORT" "$T4_DB_PORT" "$T4_APP_PORT" "$T4_SINK_PORT" "$HEAD_SHA" <<'PY'
import pathlib, secrets, sys, uuid
status_path, env_path, api, db, app, sink, head = sys.argv[1:]
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
p.write_text(''.join(f'{k}={v}\n' for k, v in env.items()))
p.chmod(0o600)
PY
t4_load_env
t4_assert_local

# ---- 4: automation user, build, app ----------------------------------------------------------------
# Origin of the user-creation pattern: claude/gifted-hamilton-vss1hj 2711f862:scripts/reality/up.sh (step 4).
AUTH=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
if ! curl -sf "${AUTH[@]}" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users/$GRIDEX_AUTOMATION_USER_ID" >/dev/null; then
  curl -sf "${AUTH[@]}" -H 'content-type: application/json' -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
    -d "{\"id\":\"$GRIDEX_AUTOMATION_USER_ID\",\"email\":\"t4-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid\",\"email_confirm\":true}" >/dev/null
fi
psql "$T4_DB_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.user_profiles(id,email,full_name,user_status)
VALUES('$GRIDEX_AUTOMATION_USER_ID','t4-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid','T4 automation','active')
ON CONFLICT (id) DO UPDATE SET user_status='active';
SQL

BUILT="$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)"
if [ "${SKIP_BUILD:-0}" = 1 ] && [ "$BUILT" = "$HEAD_SHA" ] && [ -s "$APP_DIR/.next/BUILD_ID" ]; then
  t4_log "reusing build of $HEAD_SHA"
else
  t4_log "npm run build (log $LOG_DIR/next-build.log)"
  rm -f "$SIM_HOME/built-commit" "$APP_DIR/.next/BUILD_ID"
  ( cd "$APP_DIR" && npm run -s build ) > "$LOG_DIR/next-build.log" 2>&1 || true
  [ -s "$APP_DIR/.next/BUILD_ID" ] || t4_die "build failed, see $LOG_DIR/next-build.log"
  echo "$HEAD_SHA" > "$SIM_HOME/built-commit"
fi

# sink first (the app's env points to it)
if ! t4_pid_alive "$PID_DIR/sink.pid"; then
  : > "$LOG_DIR/sink-requests.jsonl"
  T4_SINK_PORT="$T4_SINK_PORT" T4_SINK_LOG="$LOG_DIR/sink-requests.jsonl" \
    setsid nohup node "$T4_DIR/counterparties/sink.mjs" > "$LOG_DIR/sink.log" 2>&1 < /dev/null &
  echo $! > "$PID_DIR/sink.pid"
  t4_wait_port "$T4_SINK_PORT" 15 || t4_die "sink did not open port $T4_SINK_PORT"
fi

if t4_pid_alive "$PID_DIR/app.pid" && [ "$BUILT" = "$HEAD_SHA" ]; then
  t4_log "app already running (pid $(cat "$PID_DIR/app.pid"))"
else
  if t4_pid_alive "$PID_DIR/app.pid"; then kill "$(cat "$PID_DIR/app.pid")" 2>/dev/null || true; sleep 1; fi
  if t4_port_open "$T4_APP_PORT"; then t4_die "port $T4_APP_PORT is taken by a process T4 did not start"; fi
  t4_log "next start on 127.0.0.1:$T4_APP_PORT"
  ( cd "$APP_DIR" && exec setsid nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$T4_APP_PORT" \
      > "$LOG_DIR/next-start.log" 2>&1 < /dev/null ) &
  echo $! > "$PID_DIR/app.pid"
  up=0
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$T4_APP_PORT/login" 2>/dev/null)" = 200 ] && { up=1; break; }
    sleep 2
  done
  [ "$up" = 1 ] || t4_die "app did not answer 200 on /login, see $LOG_DIR/next-start.log"
fi
t4_log "ready: app http://127.0.0.1:$T4_APP_PORT, api $NEXT_PUBLIC_SUPABASE_URL, db :$T4_DB_PORT, SIM_HOME=$SIM_HOME"
