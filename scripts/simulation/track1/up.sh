#!/usr/bin/env bash
# Start track 1's own isolated stack: clean replay of the campaign base
# migrations into a fresh local Supabase, then build and start the app from
# the unchanged base. Writes a public-safe stack.json and a private env file.
# Usage: up.sh            (one stack per container; refuses if one is running)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

command -v docker >/dev/null && docker info >/dev/null 2>&1 || die "docker daemon not reachable"
command -v supabase >/dev/null || die "supabase CLI missing"
# The 2.x CLI is a shim that forwards to a co-located supabase-go binary.
command -v supabase-go >/dev/null || [[ -n "${SUPABASE_GO_BINARY:-}" ]] || die "supabase-go missing next to the CLI shim"
[[ "$(cd /tmp && supabase --version)" == "2.101.0" ]] || die "supabase CLI must be 2.101.0 (clean replay pin)"
app_tree_clean || die "app dir has local changes"
SKIP_REPLAY="${SKIP_REPLAY:-0}"; SKIP_BUILD="${SKIP_BUILD:-0}"
acquire_lock
APP_HEAD="$(git -C "$TRACK1_APP_DIR" rev-parse HEAD)"
STARTED="$(utc)"
T0=$(date +%s)
REPLAY_SECONDS=0; BUILD_SECONDS=0
# public.ecr.aws (CLI default) answers "Data limit exceeded" from this
# container; the same tags are published on Docker Hub. Digests are recorded.
export INTERNAL_IMAGE_REGISTRY="${TRACK1_IMAGE_REGISTRY:-docker.io}"
export SUPABASE_INTERNAL_IMAGE_REGISTRY="$INTERNAL_IMAGE_REGISTRY"

if [[ "$SKIP_REPLAY" == 1 ]]; then
  # Reuse the running stack and its environment directory.
  ENV_DIR="$(current_env_dir)"
  [[ -n "$(docker ps -q --filter name=supabase_db_)" ]] || die "SKIP_REPLAY=1 but no stack is running; run without SKIP_REPLAY"
  [[ -f "$SIM_HOME/replay-commit" && -f "$SIM_HOME/fingerprint" ]] || die "SKIP_REPLAY=1 but replay markers are missing"
  log "reusing stack $(basename "$ENV_DIR")"
  FINGERPRINT="$(cat "$SIM_HOME/fingerprint")"
  # Stop only our app; the stack stays.
  if [[ -f "$ENV_DIR/app.pid" ]]; then
    pid="$(cat "$ENV_DIR/app.pid")"; pkill -TERM -P "$pid" 2>/dev/null || true; kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  pkill -f "next start -H 127.0.0.1 -p $TRACK1_APP_PORT" 2>/dev/null || true
else
  # A running stack is never stopped by up.sh.
  if [[ -n "$(docker ps -q --filter name=supabase_db_)" ]]; then
    echo "BLOCKED: stacken upptagen" >&2; docker ps --filter name=supabase_db_ --format '{{.Names}}' >&2; exit 2
  fi
  [[ -z "$(stack_containers)" ]] || die "a supabase stack for this project already exists; run down.sh first"
  [[ ! -e "$SIM_HOME/current" ]] || die "previous stack still registered at $SIM_HOME/current; run down.sh first"
  ENV_ID="t1-$(date -u +%Y%m%dT%H%M%SZ)-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
  ENV_DIR="$SIM_HOME/$ENV_ID"
  mkdir -p "$ENV_DIR/private" "$ENV_DIR/logs" "$ENV_DIR/runs"
  chmod 700 "$ENV_DIR/private"
  clear_markers
  ln -sfn "$ENV_DIR" "$SIM_HOME/current"
  log "environment $ENV_ID"
  # 1) Clean replay, sourced from the run directory (as in CI) inside a subshell
  #    so its variables (ROOT, DB_URL, MIGRATIONS, SEED, HOLD) and EXIT trap
  #    cannot leak into this script; the stack outlives it.
  set +e
  ( cd "$TRACK1_APP_DIR"
    unset GRIDEX_REPLAY_DB_URL
    # shellcheck disable=SC1091
    source scripts/gridex-aud-003-clean-replay.sh
    LOCAL_STACK_START_ATTEMPTED=0
    cleanup
    trap - EXIT
    set -euo pipefail
  ) > "$ENV_DIR/logs/replay.log" 2>&1
  REPLAY_EXIT=$?
  set -e
  REPLAY_SECONDS=$(( $(date +%s) - T0 ))
  grep -q '\[GRIDEX-REM-002 replay\] PASS: empty local Supabase' "$ENV_DIR/logs/replay.log" && [[ $REPLAY_EXIT == 0 ]] \
    || die "clean replay failed (exit $REPLAY_EXIT); see $ENV_DIR/logs/replay.log"
  app_tree_clean || die "replay left source changes in app dir"
  FINGERPRINT="$(sed -n 's/.*schema fingerprint verified: \([0-9a-f]\{64\}\).*/\1/p' "$ENV_DIR/logs/replay.log" | tail -1)"
  [[ -n "$FINGERPRINT" ]] || die "no verified fingerprint in replay log"
  log "replay PASS in ${REPLAY_SECONDS}s, fingerprint $FINGERPRINT"
  # Markers, only after a successful replay. applied-migrations.tsv starts empty;
  # sim-runner appends "<version>\t<file>\t<sha256>\t<time>" per applied HEAD migration.
  printf '%s\n' "$FINGERPRINT" > "$SIM_HOME/fingerprint"
  printf '%s\n' "$APP_HEAD" > "$SIM_HOME/replay-commit"
  utc > "$SIM_HOME/replay-at"
  : > "$SIM_HOME/applied-migrations.tsv"
  ( umask 077; printf '%s\n' "$TRACK1_DB_URL" > "$SIM_HOME/db-url" )
