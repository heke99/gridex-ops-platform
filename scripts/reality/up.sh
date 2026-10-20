#!/usr/bin/env bash
# Starts the production-simulating world from nothing (docs/testing/verklighetssimulering-runbook.md):
#   1. local CA + GreenMail (SMTPS 3465 / IMAPS 3993) as the Ediel and customer mail servers
#   2. clean canonical migration replay into an owned local Supabase, kept running
#   3. app environment (local keys from `supabase status`, random local secrets, simulator URLs)
#   4. automation user, `next build` + `next start` on 127.0.0.1:3100
#   5. simulators: external world (spot, Resend, papapi, Lantmäteriet) on 3901,
#      Ediel certificate directory (LDAP 3389, control 3902)
# Idempotent per step; `SKIP_REPLAY=1` reuses a running stack, `SKIP_BUILD=1` reuses the build.
# Local only: refuses to run against anything but 127.0.0.1:54321. No production data, no real addresses.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${REALITY_HOME:-/tmp/gridex-reality}"
TLS="$HOME_DIR/tls"
ENV_FILE="$HOME_DIR/app.env"
APP_PORT=3100
cd "$ROOT"
mkdir -p "$TLS" "$HOME_DIR/logs"
log(){ echo "[reality-up] $*"; }
wait_port(){ for _ in $(seq 1 "${2:-90}"); do (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done; echo "port $1 did not open" >&2; return 1; }

# 1) Local CA and GreenMail with TLS. Node trusts the CA through NODE_EXTRA_CA_CERTS; when an
#    HTTPS proxy CA is present (sandboxed agents) it is combined so outbound HTTPS keeps working.
if [ ! -f "$TLS/srv.p12" ]; then
  log "creating local CA and mail server certificate"
  ( cd "$TLS"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj '/CN=Gridex Reality Local CA' 2>/dev/null
    openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj '/CN=localhost' 2>/dev/null
    printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > ext.cnf
    openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 30 -extfile ext.cnf 2>/dev/null
    openssl pkcs12 -export -in srv.pem -inkey srv.key -certfile ca.pem -out srv.p12 -passout pass:livetest -name greenmail
    chmod 644 ./* )
fi
cat "$TLS/ca.pem" > "$TLS/combined-ca.pem"
for proxy_ca in /root/.ccr/ca-bundle.crt "${SSL_CERT_FILE:-}"; do [ -n "$proxy_ca" ] && [ -f "$proxy_ca" ] && cat "$proxy_ca" >> "$TLS/combined-ca.pem"; done
# A running GreenMail with another CA would not be trusted by the app: recreate it on this world's TLS.
if [ "$(docker inspect gx-mail --format '{{range .Mounts}}{{.Source}}{{end}}' 2>/dev/null)" != "$TLS" ] || ! docker ps --format '{{.Names}}' | grep -qx gx-mail; then
  log "starting GreenMail"
  docker rm -f gx-mail >/dev/null 2>&1 || true
  docker run -d --name gx-mail -v "$TLS:/tls:ro" \
    -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled -Dgreenmail.tls.keystore.file=/tls/srv.p12 -Dgreenmail.tls.keystore.password=livetest -Dgreenmail.tls.key.password=livetest' \
    -p 3025:3025 -p 3143:3143 -p 3465:3465 -p 3993:3993 -p 8080:8080 greenmail/standalone:2.1.3 >/dev/null
fi
wait_port 3465; wait_port 3993

# 2) Clean replay of the canonical migration history, keeping the stack up afterwards.
if [ "${SKIP_REPLAY:-0}" != "1" ]; then
  log "clean migration replay (several minutes)"
  supabase stop --no-backup >/dev/null 2>&1 || true
  # The replay script stops the stack in its EXIT trap; run it in this shell, then restore the
  # migration inputs (cleanup) without stopping the stack, and drop the trap.
  set +u
  # shellcheck disable=SC1091
  source scripts/gridex-aud-003-clean-replay.sh > "$HOME_DIR/logs/replay.log" 2>&1
  LOCAL_STACK_START_ATTEMPTED=0; cleanup; trap - EXIT
  set -u
fi
supabase status -o json > "$HOME_DIR/status.json"
python3 - "$HOME_DIR/status.json" <<'PY'
import json,sys
if json.load(open(sys.argv[1])).get('API_URL') != 'http://127.0.0.1:54321': raise SystemExit('reality world is local-only')
PY

# 3) App environment. Keys come from the local stack; secrets are random per world.
if [ ! -f "$ENV_FILE" ]; then
  log "writing app environment"
  python3 - "$HOME_DIR" "$(python3 -c 'import uuid;print(uuid.uuid4())')" <<'PY'
import json,secrets,sys
home,auto=sys.argv[1:]
st=json.load(open(home+'/status.json'))
mailbox='gridex-ediel-test@example.invalid'
env={
 'NEXT_PUBLIC_SUPABASE_URL':st['API_URL'],'NEXT_PUBLIC_SUPABASE_ANON_KEY':st['ANON_KEY'],'SUPABASE_SERVICE_ROLE_KEY':st['SERVICE_ROLE_KEY'],
 'CRON_SECRET':(cron:=secrets.token_hex(24)),'EDIEL_INBOUND_CRON_SECRET':cron,'WEBSITE_OFFER_REFERENCE_SECRET':secrets.token_hex(24),
 'GRIDEX_AUTOMATION_USER_ID':auto,'EDIEL_AUTOMATION_ACTOR_USER_ID':auto,
 'NEXT_PUBLIC_SITE_URL':'http://127.0.0.1:3100','NEXT_TELEMETRY_DISABLED':'1',
 'EDIEL_SMTP_HOST':'localhost','EDIEL_SMTP_PORT':'3465','EDIEL_SMTP_SECURE':'true','EDIEL_SMTP_USER':mailbox,'EDIEL_SMTP_PASS':(mail:=secrets.token_hex(12)),'EDIEL_SMTP_FROM':mailbox,
 'GRIDEX_SHARED_EDIEL_TEST_EMAIL':mailbox,'GRIDEX_SHARED_EDIEL_TEST_IMAP_HOST':'localhost','GRIDEX_SHARED_EDIEL_TEST_IMAP_PORT':'3993','GRIDEX_SHARED_EDIEL_TEST_IMAP_SECURE':'true',
 'GRIDEX_SHARED_EDIEL_TEST_IMAP_USERNAME':mailbox,'GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS':mail,
 'GRIDEX_SHARED_EDIEL_TEST_SMTP_HOST':'localhost','GRIDEX_SHARED_EDIEL_TEST_SMTP_PORT':'3465','GRIDEX_SHARED_EDIEL_TEST_SMTP_FROM':mailbox,
 'GRIDEX_MANUAL_OPERATIONS_MAILBOX_PASS':mail,
 'NODE_EXTRA_CA_CERTS':home+'/tls/combined-ca.pem',
 # Every third party is a local simulator; nothing leaves the machine.
 'ELPRISETJUSTNU_BASE_URL':'http://127.0.0.1:3901','RESEND_BASE_URL':'http://127.0.0.1:3901','RESEND_API_KEY':'re_reality_simulator',
 'PAPILITE_GEOCODE_URL':'http://127.0.0.1:3901/papapi/lite/','PAPILITE_API_KEY':'reality-simulator',
 'LANTMATERIET_BELAGENHETSADRESS_BASE_URL':'http://127.0.0.1:3901/lantmateriet','LANTMATERIET_BELAGENHETSADRESS_USERNAME':'reality','LANTMATERIET_BELAGENHETSADRESS_PASSWORD':'reality',
 'EDIEL_EXPISOFT_LDAP_HOST':'127.0.0.1','EDIEL_EXPISOFT_LDAP_PORT':'3389','EDIEL_EXPISOFT_LDAP_TIMEOUT_MS':'5000',
}
open(home+'/app.env','w').write(''.join(f'{k}={v}\n' for k,v in env.items()))
PY
  chmod 600 "$ENV_FILE"
fi
set -a; # shellcheck disable=SC1090
. "$ENV_FILE"; set +a

# 4) Automation user through the Auth admin API (GoTrue does not see raw auth.users inserts), its
#    staff profile, then build and start the app.
AUTH=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
if ! curl -sf "${AUTH[@]}" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users/$GRIDEX_AUTOMATION_USER_ID" >/dev/null; then
  curl -sf "${AUTH[@]}" -H 'content-type: application/json' -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
    -d "{\"id\":\"$GRIDEX_AUTOMATION_USER_ID\",\"email\":\"gridex-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid\",\"email_confirm\":true}" >/dev/null
fi
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -X -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('$GRIDEX_AUTOMATION_USER_ID','gridex-automation-$GRIDEX_AUTOMATION_USER_ID@example.invalid','Gridex automation (reality)','active')
ON CONFLICT (id) DO UPDATE SET user_status='active';
SQL
fuser -k "$APP_PORT/tcp" >/dev/null 2>&1 || true
if [ "${SKIP_BUILD:-0}" != "1" ]; then log "next build"; npx next build > "$HOME_DIR/logs/next-build.log" 2>&1; fi
log "next start on 127.0.0.1:$APP_PORT"
setsid nohup npx next start -H 127.0.0.1 -p "$APP_PORT" > "$HOME_DIR/logs/next-start.log" 2>&1 < /dev/null &
for _ in $(seq 1 120); do curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/login" 2>/dev/null | grep -q 200 && break; sleep 2; done

# 5) Simulators, each in its own session so a test run can never kill them by accident.
fuser -k 3901/tcp 3389/tcp 3902/tcp >/dev/null 2>&1 || true
setsid nohup env REALITY_WORLD_PORT=3901 npx tsx scripts/reality/simulators/externalWorld.ts > "$HOME_DIR/logs/world.log" 2>&1 < /dev/null &
setsid nohup npx tsx scripts/reality/simulators/certificateDirectory.ts > "$HOME_DIR/logs/ldap.log" 2>&1 < /dev/null &
wait_port 3901; wait_port 3902
log "ready: app http://127.0.0.1:$APP_PORT, env $ENV_FILE, logs $HOME_DIR/logs"
