#!/usr/bin/env bash
# Startar spår 2:s egna lokala stack från RUN_DIR:s HEAD. Se README.md.
#   Explicit SIM_HOME/RUN_DIR och samordnarens startupAttempt krävs.
#   SKIP_REPLAY/SKIP_BUILD är spärrade tills separat kvalificering finns.
#   SIM_*_PORT     se lib/common.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[[ -z "${GRIDEX_REPLAY_DB_URL:-}" ]] || die "external replay substitution is forbidden"
[[ "$SIM_DB_PORT" == 54322 ]] || die "explicit canonical DB port 54322 required"
[[ "${SKIP_REPLAY:-0}" == 0 && "${SKIP_BUILD:-0}" == 0 ]] || die "replay/build-återanvändning saknar kvalificering"
python3 - "$SIM_RUNTIME_ASSIGNMENT_FILE" <<'PY'
import json, re, sys
a = json.load(open(sys.argv[1])); attempt = a.get('startupAttempt', {})
if not isinstance(attempt, dict) or attempt.get('exclusiveHost') is not True:
    raise SystemExit('startup_requires_separate_qualified_backend_attempt')
for key in ('backendReservation', 'producerReservation'):
    value = attempt.get(key, {})
    if not isinstance(value, dict) or not str(value.get('ref', '')).startswith('refs/tags/agent-claims/masterplan/') or not re.fullmatch('[0-9a-f]{40}', str(value.get('receipt', ''))):
        raise SystemExit('startup_requires_explicit_reservation_bindings')
PY
for f in replay-root app.env pids/app.pid pids/counterparts.pid pids/app.identity.json pids/counterparts.identity.json pids/app.ready.identity.json pids/counterparts.ready.identity.json; do
  [[ ! -e "$SIM_HOME/$f" && ! -L "$SIM_HOME/$f" ]] || die "befintligt tillstånd kräver samordnarens avstämning: $f"
done
T2_LOCK="$SIM_HOME/run.lock"
mkdir "$T2_LOCK" 2>/dev/null || die "run.lock finns; samordnaren måste avstämma kvarlämnad låsning"
printf '%s\n' "$$" > "$T2_LOCK/pid"
trap 'if [[ "$(cat "$T2_LOCK/pid" 2>/dev/null)" == "$$" ]]; then rm -f "$T2_LOCK/pid"; rmdir "$T2_LOCK" 2>/dev/null || true; fi' EXIT
[[ "$(node --version)" == v22.* ]] || die "Node 22 krävs"

export SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io   # Docker Hub (429) / ECR (data limit) går inte; finns i CLI 2.101.0
[[ "$(supabase --version 2>/dev/null | tail -1)" == 2.101.0 ]] || die "supabase CLI måste vara 2.101.0 (replayskriptet kräver det)"
HEAD_SHA="$(git -C "$RUN_DIR" rev-parse HEAD)"
log "RUN_DIR=$RUN_DIR HEAD=$HEAD_SHA SIM_HOME=$SIM_HOME"
for c in docker supabase psql python3 node curl openssl; do command -v "$c" >/dev/null || die "saknar $c"; done
[[ "${SKIP_BUILD:-0}" == 1 || -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas (sim-runner kör npm ci)"

# --- 1. docker -----------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  die "tilldelad Docker-daemon svarar inte; automatisk host-start är spärrad"
fi
for resource in container volume network; do
  if [[ "$resource" == container ]]; then
    ids="$(docker container ls -aq --no-trunc --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")" || die "kunde inte kontrollera befintliga containrar"
  else
    ids="$(docker "$resource" ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")" || die "kunde inte kontrollera befintliga $resource-resurser"
  fi
  [[ -z "$ids" ]] || die "projektets $resource-resurser finns redan; ingen automatisk stop/radering utförs"
done

# --- 2. portar -----------------------------------------------------------------------
cat >"$SIM_HOME/ports.env" <<PORTS
SIM_PROJECT_ID=$SIM_PROJECT_ID
SIM_API_PORT=$SIM_API_PORT
SIM_DB_PORT=$SIM_DB_PORT
SIM_SHADOW_PORT=$SIM_SHADOW_PORT
SIM_POOLER_PORT=$SIM_POOLER_PORT
SIM_STUDIO_PORT=$SIM_STUDIO_PORT
SIM_MAIL_HTTP_PORT=$SIM_MAIL_HTTP_PORT
SIM_SMTP_PORT=$SIM_SMTP_PORT
SIM_APP_PORT=$SIM_APP_PORT
SIM_COUNTERPART_PORT=$SIM_COUNTERPART_PORT
PORTS