fi
ENV_ID="$(basename "$ENV_DIR")"
REPLAY_COMMIT="$(cat "$SIM_HOME/replay-commit")"

# 2) Schema and database identity.
psql "$TRACK1_DB_URL" -XAt -F $'\t' -c "select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version" > "$ENV_DIR/ledger-migrations.tsv"
DB_SYSID="$(psql "$TRACK1_DB_URL" -XAt -c 'select system_identifier from pg_control_system()')"
PG_VERSION="$(psql "$TRACK1_DB_URL" -XAt -c 'show server_version')"
docker ps --format '{{.Image}}' | sort -u | while read -r image; do
  printf '%s\t%s\n' "$image" "$(docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || echo unknown)"
done > "$ENV_DIR/images.tsv"

# 3) Private app environment (never committed; lives only under SIM_HOME).
if [[ ! -f "$ENV_DIR/private/app.env" ]]; then
( cd "$TRACK1_APP_DIR" && supabase status -o json ) > "$ENV_DIR/private/supabase-status.json" 2>/dev/null
chmod 600 "$ENV_DIR/private/supabase-status.json"
python3 - "$ENV_DIR/private/supabase-status.json" "$ENV_DIR/private/app.env" "$TRACK1_APP_PORT" <<'PY'
import json, secrets, sys, os
s = json.load(open(sys.argv[1]))
def pick(*names):
    for n in names:
        if s.get(n): return s[n]
    raise SystemExit(f"supabase status lacks {names}")
port = sys.argv[3]
env = {
  "NEXT_PUBLIC_SUPABASE_URL": pick("API_URL"),
  "NEXT_PUBLIC_SUPABASE_ANON_KEY": pick("ANON_KEY", "PUBLISHABLE_KEY"),
  "SUPABASE_SERVICE_ROLE_KEY": pick("SERVICE_ROLE_KEY", "SECRET_KEY"),
  "SUPABASE_URL": pick("API_URL"),
  "SITE_URL": f"http://127.0.0.1:{port}",
  "NEXT_PUBLIC_SITE_URL": f"http://127.0.0.1:{port}",
  "CRON_SECRET": secrets.token_hex(24),
  "PRICING_CRON_SECRET": secrets.token_hex(24),
  "EMAIL_OUTBOX_CRON_SECRET": secrets.token_hex(24),
  "SIGNATURE_EVIDENCE_SECRET": secrets.token_hex(24),
  "TRACK1_DB_URL": pick("DB_URL"),
  "TRACK1_MAILPIT_URL": s.get("INBUCKET_URL") or s.get("MAILPIT_URL") or "",
}
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    for k, v in env.items():
        f.write(f"{k}={v}\n")
PY
fi

