#!/usr/bin/env bash
# Shared shell helpers for the Track 4 (T4) simulation harness. Sourced by up.sh, down.sh, run.sh.
# Everything T4 owns lives under $SIM_HOME; nothing here writes into tracked base files.

T4_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T4_DIR="$(cd "$T4_LIB_DIR/.." && pwd)"
# The run directory is the checkout this harness lives in (scripts/simulation/track4 -> repo root).
APP_DIR="${T4_APP_DIR:-$(cd "$T4_DIR/../../.." && pwd)}"

SIM_HOME="${SIM_HOME:-$HOME/sim-home/track4}"
# Supabase ports (54321 API, 54322 DB, ...) and project_id are fixed per container by supabase/config.toml, which this harness
# never modifies (one stack per container). Only the app's and the counterparties' ports are variables.
T4_PROJECT_ID="$(sed -n 's/^project_id *= *"\(.*\)".*/\1/p' "$APP_DIR/supabase/config.toml" | head -1)"
T4_API_PORT=54321
T4_DB_PORT=54322
T4_APP_PORT="${T4_APP_PORT:-3104}"
T4_SINK_PORT="${T4_SINK_PORT:-3194}"
# Local synthetic mail counterparty (GreenMail): SMTPS / IMAPS / API on loopback-only host ports.
T4_SMTPS_PORT="${T4_SMTPS_PORT:-55425}"
T4_IMAPS_PORT="${T4_IMAPS_PORT:-55426}"
T4_MAIL_API_PORT="${T4_MAIL_API_PORT:-55428}"
T4_MAIL_CONTAINER="${T4_MAIL_CONTAINER:-gx-t4-mail}"
T4_GREENMAIL_IMAGE="${T4_GREENMAIL_IMAGE:-mirror.gcr.io/greenmail/standalone:2.1.3}"
TLS_DIR="$SIM_HOME/tls"

ENV_FILE="$SIM_HOME/env"
LOG_DIR="$SIM_HOME/logs"
PID_DIR="$SIM_HOME/pids"
RUNS_DIR="$SIM_HOME/runs"
# NOT named DB_URL/ROOT/...: scripts/gridex-aud-003-clean-replay.sh is sourced by up.sh and overwrites those names.
T4_DBURL="postgresql://postgres:postgres@127.0.0.1:${T4_DB_PORT}/postgres"

# Supabase CLI is pinned: the replay script requires exactly 2.101.0.
if [ -d "$SIM_HOME/cli/node_modules/.bin" ]; then PATH="$SIM_HOME/cli/node_modules/.bin:$PATH"; fi
export PATH
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-ghcr.io}"

t4_log() { echo "[t4 $(basename "${0:-t4}")] $*"; }
t4_die() { echo "[t4 $(basename "${0:-t4}")] ERROR: $*" >&2; exit 1; }
t4_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
t4_head() { git -C "$APP_DIR" rev-parse HEAD; }
# Commit the stack/schema was replayed from (base of the campaign); used when adopting a hand-made stack.
T4_BASE_COMMIT="${T4_BASE_COMMIT:-1c0c088cb4ed66d0dd8b3e34c9606019342a1a56}"
# True when $1 (a commit sha) is HEAD, or HEAD differs from it only under scripts/simulation/track4/ (harness-only
# commits do not change the app or the schema, so the replay/build of $1 is still valid).
t4_same_app() {
  local from="$1" head changed
  [ -n "$from" ] || return 1
  head="$(t4_head)"
  [ "$from" = "$head" ] && return 0
  changed="$(git -C "$APP_DIR" diff --name-only "$from" "$head" 2>/dev/null)" || return 1
  [ -z "$(printf '%s\n' "$changed" | grep -v -e '^$' -e '^scripts/simulation/track4/')" ]
}

t4_init() {
  mkdir -p "$SIM_HOME" "$LOG_DIR" "$PID_DIR" "$RUNS_DIR"
  export T4_PROJECT_ID
  chmod 700 "$SIM_HOME" 2>/dev/null || true
}