# --- 3. Private source copy, canonical replay bytes are NEVER rewritten. ----------
mkdir "$REPLAY_ROOT"
cp -a "$RUN_DIR/scripts" "$RUN_DIR/supabase" "$REPLAY_ROOT/"
python3 "$HARNESS_DIR/lib/prepare-supabase.py" "$REPLAY_ROOT/supabase/config.toml" "$SIM_PROJECT_ID" \
  "$SIM_API_PORT" "$SIM_DB_PORT" "$SIM_SHADOW_PORT" "$SIM_POOLER_PORT" "$SIM_STUDIO_PORT" \
  "$SIM_MAIL_HTTP_PORT" "$SIM_SMTP_PORT"
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation replay-before
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation supervisor-entered
T2_SUPABASE_BIN="$(type -P supabase)"
[[ -n "$T2_SUPABASE_BIN" ]] || die "official Supabase CLI unavailable"
# Same bounded stop wrapper as qualified T6: exact canonical argv and cleanup
# function stay intact; no no-op stop, rewrite, external DB or manual pin restore.
supabase() {
  if [[ "${1:-}" == stop ]]; then
    local t2_stop_status=0
    timeout --signal=TERM --kill-after=10s 120s "$T2_SUPABASE_BIN" "$@" || t2_stop_status=$?
    (umask 077; set -o noclobber; printf '%s\n' "$t2_stop_status" > "$SIM_HOME/canonical-stop.exit-code") || return 1
    return "$t2_stop_status"
  else
    "$T2_SUPABASE_BIN" "$@"
  fi
}
trap 'exit 143' TERM INT HUP
cd "$REPLAY_ROOT"
# This MUST be a bare source command: no child bash, conditional, ||, or function
# wrapper that suppresses canonical errexit/EXIT behavior on replay failure.
source "$REPLAY_ROOT/scripts/gridex-aud-003-clean-replay.sh" >> "$SIM_HOME/logs/replay.log" 2>&1

t2_finish_runtime() {
  local t2_status=$? t2_cleanup_status=0
  trap - EXIT
  set +e
  t2_process_custody stop >> "$SIM_HOME/logs/process-stop.log" 2>&1 || t2_cleanup_status=1
  if python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation supervisor-cleanup-preflight >> "$SIM_HOME/logs/canonical-finish.log" 2>&1; then
    cleanup
    python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation replay-after >> "$SIM_HOME/logs/canonical-finish.log" 2>&1 || t2_cleanup_status=1
    [[ "$(cat "$SIM_HOME/canonical-stop.exit-code" 2>/dev/null)" == 0 ]] || t2_cleanup_status=1
  else
    t2_cleanup_status=1
    printf '%s\n' 'HOLD: canonical cleanup admission changed; unknown resources preserved' >&2
  fi
  if [[ -d "$T2_LOCK" && "$(cat "$T2_LOCK/pid" 2>/dev/null)" == "$$" ]]; then
    rm -f "$T2_LOCK/pid"
    rmdir "$T2_LOCK" || t2_cleanup_status=1
  fi
  (( t2_cleanup_status == 0 )) || t2_status=1
  exit "$t2_status"
}
trap t2_finish_runtime EXIT
printf '%s\n' "$HEAD_SHA" > "$SIM_HOME/replay-commit"
date -u +%Y-%m-%dT%H:%M:%SZ > "$SIM_HOME/replay-at"
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation replay-live
# The owned TLS mailbox starts once after up/cgroup/attempt admission and before
# the application build. Canonical replay's excluded Mailpit stays excluded.
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation mailbox-start
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation mailbox-export

