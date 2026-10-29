#!/usr/bin/env bash
# Gemensam shell-hjälp för up.sh / down.sh / run.sh (källas, körs ej direkt).
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM_HOME="${SIM_HOME:-/root/sim-home/track5}"
RUN_DIR="${RUN_DIR:-/root/sim/track5}"
mkdir -p "$SIM_HOME" "$SIM_HOME/logs" "$SIM_HOME/pids" "$SIM_HOME/reports"
chmod 700 "$SIM_HOME"

# Effektiva portar: miljövariabler > SIM_HOME/ports.env (skriven av tidigare up.sh) > default.
if [[ -f "$SIM_HOME/ports.env" ]]; then
  # shellcheck disable=SC1091
  . "$SIM_HOME/ports.env"
fi
SIM_PROJECT_ID="${SIM_PROJECT_ID:-gridex-ops-platform}"
SIM_API_PORT="${SIM_API_PORT:-54321}"
SIM_DB_PORT="${SIM_DB_PORT:-54322}"
SIM_SHADOW_PORT="${SIM_SHADOW_PORT:-54320}"
SIM_POOLER_PORT="${SIM_POOLER_PORT:-54329}"
SIM_STUDIO_PORT="${SIM_STUDIO_PORT:-54323}"
SIM_MAIL_HTTP_PORT="${SIM_MAIL_HTTP_PORT:-54324}"
SIM_SMTP_PORT="${SIM_SMTP_PORT:-54325}"
SIM_APP_PORT="${SIM_APP_PORT:-3105}"
SIM_COUNTERPART_PORT="${SIM_COUNTERPART_PORT:-3195}"

# Docker Hub (429) och ECR (data limit) fungerar inte; ghcr.io/supabase/* gör det.
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-ghcr.io}"
export SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NEXT_TELEMETRY_DISABLED=1

# Privat kopia av scripts/ + supabase/ (replayskriptet muterar migrations/, seed.sql,
# .temp/ och e2e-artifacts/; RUN_DIR ska vara orört). Supabase-CLI körs härifrån.
REPLAY_ROOT="$SIM_HOME/replay-root"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "FEL: $*"; exit 1; }

sb() { (cd "$REPLAY_ROOT" && supabase "$@"); }

app_pid_alive() {
  [[ -f "$SIM_HOME/pids/app.pid" ]] && kill -0 "$(cat "$SIM_HOME/pids/app.pid")" 2>/dev/null
}

# Utanför repot finns ingen node_modules i föräldrakedjan; länka RUN_DIR:s (ignoreras av git).
ensure_node_modules() {
  if [[ ! -e "$HARNESS_DIR/node_modules" ]] && ! (cd "$HARNESS_DIR" && node -e "require.resolve('vitest/package.json')" >/dev/null 2>&1); then
    ln -s "$RUN_DIR/node_modules" "$HARNESS_DIR/node_modules"
  fi
}
