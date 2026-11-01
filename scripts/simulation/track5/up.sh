#!/usr/bin/env bash
# Startar spår 5:s egna lokala stack från RUN_DIR:s HEAD. Se README.md.
#   SIM_HOME, RUN_DIR och privata runtime-/namespace-tilldelningar krävs uttryckligen.
#   SKIP_REPLAY=1  återanvänd stack/DB (diff replay-commit..HEAD får bara lägga till migrationer, som sim-runner applicerar)
#   SKIP_BUILD=1   återanvänd bygget (diff built-commit..HEAD får bara röra icke-appsökvägar, se build_reusable)
#   SIM_*_PORT     se lib/common.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
t5_process_custody namespace-plan || die "samordnarens kvalificerade externa mottagarnät krävs; inga värdnätändringar utförs"
t5_acquire_runtime_lock
t5_process_custody stop || die "gamla processer saknar verifierat ägande; samordnaren måste återställa"

export SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io   # Docker Hub (429) / ECR (data limit) går inte; finns i CLI 2.101.0
[[ "$(supabase --version 2>/dev/null | tail -1)" == 2.101.0 ]] || die "supabase CLI måste vara 2.101.0 (replayskriptet kräver det)"
HEAD_SHA="$(git -C "$RUN_DIR" rev-parse HEAD)"
log "RUN_DIR=$RUN_DIR HEAD=$HEAD_SHA SIM_HOME=$SIM_HOME"
for c in docker supabase psql python3 node curl openssl; do command -v "$c" >/dev/null || die "saknar $c"; done
[[ "${SKIP_BUILD:-0}" == 1 || -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas (sim-runner kör npm ci)"

# --- 1. docker -----------------------------------------------------------------------
docker info >/dev/null 2>&1 || die "kvalificerad Docker-daemon saknas; up.sh startar ingen värddaemon"

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
SIM_RECEIVER_TLS_PORT=$SIM_RECEIVER_TLS_PORT
SIM_RECEIVER_CTRL_PORT=$SIM_RECEIVER_CTRL_PORT
SIM_RECEIVER_IP=$SIM_RECEIVER_IP
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

if [[ "${SKIP_REPLAY:-0}" == 1 ]]; then
  rc_commit="$(cat "$SIM_HOME/replay-commit" 2>/dev/null)" || die "SKIP_REPLAY=1 men replay-commit saknas"
  bad="$(git -C "$RUN_DIR" diff --no-renames --name-status "$rc_commit" HEAD -- supabase scripts/gridex-aud-003-clean-replay.sh | grep -vE '^A\s+supabase/migrations/' || true)"
  [[ -z "$bad" ]] || die "SKIP_REPLAY=1 men replay-underlaget ändrat sedan $rc_commit: $bad"
  [[ -d "$REPLAY_ROOT/supabase" ]] || die "SKIP_REPLAY=1 men $REPLAY_ROOT saknas"
  if ! stack_running; then
    docker volume ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID" | grep -q . \
      || die "SKIP_REPLAY=1 men stackens volymer saknas (down.sh rensar dem); kör utan SKIP_REPLAY"
    log "startar om befintlig stack (SKIP_REPLAY)"
    mkdir -p "$REPLAY_ROOT/supabase/.temp"; printf '%s' "$REPLAY_PG_VERSION" >"$REPLAY_ROOT/supabase/.temp/postgres-version"
    sb start -x studio,imgproxy,edge-runtime,logflare,vector >>"$SIM_HOME/logs/supabase-start.log" 2>&1
  fi
else
  # Kontrakt: en stack per container. Kör redan en Supabase-stack avbryts i stället för att stoppas.
  if docker ps --format '{{.Names}}' --filter name=supabase_db_ | grep -q .; then
    die "BLOCKED: stacken upptagen ($(docker ps --format '{{.Names}}' --filter name=supabase_db_ | tr '\n' ' ')); kör down.sh först"
  fi
  existing_containers="$(docker ps -aq --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")" \
    || die "kunde inte inventera projektcontainrar; ingen replay utförs"
  existing_volumes="$(docker volume ls -q --filter "label=com.supabase.cli.project=$SIM_PROJECT_ID")" \
    || die "kunde inte inventera projektvolymer; ingen replay utförs"
  [[ -z "$existing_containers" && -z "$existing_volumes" ]] \
    || die "projektresurser finns redan; ingen automatisk backendstädning utförs"
  prepare_replay_root
  log "kör ren replay (logg: $SIM_HOME/logs/replay.log)"
  rm -f "$SIM_HOME/replay-commit" "$SIM_HOME/replay-at" "$SIM_HOME/built-commit" "$SIM_HOME/fingerprint"
  (cd "$REPLAY_ROOT" && bash scripts/gridex-aud-003-clean-replay.sh) >>"$SIM_HOME/logs/replay.log" 2>&1 \
    || die "replay misslyckades, se $SIM_HOME/logs/replay.log"
  # replayskriptets EXIT-trap tar bort versionspinnen; lägg tillbaka den för senare 'supabase start'.
  mkdir -p "$REPLAY_ROOT/supabase/.temp"; printf '%s' "$REPLAY_PG_VERSION" >"$REPLAY_ROOT/supabase/.temp/postgres-version"
  stack_running || die "stacken körs inte efter replay"
  fp="$(sed -n 's/^\[GRIDEX-REM-002 replay\] schema fingerprint verified: \([0-9a-f]\{64\}\)$/\1/p' "$SIM_HOME/logs/replay.log" | tail -1)"
  [[ -n "$fp" ]] || die "replayloggen saknar verifierat fingeravtryck"
  printf '%s\n' "$fp" >"$SIM_HOME/fingerprint"
  printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/replay-commit"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$SIM_HOME/replay-at"
  : >"$SIM_HOME/applied-migrations.tsv"
fi

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
RESEND_WEBHOOK_SECRET=whsec_$(openssl rand -base64 32)
EDIEL_EMAIL_PROVIDER=strato
EDIEL_SMTP_HOST=127.0.0.1
EDIEL_SMTP_PORT=$SIM_SMTP_PORT
EDIEL_SMTP_SECURE=false
EDIEL_SMTP_USER=sim@sim.invalid
EDIEL_SMTP_PASSWORD=$(rnd)
EDIEL_SMTP_FROM=sim@sim.invalid
PAPILITE_GEOCODE_URL=$CP_URL/papilite
LANTMATERIET_BELAGENHETSADRESS_BASE_URL=$CP_URL/lantmateriet
NODE_EXTRA_CA_CERTS=$SIM_HOME/receiver/ca.pem
SIM_RECEIVER_CTRL_URL=http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT
SIM_RECEIVER_HOSTS=${SIM_RECEIVER_HOSTS// /,}
ENV
)
chmod 600 "$SIM_HOME/app.env"
( umask 077; printf '%s\n' "$DB_URL" >"$SIM_HOME/db-url" )
# Obs: RESEND_API_KEY, PAPILITE_API_KEY, OPENAI_API_KEY, OPENDATALOADER_API_URL,
# LANTMATERIET_*_USERNAME/PASSWORD sätts INTE (tomma = integrationen avstängd).

# --- 5. lokala motparter ---------------------------------------------------------------
(cd "$HARNESS_DIR" && exec env SIM_HOME="$SIM_HOME" SIM_COUNTERPART_PORT="$SIM_COUNTERPART_PORT" \
  setsid nohup node "$HARNESS_DIR/lib/counterparts.mjs") >"$SIM_HOME/logs/counterparts.log" 2>&1 &
counterparts_pid=$!
t5_process_custody birth counterparts "$counterparts_pid" || die "motparts-PID $counterparts_pid saknar birth-kvitto; samordnaråterställning krävs"
for _ in $(seq 1 20); do curl -fsS "$CP_URL/__health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "$CP_URL/__health" >/dev/null || die "motparter startade inte"
t5_process_custody ready counterparts

# --- 5b. EVENT01: lokal https-webhookmottagare bakom publik test-IP ----------------------
# Appen godtar bara https-mål med publik adress. Samordnaren måste redan ha
# förberett det tilldelade mottagarnätet; inga hosts/iptables/sysctl ändras här.
mkdir -p "$SIM_HOME/receiver"
if [[ ! -f "$SIM_HOME/receiver/ca.pem" ]]; then
  ( umask 077; cd "$SIM_HOME/receiver"
    openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=gridex-sim-track5-ca" -keyout ca.key -out ca.pem >/dev/null 2>&1
    openssl req -newkey rsa:2048 -nodes -subj "/CN=receiver.t5.sim.invalid" -keyout server.key -out server.csr >/dev/null 2>&1
    printf 'subjectAltName=%s\n' "$(for h in $SIM_RECEIVER_HOSTS; do printf 'DNS:%s,' "$h"; done | sed 's/,$//')" >san.ext
    openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 7 -extfile san.ext -out server.pem >/dev/null 2>&1 )
  [[ -s "$SIM_HOME/receiver/server.pem" ]] || die "kunde inte skapa mottagarcertifikat"
fi
(cd "$HARNESS_DIR" && exec env SIM_HOME="$SIM_HOME" SIM_RECEIVER_TLS_PORT="$SIM_RECEIVER_TLS_PORT" SIM_RECEIVER_CTRL_PORT="$SIM_RECEIVER_CTRL_PORT" \
  setsid nohup node "$HARNESS_DIR/lib/webhook-receiver.mjs") >"$SIM_HOME/logs/receiver.log" 2>&1 &
receiver_pid=$!
t5_process_custody birth receiver "$receiver_pid" || die "mottagar-PID $receiver_pid saknar birth-kvitto; samordnaråterställning krävs"
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__health" >/dev/null || die "webhookmottagaren startade inte"
t5_process_custody ready receiver
first_host="${SIM_RECEIVER_HOSTS%% *}"
curl -fsS --noproxy '*' --cacert "$SIM_HOME/receiver/ca.pem" -X POST "https://$first_host/hook/__probe" -d '{}' >/dev/null \
  || die "mottagaren nås inte via $first_host -> $SIM_RECEIVER_IP (DNAT)"
curl -fsS -X POST "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__reset" >/dev/null

# --- 6. bygge --------------------------------------------------------------------------
if [[ "${SKIP_BUILD:-0}" == 1 ]]; then
  bc_commit="$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)"
  [[ -n "$bc_commit" && -d "$RUN_DIR/.next" ]] && ! git -C "$RUN_DIR" diff --name-only "$bc_commit" HEAD \
      | grep -vE '^(scripts/simulation/|scripts/[^/]*-native\.test\.ts$|__tests__/|quality/|\.agent-memory/|\.claude/)' | grep -q . \
    || die "SKIP_BUILD=1 men .next saknas eller appfiler ändrade sedan built-commit"
else
  [[ -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas (sim-runner kör npm ci)"
  log "next build (logg: $SIM_HOME/logs/build.log)"
  rm -f "$SIM_HOME/built-commit"
  # next build typkontrollerar i en underprocess som inte ärver byggskriptets --max-old-space-size (OOM vid ~2 GB).
  (cd "$RUN_DIR" && set -a && . "$SIM_HOME/app.env" && set +a && NODE_OPTIONS="--max-old-space-size=6144" npm run build) >"$SIM_HOME/logs/build.log" 2>&1 \
    || die "bygget misslyckades, se $SIM_HOME/logs/build.log"
  printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/built-commit"
fi

# --- 7. app ----------------------------------------------------------------------------
(cd "$RUN_DIR" && set -a && . "$SIM_HOME/app.env" && set +a && \
  exec setsid nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$SIM_APP_PORT") \
  >"$SIM_HOME/logs/app.log" 2>&1 &
app_pid=$!
t5_process_custody birth app "$app_pid" || die "app-PID $app_pid saknar birth-kvitto; samordnaråterställning krävs"
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/" || true)"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ ]] && break
  kill -0 "$app_pid" 2>/dev/null || die "den nyss startade appen dog, se $SIM_HOME/logs/app.log"
  sleep 1
done
[[ "${code:-000}" != 000 ]] || die "appen svarade inte på $APP_URL/"
t5_process_custody ready app
log "klart: app=$APP_URL (/ -> $code) api=$API_URL db=127.0.0.1:$SIM_DB_PORT mail=http://127.0.0.1:$SIM_MAIL_HTTP_PORT smtp=127.0.0.1:$SIM_SMTP_PORT"