# --- 4. app.env från stackens status -------------------------------------------------
status_env="$(sb status -o env 2>/dev/null)" || die "supabase status misslyckades"
envval() { printf '%s\n' "$status_env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -1; }
API_URL="$(envval API_URL)"; ANON="$(envval ANON_KEY)"; SERVICE="$(envval SERVICE_ROLE_KEY)"; DB_URL="$(envval DB_URL)"
[[ -n "$API_URL" && -n "$ANON" && -n "$SERVICE" && -n "$DB_URL" ]] || die "status gav inte API_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL"
rnd() { openssl rand -hex 24; }
APP_URL="http://127.0.0.1:$SIM_APP_PORT"
CP_URL="http://127.0.0.1:$SIM_COUNTERPART_PORT"
(
  umask 077
  cat >"$SIM_HOME/app.env" <<ENV
# Genererad av up.sh. Innehåller hemligheter; aldrig committas eller loggas.
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
SIM_DB_URL=$DB_URL
SIM_APP_URL=$APP_URL
SIM_COUNTERPART_URL=$CP_URL
SIM_MAIL_HTTP_STATE=RESERVED_NOT_USED
SIM_LEGACY_SMTP_STATE=RESERVED_NOT_USED
SITE_URL=$APP_URL
NEXT_PUBLIC_SITE_URL=$APP_URL
NEXT_PUBLIC_APP_URL=$APP_URL
NEXT_PUBLIC_BASE_URL=$APP_URL
PUBLIC_SIGNING_BASE_URL=$APP_URL
CRON_SECRET=$(rnd)
GRIDEX_CRON_SECRET=$(rnd)
OPS_HEALTH_CRON_SECRET=$(rnd)
EDIEL_CRON_SECRET=$(rnd)
EDIEL_INBOUND_CRON_SECRET=$(rnd)
EDIEL_PLATFORM_MAINTENANCE_SECRET=$(rnd)
SIGNATURE_EVIDENCE_SECRET=$(rnd)
MANUAL_INBOUND_WEBHOOK_SECRET=$(rnd)
RESEND_WEBHOOK_SECRET=$(rnd)
EDIEL_EMAIL_PROVIDER=strato
PAPILITE_GEOCODE_URL=$CP_URL/papilite
LANTMATERIET_BELAGENHETSADRESS_BASE_URL=$CP_URL/lantmateriet
ENV
)
cat "$SIM_HOME/mailbox.env" >> "$SIM_HOME/app.env"
chmod 600 "$SIM_HOME/app.env"
set -a; . "$SIM_HOME/mailbox.env"; set +a
# Obs: RESEND_API_KEY, PAPILITE_API_KEY, OPENAI_API_KEY, OPENDATALOADER_API_URL,
# LANTMATERIET_*_USERNAME/PASSWORD sätts INTE (tomma = integrationen avstängd).

# --- 5. lokala motparter ---------------------------------------------------------------
(cd "$HARNESS_DIR" && exec env SIM_HOME="$SIM_HOME" SIM_COUNTERPART_PORT="$SIM_COUNTERPART_PORT" \
  setsid node "$HARNESS_DIR/lib/counterparts.mjs") >"$SIM_HOME/logs/counterparts.log" 2>&1 &
echo $! >"$SIM_HOME/pids/counterparts.pid"
t2_process_custody record counterparts
for _ in $(seq 1 20); do curl -fsS "$CP_URL/__health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "$CP_URL/__health" >/dev/null || die "motparter startade inte"
t2_process_custody ready counterparts

# --- 6. bygge --------------------------------------------------------------------------
[[ -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas (sim-runner kör npm ci)"
log "next build (logg: $SIM_HOME/logs/build.log)"
rm -f "$SIM_HOME/built-commit"
(cd "$RUN_DIR" && set -a && . "$SIM_HOME/app.env" && set +a && npm run build) >"$SIM_HOME/logs/build.log" 2>&1 \
  || die "bygget misslyckades, se $SIM_HOME/logs/build.log"
printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/built-commit"

# --- 7. app ----------------------------------------------------------------------------
(cd "$RUN_DIR" && set -a && . "$SIM_HOME/app.env" && set +a && \
  exec setsid nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$SIM_APP_PORT") \
  >"$SIM_HOME/logs/app.log" 2>&1 &
echo $! >"$SIM_HOME/pids/app.pid"
t2_process_custody record app
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/" || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ ]] && break
  app_pid_alive || die "appen dog, se $SIM_HOME/logs/app.log"
  sleep 1
done
[[ "${code:-000}" != 000 ]] || die "appen svarade inte på $APP_URL/"
t2_process_custody ready app
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation qualify
# run.sh owns its own lock; release only our exact startup lock first.
[[ "$(cat "$T2_LOCK/pid" 2>/dev/null)" == "$$" ]] || die "startup lock identity changed"
rm "$T2_LOCK/pid"
rmdir "$T2_LOCK"
# Both real consumers remain under the original source shell's live EXIT trap.
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation scenario
python3 -B "$HARNESS_DIR/hosted/qualify-runtime.py" --operation actor-proof
