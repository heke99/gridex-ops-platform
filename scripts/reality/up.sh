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
 # The world simulates production: manual grid-owner mail uses the production manual-operations mailbox.
 'GRIDEX_MANUAL_OPS_ENVIRONMENT':'production',
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
# The release the app runs, as Vercel provides VERCEL_GIT_COMMIT_SHA per deploy: production Ediel sends are refused
# without it (ediel_release_sha_unavailable, lib/ediel/scopedCapabilityReadiness.ts). Follows the checkout on every run.
python3 - "$ENV_FILE" "$(git -C "$ROOT" rev-parse HEAD)" <<'PY'
import sys
path,sha=sys.argv[1:]
lines=[l for l in open(path).read().splitlines() if not l.startswith('GIT_COMMIT_SHA=')]
open(path,'w').write('\n'.join(lines+['GIT_COMMIT_SHA='+sha])+'\n')
PY
# The shared production Ediel mailbox (FINDINGS T7): grid owners answer a production file to it and the platform
# stores what arrives there in the production lane. Staff point the production row at it in /admin/inbound-mail
# (scripts/helpers/reality/productionMailbox.ts); only the address and the IMAP secret live here. Added to an
# existing world as well. GreenMail accepts any password; the value is random per world.
python3 - "$ENV_FILE" <<'PY'
import secrets,sys
path=sys.argv[1]
lines=open(path).read().splitlines()
keys={l.split('=',1)[0] for l in lines if '=' in l}
extra={'GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL':'gridex-ediel@example.invalid','GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS':secrets.token_hex(12)}
open(path,'w').write('\n'.join(lines+[f'{k}={v}' for k,v in extra.items() if k not in keys])+'\n')
PY
# The one Ediel SMTP account. Production has a single EDIEL_SMTP_* account, and its address is the shared production
# mailbox; the technical ACK route selector only answers a file from the mailbox it arrived in
# (originalMailboxSmtpAddress = EDIEL_SMTP_FROM). REALITY_EDIEL_LANE=test points the account at the test mailbox for
# scenarios that run in the test lane; the default mirrors production. Applied on every start (needs an app restart).
python3 - "$ENV_FILE" "${REALITY_EDIEL_LANE:-production}" <<'PY'
import sys
path,lane=sys.argv[1:]
lines=open(path).read().splitlines()
env=dict(l.split('=',1) for l in lines if '=' in l)
box=env['GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL'] if lane=='production' else env['GRIDEX_SHARED_EDIEL_TEST_EMAIL']
# GreenMail (auth disabled) pins an account's password at its first login, so the SMTP account must use the same
# password as the IMAP poller of the same mailbox; otherwise sends fail with 535 once the poller logs in first (T51).
pw=env['GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS'] if lane=='production' else env['GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS']
lines=[l for l in lines if not l.startswith(('EDIEL_SMTP_USER=','EDIEL_SMTP_FROM=','EDIEL_SMTP_PASS='))]
open(path,'w').write('\n'.join(lines+['EDIEL_SMTP_USER='+box,'EDIEL_SMTP_FROM='+box,'EDIEL_SMTP_PASS='+pw])+'\n')
PY
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
# The type check needs more than the default 2 GB heap; a failed build must stop here, never start an old or empty one.
if [ "${SKIP_BUILD:-0}" != "1" ]; then log "next build"; rm -f .next/BUILD_ID
  NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192" npx next build > "$HOME_DIR/logs/next-build.log" 2>&1 || true; fi
[ -s .next/BUILD_ID ] || { log "next build failed: see $HOME_DIR/logs/next-build.log"; exit 1; }
log "next start on 127.0.0.1:$APP_PORT"
setsid nohup npx next start -H 127.0.0.1 -p "$APP_PORT" > "$HOME_DIR/logs/next-start.log" 2>&1 < /dev/null &
APP_UP=0; for _ in $(seq 1 120); do curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/login" 2>/dev/null | grep -q 200 && { APP_UP=1; break; }; sleep 2; done
[ "$APP_UP" = 1 ] || { log "next start did not answer on $APP_PORT: see $HOME_DIR/logs/next-start.log"; exit 1; }

# 5) Simulators, each in its own session so a test run can never kill them by accident.
fuser -k 3901/tcp 3389/tcp 3902/tcp >/dev/null 2>&1 || true
setsid nohup env REALITY_WORLD_PORT=3901 REALITY_SPOT_SOURCE="${REALITY_SPOT_SOURCE:-real}" npx tsx scripts/reality/simulators/externalWorld.ts > "$HOME_DIR/logs/world.log" 2>&1 < /dev/null &
setsid nohup npx tsx scripts/reality/simulators/certificateDirectory.ts > "$HOME_DIR/logs/ldap.log" 2>&1 < /dev/null &
wait_port 3901; wait_port 3902
# SVK's grid-area service, simulated when the network denies it (FINDINGS T26): the platform accepts only that exact
# origin, so the host points to 127.0.0.1 and a local TLS server answers with a certificate from this world's CA.
if [ "${REALITY_SVK_SOURCE:-real}" = "simulated" ]; then
  if [ ! -f "$TLS/svk.pem" ]; then
    ( cd "$TLS"
      openssl req -newkey rsa:2048 -nodes -keyout svk.key -out svk.csr -subj '/CN=services2.arcgis.com' 2>/dev/null
      printf 'subjectAltName=DNS:services2.arcgis.com\n' > svk.cnf
      openssl x509 -req -in svk.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out svk.pem -days 30 -extfile svk.cnf 2>/dev/null
      chmod 644 svk.* )
  fi
  grep -q ' services2.arcgis.com$' /etc/hosts || echo '127.0.0.1 services2.arcgis.com' >> /etc/hosts
  fuser -k 443/tcp >/dev/null 2>&1 || true
  setsid nohup env REALITY_TLS_DIR="$TLS" npx tsx scripts/reality/simulators/svkArcgis.ts > "$HOME_DIR/logs/svk.log" 2>&1 < /dev/null &
  wait_port 443
  log "SVK grid areas simulated on https://services2.arcgis.com (127.0.0.1)"
fi
log "ready: app http://127.0.0.1:$APP_PORT, env $ENV_FILE, logs $HOME_DIR/logs"
