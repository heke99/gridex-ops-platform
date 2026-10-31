#!/usr/bin/env bash
# Gemensamma variabler och hjälpfunktioner för spår 6-harnessen. Sourcas av up.sh/down.sh/run.sh.
# Inga hemligheter här. Allt tillstånd ligger under SIM_HOME.

T6_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Körkatalogen med appens kod (HEAD = kampanjens applikationsbas) och node_modules.
RUN_DIR="${SIM_RUN_DIR:-/root/sim-run/track6}"
SIM_HOME="${SIM_HOME:-/home/user/sim-home/track6}"

# Egna portar (kan ändras via variabler).
T6_APP_PORT="${T6_APP_PORT:-3106}"
T6_SMTP_PORT="${T6_SMTP_PORT:-3625}"
T6_IMAP_TLS_PORT="${T6_IMAP_TLS_PORT:-3693}"
T6_IMAP_PLAIN_PORT="${T6_IMAP_PLAIN_PORT:-3643}"
T6_CONTROL_PORT="${T6_CONTROL_PORT:-3699}"
T6_SUPABASE_API_PORT="${T6_SUPABASE_API_PORT:-54321}"
T6_SUPABASE_DB_PORT="${T6_SUPABASE_DB_PORT:-54322}"
T6_GREENMAIL_IMAGE="${T6_GREENMAIL_IMAGE:-greenmail/standalone:2.1.8}"
T6_GREENMAIL_NAME="${T6_GREENMAIL_NAME:-t6sim-greenmail}"
T6_MAIL_DOMAIN="t6.sim.invalid"
T6_MAILBOX_ADDRESS="ediel@${T6_MAIL_DOMAIN}"
T6_IMAP_USER="ediel"
T6_DB_URL="postgresql://postgres:postgres@127.0.0.1:${T6_SUPABASE_DB_PORT}/postgres"
# Supabase CLI: replayskriptet kräver exakt 2.101.0 (scripts/gridex-aud-003-clean-replay.sh, local_storage_official_cli_version_unknown).
T6_SUPABASE_VERSION="${T6_SUPABASE_VERSION:-2.101.0}"
T6_SUPABASE_BIN="${T6_SUPABASE_BIN:-}"
if [[ -z "$T6_SUPABASE_BIN" ]]; then
  if [[ -x /opt/node22/bin/supabase ]]; then T6_SUPABASE_BIN=/opt/node22/bin/supabase
  else T6_SUPABASE_BIN="$SIM_HOME/tools/node_modules/.bin/supabase"; fi
fi

ENV_FILE="$SIM_HOME/env/track6.env"
PID_DIR="$SIM_HOME/pids"
LOG_DIR="$SIM_HOME/logs"

t6_log() { printf '[track6 %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
t6_die() { t6_log "FEL: $*" >&2; exit 1; }
t6_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

t6_port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

t6_wait_for() { # <beskrivning> <timeout-s> <kommando...>
  local what="$1" timeout="$2"; shift 2
  local end=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if (( SECONDS >= end )); then t6_die "timeout (${timeout}s) väntar på $what"; fi
    sleep 1
  done
}

t6_stack_ok() {
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${T6_SUPABASE_API_PORT}/auth/v1/health" -H "apikey: x" 2>/dev/null || \
    curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${T6_SUPABASE_API_PORT}/auth/v1/health" 2>/dev/null | grep -qE '^(200|401)$'
}

# Läs ett pid ur pidfil om processen lever.
t6_pid_alive() { local f="$1"; [[ -s "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; }

t6_load_env() { # sourca env-filen (kräver att up.sh har körts)
  [[ -r "$ENV_FILE" ]] || t6_die "saknar $ENV_FILE (kör up.sh först)"
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a
}

# ---- docker + supabase CLI (idempotent; markerar bara det up.sh själv startade/installerade) ----
t6_ensure_docker() {
  if docker info >/dev/null 2>&1; then t6_log "docker-daemonen svarar redan"; return 0; fi
  command -v dockerd >/dev/null 2>&1 || t6_die "docker svarar inte och dockerd saknas i PATH"
  if t6_pid_alive "$PID_DIR/dockerd.pid"; then t6_log "dockerd (pid $(cat "$PID_DIR/dockerd.pid")) startad tidigare, väntar"
  else
    t6_log "docker info misslyckades -> startar dockerd i bakgrunden (logg: $LOG_DIR/dockerd.log)"
    # shellcheck disable=SC2086
    setsid nohup dockerd ${T6_DOCKERD_ARGS:-} >>"$LOG_DIR/dockerd.log" 2>&1 < /dev/null &
    echo $! > "$PID_DIR/dockerd.pid"
  fi
  t6_wait_for "docker-daemonen (se $LOG_DIR/dockerd.log)" 90 docker info
}

t6_ensure_supabase() {
  if [[ -x "$T6_SUPABASE_BIN" && "$("$T6_SUPABASE_BIN" --version 2>/dev/null | tr -d '[:space:]')" == "$T6_SUPABASE_VERSION" ]]; then return 0; fi
  [[ "$T6_SUPABASE_BIN" == "$SIM_HOME/tools/"* ]] || t6_die "supabase CLI $T6_SUPABASE_BIN saknas eller är inte $T6_SUPABASE_VERSION"
  t6_log "installerar supabase@$T6_SUPABASE_VERSION i $SIM_HOME/tools (npm, pinnad version)"
  mkdir -p "$SIM_HOME/tools"
  ( cd "$SIM_HOME/tools" && npm install --no-audit --no-fund --no-save --prefix . "supabase@$T6_SUPABASE_VERSION" ) >"$LOG_DIR/supabase-install.log" 2>&1 \
    || t6_die "npm install supabase@$T6_SUPABASE_VERSION misslyckades (se $LOG_DIR/supabase-install.log)"
  [[ "$("$T6_SUPABASE_BIN" --version 2>/dev/null | tr -d '[:space:]')" == "$T6_SUPABASE_VERSION" ]] || t6_die "installerad supabase CLI har fel version"
}