# 4) Build and start the unchanged app against this stack.
T1=$(date +%s)
set -a; source "$ENV_DIR/private/app.env"; set +a
if [[ "$SKIP_BUILD" == 1 ]]; then
  [[ -f "$SIM_HOME/built-commit" && -f "$TRACK1_APP_DIR/.next/BUILD_ID" ]] || die "SKIP_BUILD=1 but there is no earlier build"
  log "reusing build $(cat "$SIM_HOME/built-commit")"
else
  rm -f "$SIM_HOME/built-commit"
  # The type-check worker inherits NODE_OPTIONS, not the build script's own flag.
  ( cd "$TRACK1_APP_DIR" && NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=6144 npm run build ) > "$ENV_DIR/logs/build.log" 2>&1 || die "app build failed; see $ENV_DIR/logs/build.log"
  BUILD_SECONDS=$(( $(date +%s) - T1 ))
  app_tree_clean || die "build left tracked changes in app dir"
  printf '%s\n' "$APP_HEAD" > "$SIM_HOME/built-commit"
fi
BUILD_ID="$(cat "$TRACK1_APP_DIR/.next/BUILD_ID")"
( cd "$TRACK1_APP_DIR" && NEXT_TELEMETRY_DISABLED=1 nohup node_modules/.bin/next start -H 127.0.0.1 -p "$TRACK1_APP_PORT" ) > "$ENV_DIR/logs/app.log" 2>&1 &
echo $! > "$ENV_DIR/app.pid"
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TRACK1_APP_PORT/login" || true)"
  [[ "$code" =~ ^(200|30[0-9])$ ]] && break
  sleep 1
done
[[ "$code" =~ ^(200|30[0-9])$ ]] || die "app did not answer on port $TRACK1_APP_PORT (last $code)"

python3 - "$ENV_DIR/stack.json" <<PY
import json, hashlib, pathlib, subprocess, sys
env_dir = pathlib.Path("$ENV_DIR")
ledger = (env_dir / "ledger-migrations.tsv").read_bytes()
applied = (pathlib.Path("$SIM_HOME") / "applied-migrations.tsv").read_bytes()
def run(*a): return subprocess.check_output(a, text=True).strip()
json.dump({
  "track": "1", "campaignId": "20261029-3f1a8ab1",
  "environmentId": "$ENV_ID",
  "databaseIdentity": "$ENV_ID/pg-sysid-$DB_SYSID",
  "baselineCommit": "$TRACK1_BASELINE",
  "appCommit": run("git", "-C", "$TRACK1_APP_DIR", "rev-parse", "HEAD"),
  "harnessCommit": run("git", "-C", "$TRACK1_DIR", "rev-parse", "HEAD"),
  "harnessTreeDirty": bool(run("git", "-C", "$TRACK1_DIR", "status", "--porcelain", "--", ".")),
  "nextBuildId": "$BUILD_ID",
  "replayBase": "$REPLAY_COMMIT",
  "replayAtUtc": (pathlib.Path("$SIM_HOME") / "replay-at").read_text().strip(),
  "builtCommit": (pathlib.Path("$SIM_HOME") / "built-commit").read_text().strip(),
  "flags": {"SKIP_REPLAY": "$SKIP_REPLAY", "SKIP_BUILD": "$SKIP_BUILD"},
  "schemaFingerprint": "$FINGERPRINT",
  "schemaFingerprintScope": "partial identity: selected tables only (scripts/gridex-aud-003-schema-fingerprint.sql)",
  "ledgerMigrationsCount": ledger.count(b"\n"),
  "ledgerMigrationsSha256": hashlib.sha256(ledger).hexdigest(),
  "postReplayAppliedMigrations": applied.count(b"\n"),
  "postgresVersion": "$PG_VERSION",
  "imageRegistry": "$INTERNAL_IMAGE_REGISTRY",
  "images": dict(l.split("\t", 1) for l in (env_dir / "images.tsv").read_text().splitlines() if "\t" in l),
  "supabaseCli": run("supabase", "--version"),
  "node": run("node", "--version"),
  "appUrl": "http://127.0.0.1:$TRACK1_APP_PORT",
  "startedAtUtc": "$STARTED", "readyAtUtc": "$(utc)",
  "timings": {"replaySeconds": $REPLAY_SECONDS, "buildSeconds": $BUILD_SECONDS, "workload": "replay skipped=$SKIP_REPLAY, build skipped=$SKIP_BUILD"},
}, open(sys.argv[1], "w"), indent=2)
PY
log "stack ready: $ENV_DIR/stack.json"
cat "$ENV_DIR/stack.json"
