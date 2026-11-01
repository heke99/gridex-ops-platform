#!/usr/bin/env bash
# Startar spår 5:s egna lokala stack från RUN_DIR:s HEAD. Se README.md.
#   SIM_HOME, RUN_DIR och privata runtime-/namespace-tilldelningar krävs uttryckligen.
#   Oförändrad canonical replay måste redan vara källad av samma levande producent-shell.
#   SIM_*_PORT     se lib/common.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
# The producer must source the unchanged canonical replay and retain its shell
# and EXIT cleanup through up -> scenarios -> cleanup. Never patch/replay here.
[[ "${SKIP_REPLAY:-0}" == 0 && "${SKIP_BUILD:-0}" == 0 ]] \
  || die "bare replay/build reuse is unsupported; qualified same-shell preparation required"
t5_process_custody namespace-plan || die "kvalificerat externt mottagarnät krävs"
python3 -B -I "$HARNESS_DIR/lib/prepared-backend.py" verify \
  --assignment "$SIM_RUNTIME_ASSIGNMENT_FILE" \
  --receipt "$SIM_HOME/prepared-backend.json" --replay-log "$SIM_HOME/logs/replay.log" \
  || die "exakt levande backend från kvarvarande canonical-replay-shell krävs"
t5_acquire_runtime_lock
t5_process_custody stop || die "gamla processer saknar verifierat ägande; producentåterställning krävs"
HEAD_SHA="$(git -C "$RUN_DIR" rev-parse HEAD)"
for c in docker supabase psql python3 node curl openssl; do command -v "$c" >/dev/null || die "saknar $c"; done
[[ "$(supabase --version 2>/dev/null | tail -1)" == 2.101.0 ]] || die "supabase CLI måste vara 2.101.0"
[[ -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas"
# These report fields describe the separately verified receipt; they grant no reuse.
printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/replay-commit"
date -u +%Y-%m-%dT%H:%M:%SZ >"$SIM_HOME/replay-at"
python3 -B -I - "$SIM_HOME/prepared-backend.json" "$SIM_HOME/fingerprint" <<'PY_FINGERPRINT'
import json,pathlib,sys
receipt=json.loads(pathlib.Path(sys.argv[1]).read_text())
pathlib.Path(sys.argv[2]).write_text(receipt['observation']['schemaFingerprint']+'\n')
PY_FINGERPRINT
log "förberedd backend verifierad; app=$HEAD_SHA; canonical-shell äger backendstädning"

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
# Producer already created and probed the complete, hash-bound TLS trio before
# Docker bridges existed. The backend receipt verifies those exact bytes here.
(cd "$HARNESS_DIR" && exec env SIM_HOME="$SIM_HOME" SIM_RECEIVER_TLS_PORT="$SIM_RECEIVER_TLS_PORT" SIM_RECEIVER_CTRL_PORT="$SIM_RECEIVER_CTRL_PORT" \
  setsid nohup node "$HARNESS_DIR/lib/webhook-receiver.mjs") >"$SIM_HOME/logs/receiver.log" 2>&1 &
receiver_pid=$!
t5_process_custody birth receiver "$receiver_pid" || die "mottagar-PID $receiver_pid saknar birth-kvitto; samordnaråterställning krävs"
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__health" >/dev/null || die "webhookmottagaren startade inte"
t5_process_custody ready receiver
# Recheck every host through the ACTUAL product transport after restarting the
# exact receiver for scenarios. This is a read-only probe, not network preparation.
python3 -B -I - "$SIM_RUNTIME_ASSIGNMENT_FILE" "$HARNESS_DIR/lib/receiver-network.py" "$SIM_HOME/receiver" <<'PY_RECEIVER_PROBE'
import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('receiver',sys.argv[2])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
assignment=module.parse(module.private_file(sys.argv[1]))
module.probe(assignment,module.Commands(),pathlib.Path(sys.argv[3]))
PY_RECEIVER_PROBE
curl -fsS -X POST "http://127.0.0.1:$SIM_RECEIVER_CTRL_PORT/__reset" >/dev/null

# --- 6. bygge --------------------------------------------------------------------------
[[ -x "$RUN_DIR/node_modules/.bin/next" ]] || die "RUN_DIR/node_modules saknas"
log "next build (privat logg: $SIM_HOME/logs/build.log)"
rm -f "$SIM_HOME/built-commit"
(cd "$RUN_DIR" && set -a && . "$SIM_HOME/app.env" && set +a && NODE_OPTIONS="--max-old-space-size=6144" npm run build) \
  >"$SIM_HOME/logs/build.log" 2>&1 || die "bygget misslyckades"
printf '%s\n' "$HEAD_SHA" >"$SIM_HOME/built-commit"

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
