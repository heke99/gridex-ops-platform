#!/usr/bin/env bash
# Startar spår 2:s egna lokala stack från RUN_DIR:s HEAD. Se README.md.
#   Explicit SIM_HOME/RUN_DIR och samordnarens startupAttempt krävs.
#   SKIP_REPLAY/SKIP_BUILD är spärrade tills separat kvalificering finns.
#   SIM_*_PORT     se lib/common.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

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
LOCK="$SIM_HOME/run.lock"
mkdir "$LOCK" 2>/dev/null || die "run.lock finns; samordnaren måste avstämma kvarlämnad låsning"
printf '%s\n' "$$" > "$LOCK/pid"
trap 'if [[ "$(cat "$LOCK/pid" 2>/dev/null)" == "$$" ]]; then rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true; fi' EXIT
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

# --- 3. privat kopia av scripts/ + supabase/ (RUN_DIR rörs inte) ------------------------
prepare_replay_root() {
  rm -rf "$REPLAY_ROOT"
  mkdir -p "$REPLAY_ROOT"
  cp -a "$RUN_DIR/scripts" "$RUN_DIR/supabase" "$REPLAY_ROOT/"
  python3 "$HARNESS_DIR/lib/prepare-supabase.py" "$REPLAY_ROOT/supabase/config.toml" "$SIM_PROJECT_ID" \
    "$SIM_API_PORT" "$SIM_DB_PORT" "$SIM_SHADOW_PORT" "$SIM_POOLER_PORT" "$SIM_STUDIO_PORT" \
    "$SIM_MAIL_HTTP_PORT" "$SIM_SMTP_PORT"
  # Minimala anpassningar av KOPIAN av replayskriptet (verifieras nedan):
  local s="$REPLAY_ROOT/scripts/gridex-aud-003-clean-replay.sh"
  # a) lämna stacken uppe efter replay (originalet kör 'supabase stop --no-backup' i EXIT-trap)
  sed -i 's#^\(\s*\)supabase stop --no-backup >/dev/null 2>&1 || true$#\1: \# sim: stacken lämnas uppe#' "$s"
  # b) mailpit får vara med i stacken (egen lokal mail); inget DB-beteende ändras
  sed -i 's|studio,imgproxy,mailpit,edge-runtime|studio,imgproxy,edge-runtime|' "$s"
  # c) DB-port
  [[ "$SIM_DB_PORT" == 54322 ]] || sed -i "s|54322|$SIM_DB_PORT|g" "$s"
  grep -q 'sim: stacken lämnas uppe' "$s" || die "patch a misslyckades (replayskriptet har ändrats?)"
  grep -q 'studio,imgproxy,edge-runtime' "$s" || die "patch b misslyckades"
  ! grep -q '^\s*supabase stop --no-backup' "$s" || die "patch a ofullständig"
  diff <(sed 's/\s*$//' "$RUN_DIR/scripts/gridex-aud-003-clean-replay.sh") <(sed 's/\s*$//' "$s") \
    >"$SIM_HOME/logs/replay-script-patch.diff" || true
}

REPLAY_PG_VERSION="$(sed -n 's/^REPLAY_POSTGRES_VERSION="\(.*\)"/\1/p' "$RUN_DIR/scripts/gridex-aud-003-clean-replay.sh")"
[[ -n "$REPLAY_PG_VERSION" ]] || die "kunde inte läsa REPLAY_POSTGRES_VERSION"

stack_running() { [[ "$(docker inspect -f '{{.State.Running}}' "supabase_db_$SIM_PROJECT_ID" 2>/dev/null)" == true ]]; }

prepare_replay_root
log "kör ren replay i tilldelat tomt projekt (logg: $SIM_HOME/logs/replay.log)"
rm -f "$SIM_HOME/replay-commit" "$SIM_HOME/replay-at" "$SIM_HOME/built-commit"
(cd "$REPLAY_ROOT" && bash scripts/gridex-aud-003-clean-replay.sh) >>"$SIM_HOME/logs/replay.log" 2>&1 \
  || die "replay misslyckades, se $SIM_HOME/logs/replay.log"
# replayskriptets EXIT-trap tar bort versionspinnen; lägg tillbaka den för senare 'supabase start'.
mkdir -p "$REPLAY_ROOT/supabase/.temp"; printf '%s' "$REPLAY_PG_VERSION" >"$REPLAY_ROOT/supabase/.temp/postgres-version"
stack_running || die "stacken körs inte efter replay"
printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/replay-commit"
date -u +%Y-%m-%dT%H:%M:%SZ >"$SIM_HOME/replay-at"
: >"$SIM_HOME/applied-migrations.tsv"

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
SIM_MAIL_HTTP_URL=http://127.0.0.1:$SIM_MAIL_HTTP_PORT
SIM_SMTP_PORT=$SIM_SMTP_PORT
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
EDIEL_SMTP_HOST=127.0.0.1
EDIEL_SMTP_PORT=$SIM_SMTP_PORT
EDIEL_SMTP_SECURE=false
EDIEL_SMTP_USER=sim@sim.invalid
EDIEL_SMTP_PASSWORD=$(rnd)
EDIEL_SMTP_FROM=sim@sim.invalid
PAPILITE_GEOCODE_URL=$CP_URL/papilite
LANTMATERIET_BELAGENHETSADRESS_BASE_URL=$CP_URL/lantmateriet
ENV
)
chmod 600 "$SIM_HOME/app.env"
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
log "klart: app=$APP_URL (/ -> $code) api=$API_URL db=127.0.0.1:$SIM_DB_PORT mail=http://127.0.0.1:$SIM_MAIL_HTTP_PORT smtp=127.0.0.1:$SIM_SMTP_PORT"