t4_port_open() { (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
t4_wait_port() {
  local port="$1" tries="${2:-90}"
  for _ in $(seq 1 "$tries"); do t4_port_open "$port" && return 0; sleep 1; done
  return 1
}

# True when the replayed schema is present in the T4 database.
t4_db_ready() {
  [ "$(PGCONNECT_TIMEOUT=3 psql "$T4_DBURL" -X -At -c "select to_regclass('public.companies') is not null" 2>/dev/null || true)" = "t" ]
}

t4_load_env() {
  [ -f "$ENV_FILE" ] || t4_die "missing $ENV_FILE (run up.sh first)"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

# Local-only guard: the harness refuses to run against anything but the T4 loopback ports.
t4_assert_local() {
  case "${NEXT_PUBLIC_SUPABASE_URL:-}" in
    "http://127.0.0.1:${T4_API_PORT}") ;;
    *) t4_die "refusing: NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-<unset>} is not http://127.0.0.1:${T4_API_PORT}" ;;
  esac
}

t4_pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# ---- local CA + GreenMail --------------------------------------------------------------------------------
# Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426, scripts/reality/up.sh steps 1 and 3
# (local CA, GreenMail with TLS keystore, combined CA for Node, mailbox claim); ports, container name and paths are T4's.
# Pitfalls from that runbook: the app must trust the CA (NODE_EXTRA_CA_CERTS), and GreenMail pins an account's password at
# its first login, so the shared mailboxes are claimed with the app's own credentials before anything else uses them.
t4_tls_prepare() {
  mkdir -p "$TLS_DIR"
  if [ ! -f "$TLS_DIR/srv.p12" ]; then
    t4_log "creating local CA and mail server certificate"
    ( cd "$TLS_DIR" && \
      openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj '/CN=Gridex T4 Local CA' 2>/dev/null && \
      openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj '/CN=localhost' 2>/dev/null && \
      printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > ext.cnf && \
      openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 30 -extfile ext.cnf 2>/dev/null && \
      openssl pkcs12 -export -in srv.pem -inkey srv.key -certfile ca.pem -out srv.p12 -passout pass:t4livetest -name greenmail && \
      chmod 644 ./* ) || t4_die "TLS material creation failed"
  fi
  cat "$TLS_DIR/ca.pem" > "$TLS_DIR/combined-ca.pem"
  for proxy_ca in /root/.ccr/ca-bundle.crt "${SSL_CERT_FILE:-}"; do
    [ -n "$proxy_ca" ] && [ -f "$proxy_ca" ] && cat "$proxy_ca" >> "$TLS_DIR/combined-ca.pem"
  done
  return 0
}

t4_mail_running() { docker ps --format '{{.Names}}' | grep -qx "$T4_MAIL_CONTAINER"; }

t4_mail_up() {
  t4_tls_prepare
  # A running GreenMail with another TLS directory would not be trusted by the app: recreate it.
  if t4_mail_running && [ "$(docker inspect "$T4_MAIL_CONTAINER" --format '{{range .Mounts}}{{.Source}}{{end}}' 2>/dev/null)" = "$TLS_DIR" ]; then
    t4_log "GreenMail already running ($T4_MAIL_CONTAINER)"
  else
    docker rm -f "$T4_MAIL_CONTAINER" >/dev/null 2>&1 || true
    t4_log "starting GreenMail ($T4_GREENMAIL_IMAGE) SMTPS $T4_SMTPS_PORT IMAPS $T4_IMAPS_PORT API $T4_MAIL_API_PORT"
    docker run -d --name "$T4_MAIL_CONTAINER" -v "$TLS_DIR:/tls:ro" \
      -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled -Dgreenmail.tls.keystore.file=/tls/srv.p12 -Dgreenmail.tls.keystore.password=t4livetest -Dgreenmail.tls.key.password=t4livetest' \
      -p "127.0.0.1:${T4_SMTPS_PORT}:3465" -p "127.0.0.1:${T4_IMAPS_PORT}:3993" -p "127.0.0.1:${T4_MAIL_API_PORT}:8080" \
      "$T4_GREENMAIL_IMAGE" >/dev/null || t4_die "could not start GreenMail"
  fi
  t4_mail_ready 120 || t4_die "GreenMail did not answer a TLS IMAP/SMTP greeting (docker logs $T4_MAIL_CONTAINER)"
  # record the exact image the counterparty runs on
  { echo "image=$T4_GREENMAIL_IMAGE"; echo "digest=$(docker image inspect "$T4_GREENMAIL_IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo unknown)"; echo "id=$(docker image inspect "$T4_GREENMAIL_IMAGE" --format '{{.Id}}' 2>/dev/null || echo unknown)"; } > "$SIM_HOME/mail-image.txt"
}

# The docker proxy accepts the port before GreenMail's Java listeners are up: wait for real TLS greetings (IMAPS and SMTPS).
t4_mail_ready() {
  python3 - "$TLS_DIR/ca.pem" "$T4_IMAPS_PORT" "$T4_SMTPS_PORT" "${1:-120}" <<'PY'
import imaplib, smtplib, ssl, sys, time
ca, imap_port, smtp_port, timeout = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
ctx = ssl.create_default_context(cafile=ca)
ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)
deadline = time.time() + timeout
while True:
    try:
        imaplib.IMAP4_SSL('localhost', imap_port, ssl_context=ctx, timeout=5).logout()
        with smtplib.SMTP_SSL('localhost', smtp_port, context=ctx, timeout=5) as s: s.noop()
        sys.exit(0)
    except Exception as e:
        if time.time() > deadline:
            print(f'[t4] mail not ready: {type(e).__name__}: {e}', file=sys.stderr); sys.exit(1)
        time.sleep(2)
PY
}

# Claim both shared Ediel mailboxes with the app's own credentials (needs the env loaded).
t4_mail_claim() {
  python3 - "$TLS_DIR/ca.pem" "$T4_IMAPS_PORT" "$T4_SMTPS_PORT" <<'PY'
import imaplib, os, smtplib, ssl, sys
ca, imap_port, smtp_port = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ctx = ssl.create_default_context(cafile=ca)
ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)  # the local CA has no key-usage extension
for box, pw in ((os.environ['GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL'], os.environ['GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS']),
                (os.environ['GRIDEX_SHARED_EDIEL_TEST_EMAIL'], os.environ['GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS'])):
    imap = imaplib.IMAP4_SSL('localhost', imap_port, ssl_context=ctx); imap.login(box, pw); imap.logout()
    with smtplib.SMTP_SSL('localhost', smtp_port, context=ctx) as smtp: smtp.login(box, pw)
    print(f'[t4] mailbox {box} claimed with the app credentials')
PY
}

# ---- run lock ----------------------------------------------------------------------------------------------
# SIM_HOME/run.lock is created atomically (noclobber) with PID and start time and removed on exit. An existing lock is never
# taken over here: a stale one (dead PID, or PID/start time not matching a live process) is removed only by sim-runner.
t4_lock_acquire() {
  local lock="$SIM_HOME/run.lock" started
  started="$(awk '{print $22}' "/proc/$$/stat" 2>/dev/null || echo 0)"
  if ! ( set -o noclobber; printf 'pid=%s\nstarted=%s\nproc_start_ticks=%s\ncommand=%s\n' "$$" "$(t4_now)" "$started" "$(basename "$0") $*" > "$lock" ) 2>/dev/null; then
    echo "[t4] refusing: $lock exists ($(tr '\n' ' ' < "$lock" 2>/dev/null))" >&2
    return 1
  fi
  T4_LOCK_OWNER_PID="$$"
  trap t4_lock_release EXIT
}
t4_lock_release() {
  local lock="$SIM_HOME/run.lock"
  [ "${T4_LOCK_OWNER_PID:-}" = "$$" ] && [ -f "$lock" ] && grep -qx "pid=$$" "$lock" && rm -f "$lock"
  return 0
}
