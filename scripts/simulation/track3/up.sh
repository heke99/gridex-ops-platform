#!/usr/bin/env bash
# Spår 3 (Ediel): starta den lokala kedjan. Idempotent.
#   up.sh [--mode test|production]
# Miljövariabler: SKIP_BUILD=1 (återanvänd bygget om built-commit == HEAD), SKIP_REPLAY=1 (återanvänd stacken),
#   SIM_HOME, SIM_RUN_DIR, T3_*_PORT (se lib/common.sh).
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
umask 077

MODE="test"
while (( $# )); do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#--mode=}"; shift ;;
    *) t3_die "okänd parameter: $1" ;;
  esac
done
[[ "$MODE" == "test" || "$MODE" == "production" ]] || t3_die "--mode måste vara test eller production"

mkdir -p "$SIM_HOME"/{env,ca,secrets,mail/inbox-dso,pids,logs,runs,evidence,shim}
chmod 700 "$SIM_HOME/secrets" "$SIM_HOME/ca" "$SIM_HOME/env"
echo "$MODE" > "$SIM_HOME/mode"

HEAD_SHA="$(git -C "$RUN_DIR" rev-parse HEAD)"
t3_log "körkatalog $RUN_DIR HEAD=$HEAD_SHA mode=$MODE SIM_HOME=$SIM_HOME"

# ---- (a) stack + replay-kvitto ---------------------------------------------------
if ! t3_stack_ok || ! t3_port_open "$T3_SUPABASE_DB_PORT"; then
  if [[ "${SKIP_REPLAY:-0}" == "1" ]]; then t3_die "SKIP_REPLAY=1 men stacken svarar inte"; fi
  t3_log "stacken svarar inte -> clean replay (supabase stop är no-op via shim)"
  if [[ ! -x "$SIM_HOME/shim/supabase" ]]; then
    cat > "$SIM_HOME/shim/supabase" <<SHIM
#!/usr/bin/env bash
# sim-runner shim: håll stacken vid liv efter replay (stop = no-op), annars pass-through
if [[ "\${1:-}" == "stop" ]]; then echo "[shim] supabase stop suppressed" >&2; exit 0; fi
exec $T3_SUPABASE_BIN "\$@"
SHIM
    chmod 755 "$SIM_HOME/shim/supabase"
  fi
  rm -f "$SIM_HOME/replay-commit"
  date +%s > "$SIM_HOME/replay.start"
  ( cd "$RUN_DIR" && PATH="$SIM_HOME/shim:$PATH" bash scripts/gridex-aud-003-clean-replay.sh ) >"$LOG_DIR/replay-up.log" 2>&1 \
    || t3_die "replay misslyckades, se $LOG_DIR/replay-up.log"
  date +%s > "$SIM_HOME/replay.end"
fi
t3_stack_ok || t3_die "Supabase API svarar inte på :$T3_SUPABASE_API_PORT"
PGPASSWORD=postgres psql "$T3_DB_URL" -XAtc 'select 1' >/dev/null || t3_die "Supabase DB svarar inte på :$T3_SUPABASE_DB_PORT"
if [[ ! -s "$SIM_HOME/replay-commit" ]]; then
  # Stacken är en clean replay av körkatalogens HEAD (kvitterat av sim-runner); skriv kvitto.
  echo "$HEAD_SHA" > "$SIM_HOME/replay-commit"
  [[ -s "$SIM_HOME/replay-at" ]] || { [[ -s "$SIM_HOME/replay.end" ]] && cp "$SIM_HOME/replay.end" "$SIM_HOME/replay-at" || date +%s > "$SIM_HOME/replay-at"; }
  : > "$SIM_HOME/applied-migrations.tsv"
  t3_log "skrev replay-commit/replay-at/applied-migrations.tsv"
fi
[[ -e "$SIM_HOME/applied-migrations.tsv" ]] || : > "$SIM_HOME/applied-migrations.tsv"
[[ "$(cat "$SIM_HOME/replay-commit")" == "$HEAD_SHA" ]] || t3_log "VARNING: replay-commit $(cat "$SIM_HOME/replay-commit") != HEAD $HEAD_SHA"

# ---- (b) loopback-CA + servercert ------------------------------------------------
CA="$SIM_HOME/ca"
if [[ ! -s "$CA/ca.pem" || ! -s "$CA/server.pem" ]] || ! openssl x509 -checkend 86400 -noout -in "$CA/server.pem" >/dev/null 2>&1; then
  t3_log "genererar lokal CA + servercert (127.0.0.1/localhost)"
  cat > "$CA/ext.cnf" <<'EXT'
[ca]
basicConstraints=critical,CA:true
keyUsage=critical,keyCertSign,cRLSign
[server]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:smtp.t3.sim.invalid,DNS:imap.t3.sim.invalid,IP:127.0.0.1
EXT
  ( cd "$CA"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 \
      -subj "/CN=SYNTHETIC TRACK3 LOOPBACK CA" -config ext.cnf -extensions ca 2>/dev/null
    openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
    openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -set_serial "$(date +%s)" -days 30 \
      -out server.pem -extfile ext.cnf -extensions server 2>/dev/null
    rm -f server.csr
    chmod 600 ca.key server.key; chmod 644 ca.pem server.pem )
fi

# ---- hemligheter (lokalt genererade, kvar i SIM_HOME) -----------------------------
gen_secret() { local f="$SIM_HOME/secrets/$1"; [[ -s "$f" ]] || { openssl rand -hex 24 > "$f"; chmod 600 "$f"; }; cat "$f"; }
SMTP_PASS="$(gen_secret smtp-pass)"; IMAP_PASS="$(gen_secret imap-pass)"
CRON_SECRET_INBOUND="$(gen_secret cron-inbound)"; CRON_SECRET_OUTBOX="$(gen_secret cron-outbox)"

# ---- (c) mailmotpart: GreenMail (IMAP, docker) + Node (SMTP TLS, IMAP TLS-terminator, kontroll) ----
if ! docker ps --format '{{.Names}}' | grep -qx "$T3_GREENMAIL_NAME"; then
  docker rm -f "$T3_GREENMAIL_NAME" >/dev/null 2>&1 || true
  t3_log "startar GreenMail ($T3_GREENMAIL_IMAGE) på 127.0.0.1:$T3_IMAP_PLAIN_PORT"
  docker run -d --name "$T3_GREENMAIL_NAME" --label sim.track=track3 --label sim.campaign=20261029-3f1a8ab1 \
    -p "127.0.0.1:${T3_IMAP_PLAIN_PORT}:3143" \
    -e GREENMAIL_OPTS="-Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=${T3_IMAP_USER}:${IMAP_PASS}@${T3_MAIL_DOMAIN}" \
    "$T3_GREENMAIL_IMAGE" >"$LOG_DIR/greenmail-run.log" 2>&1 || t3_die "docker run greenmail misslyckades (se $LOG_DIR/greenmail-run.log)"
fi
t3_wait_for "GreenMail IMAP" 90 t3_port_open "$T3_IMAP_PLAIN_PORT"

if ! t3_pid_alive "$PID_DIR/counterparty.pid"; then
  t3_log "startar mailmotpart (SMTP TLS :$T3_SMTP_PORT, IMAP TLS :$T3_IMAP_TLS_PORT, kontroll :$T3_CONTROL_PORT)"
  SIM_HOME="$SIM_HOME" T3_SMTP_PORT="$T3_SMTP_PORT" T3_IMAP_TLS_PORT="$T3_IMAP_TLS_PORT" \
  T3_IMAP_PLAIN_PORT="$T3_IMAP_PLAIN_PORT" T3_CONTROL_PORT="$T3_CONTROL_PORT" T3_SMTP_USER="$T3_MAILBOX_ADDRESS" \
    setsid nohup node "$T3_DIR/counterparty/mail-counterparty.mjs" >>"$LOG_DIR/counterparty.log" 2>&1 < /dev/null &
  echo $! > "$PID_DIR/counterparty.pid"
fi
t3_wait_for "mailmotpartens kontrollport" 30 curl -fsS -m 3 "http://127.0.0.1:$T3_CONTROL_PORT/health"

# ---- (d) env-fil -------------------------------------------------------------------
STATUS="$(cd "$RUN_DIR" && "$T3_SUPABASE_BIN" status -o env 2>/dev/null)"
sbval() { printf '%s\n' "$STATUS" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -1; }
SB_URL="$(sbval API_URL)"; SB_ANON="$(sbval ANON_KEY)"; SB_SERVICE="$(sbval SERVICE_ROLE_KEY)"
[[ -n "$SB_URL" && -n "$SB_ANON" && -n "$SB_SERVICE" ]] || t3_die "kunde inte läsa Supabase-nycklar via 'supabase status -o env'"
ACTOR_ID=""
[[ -s "$SIM_HOME/fixture.json" ]] && ACTOR_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).actorUserId||"")' "$SIM_HOME/fixture.json")"

