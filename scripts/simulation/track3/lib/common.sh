#!/usr/bin/env bash
# Gemensamma variabler och hjälpfunktioner för spår 3-harnessen. Sourcas av up.sh/down.sh/run.sh.
# Inga hemligheter här. Allt tillstånd ligger under SIM_HOME.

T3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Körkatalogen med appens kod (HEAD = kampanjens applikationsbas) och node_modules.
RUN_DIR="${SIM_RUN_DIR:-/root/sim-run/track3}"
SIM_HOME="${SIM_HOME:-/home/user/sim-home/track3}"

# Egna portar (kan ändras via variabler).
T3_APP_PORT="${T3_APP_PORT:-3103}"
T3_SMTP_PORT="${T3_SMTP_PORT:-3125}"
T3_IMAP_TLS_PORT="${T3_IMAP_TLS_PORT:-3993}"
T3_IMAP_PLAIN_PORT="${T3_IMAP_PLAIN_PORT:-3143}"
T3_CONTROL_PORT="${T3_CONTROL_PORT:-3199}"
T3_SUPABASE_API_PORT="${T3_SUPABASE_API_PORT:-54321}"
T3_SUPABASE_DB_PORT="${T3_SUPABASE_DB_PORT:-54322}"
T3_GREENMAIL_IMAGE="${T3_GREENMAIL_IMAGE:-greenmail/standalone:2.1.8}"
T3_GREENMAIL_NAME="${T3_GREENMAIL_NAME:-t3sim-greenmail}"
T3_MAIL_DOMAIN="t3.sim.invalid"
T3_MAILBOX_ADDRESS="ediel@${T3_MAIL_DOMAIN}"
T3_IMAP_USER="ediel"
T3_DB_URL="postgresql://postgres:postgres@127.0.0.1:${T3_SUPABASE_DB_PORT}/postgres"
T3_SUPABASE_BIN="${T3_SUPABASE_BIN:-/opt/node22/bin/supabase}"

ENV_FILE="$SIM_HOME/env/track3.env"
PID_DIR="$SIM_HOME/pids"
LOG_DIR="$SIM_HOME/logs"

t3_log() { printf '[track3 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
t3_die() { t3_log "FEL: $*" >&2; exit 1; }
t3_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

t3_port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

t3_wait_for() { # <beskrivning> <timeout-s> <kommando...>
  local what="$1" timeout="$2"; shift 2
  local end=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if (( SECONDS >= end )); then t3_die "timeout (${timeout}s) väntar på $what"; fi
    sleep 1
  done
}

t3_stack_ok() {
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${T3_SUPABASE_API_PORT}/auth/v1/health" -H "apikey: x" 2>/dev/null || \
    curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${T3_SUPABASE_API_PORT}/auth/v1/health" 2>/dev/null | grep -qE '^(200|401)$'
}

# Läs ett pid ur pidfil om processen lever.
t3_pid_alive() { local f="$1"; [[ -s "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; }

t3_load_env() { # sourca env-filen (kräver att up.sh har körts)
  [[ -r "$ENV_FILE" ]] || t3_die "saknar $ENV_FILE (kör up.sh först)"
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a
}