write_env() {
  local tmp="$ENV_FILE.tmp"
  cat > "$tmp" <<ENV
# Genererad av scripts/simulation/track3/up.sh. Innehåller lokala hemligheter: committas aldrig.
T3_MODE=$MODE
T3_APP_PORT=$T3_APP_PORT
T3_APP_URL=http://127.0.0.1:$T3_APP_PORT
T3_SMTP_PORT=$T3_SMTP_PORT
T3_IMAP_TLS_PORT=$T3_IMAP_TLS_PORT
T3_IMAP_PLAIN_PORT=$T3_IMAP_PLAIN_PORT
T3_CONTROL_PORT=$T3_CONTROL_PORT
T3_MAILBOX_ADDRESS=$T3_MAILBOX_ADDRESS
T3_IMAP_USER=$T3_IMAP_USER
T3_IMAP_PASS=$IMAP_PASS
T3_SIM_HOME=$SIM_HOME
T3_DB_URL=$T3_DB_URL
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE
NODE_EXTRA_CA_CERTS=$CA/ca.pem
EDIEL_EMAIL_PROVIDER=strato
EDIEL_SMTP_HOST=127.0.0.1
EDIEL_SMTP_PORT=$T3_SMTP_PORT
EDIEL_SMTP_SECURE=true
EDIEL_SMTP_USER=$T3_MAILBOX_ADDRESS
EDIEL_SMTP_PASS=$SMTP_PASS
EDIEL_SMTP_FROM=$T3_MAILBOX_ADDRESS
EDIEL_SHARED_MAILBOX_ADDRESS=$T3_MAILBOX_ADDRESS
EDIEL_MESSAGE_ID_DOMAIN=$T3_MAIL_DOMAIN
EDIEL_IMAP_HOST=127.0.0.1
EDIEL_IMAP_PORT=$T3_IMAP_TLS_PORT
EDIEL_IMAP_USER=$T3_IMAP_USER
EDIEL_IMAP_PASS=$IMAP_PASS
EDIEL_CRON_SECRET=$CRON_SECRET_OUTBOX
EDIEL_INBOUND_CRON_SECRET=$CRON_SECRET_INBOUND
EDIEL_AUTOMATION_ACTOR_USER_ID=$ACTOR_ID
NEXT_TELEMETRY_DISABLED=1
ENV
  chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
}
write_env
t3_log "env-fil skriven (0600): $ENV_FILE"

# ---- fixture-seed (före appstart: aktören måste finnas i EDIEL_AUTOMATION_ACTOR_USER_ID) ----
t3_log "seedar fixture (mode=$MODE)"
( set -a; . "$ENV_FILE"; set +a
  node "$T3_DIR/lib/seed-cli.mjs" --mode "$MODE" --out "$SIM_HOME/fixture.json" ) || t3_die "seed misslyckades"
ACTOR_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).actorUserId||"")' "$SIM_HOME/fixture.json")"
[[ -n "$ACTOR_ID" ]] || t3_die "seed gav ingen actorUserId"
write_env

# ---- (e) bygge + appstart ----------------------------------------------------------
BUILT="$(cat "$SIM_HOME/built-commit" 2>/dev/null || true)"
if [[ "${SKIP_BUILD:-0}" == "1" && "$BUILT" == "$HEAD_SHA" && -d "$RUN_DIR/.next" ]]; then
  t3_log "SKIP_BUILD=1 och built-commit == HEAD: återanvänder bygget"
elif [[ "$BUILT" == "$HEAD_SHA" && -d "$RUN_DIR/.next" && "${FORCE_BUILD:-0}" != "1" ]]; then
  t3_log "built-commit == HEAD: hoppar över bygget (FORCE_BUILD=1 tvingar)"
else
  if t3_pid_alive "$PID_DIR/app.pid"; then kill "$(cat "$PID_DIR/app.pid")" 2>/dev/null || true; sleep 2; fi
  t3_log "next build (kan ta flera minuter) -> $LOG_DIR/build.log"
  rm -f "$SIM_HOME/built-commit"
  ( cd "$RUN_DIR" && set -a && . "$ENV_FILE" && set +a && NODE_OPTIONS="--max-old-space-size=${T3_BUILD_HEAP_MB:-6144}" npm run -s build ) >"$LOG_DIR/build.log" 2>&1 \
    || { tail -30 "$LOG_DIR/build.log" >&2; t3_die "next build misslyckades"; }
  echo "$HEAD_SHA" > "$SIM_HOME/built-commit"
fi

# Appen läser env vid start: starta om om den kör med en annan env-fil (mode/aktör kan ha ändrats).
if t3_pid_alive "$PID_DIR/app.pid"; then
  if [[ "$(cat "$PID_DIR/app.env-sha" 2>/dev/null)" != "$(sha256sum "$ENV_FILE" | cut -d' ' -f1)" ]]; then
    t3_log "env ändrad: startar om appen"
    kill "$(cat "$PID_DIR/app.pid")" 2>/dev/null || true
    for _ in $(seq 1 20); do t3_pid_alive "$PID_DIR/app.pid" || break; sleep 0.5; done
  fi
fi
if ! t3_pid_alive "$PID_DIR/app.pid"; then
  t3_port_open "$T3_APP_PORT" && t3_die "port $T3_APP_PORT är upptagen av annan process"
  t3_log "startar next start på 127.0.0.1:$T3_APP_PORT"
  ( cd "$RUN_DIR" && set -a && . "$ENV_FILE" && set +a && \
    exec setsid nohup node node_modules/next/dist/bin/next start -p "$T3_APP_PORT" -H 127.0.0.1 ) >>"$LOG_DIR/app.log" 2>&1 < /dev/null &
  echo $! > "$PID_DIR/app.pid"
  sha256sum "$ENV_FILE" | cut -d' ' -f1 > "$PID_DIR/app.env-sha"
fi
app_up() { local c; c="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$T3_APP_PORT/" 2>/dev/null || true)"; [[ "$c" =~ ^[1-5][0-9][0-9]$ ]]; }
t3_wait_for "appen på :$T3_APP_PORT" 120 app_up
t3_log "KLAR: app http://127.0.0.1:$T3_APP_PORT, SMTP-motpart 127.0.0.1:$T3_SMTP_PORT, IMAP-TLS 127.0.0.1:$T3_IMAP_TLS_PORT, kontroll :$T3_CONTROL_PORT, mode=$MODE"
