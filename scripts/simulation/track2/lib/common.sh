#!/usr/bin/env bash
# Gemensam shell-hjälp för up.sh / down.sh / run.sh (källas, körs ej direkt).
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "FEL: $*"; exit 1; }

# Ingen standardstack, gammal shellfil eller källmarkör ger en ny körtilldelning.
# Kontrollera samordnarens privata, tidsbegränsade tilldelning FÖRE mkdir och
# före up/run/down når Docker, processer, credentials eller scenariofixturer.
[[ -n "${SIM_RUNTIME_ASSIGNMENT_FILE:-}" && -n "${SIM_HOME:-}" && -n "${RUN_DIR:-}" ]] \
  || die "explicit SIM_RUNTIME_ASSIGNMENT_FILE, SIM_HOME och RUN_DIR krävs"
ASSIGNED_ENV="$(python3 - "$SIM_RUNTIME_ASSIGNMENT_FILE" "$0" <<'PY'
import datetime, json, os, pathlib, re, stat, subprocess, sys

def require(ok):
    if not ok:
        raise ValueError('runtime_assignment_rejected')

def canonical(value):
    require(isinstance(value, str) and value.startswith('/') and not any(ord(c) < 32 for c in value))
    p = pathlib.Path(value)
    require(str(p.resolve()) == value)
    return p

def git(app, *args):
    return subprocess.check_output(['git', '-C', str(app), *args], text=True, stderr=subprocess.DEVNULL).strip()

try:
    assignment = canonical(sys.argv[1])
    info = assignment.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0)
    data = json.loads(assignment.read_text())
    require(data['schema'] == 'gridex-simulation-runtime-assignment-v1' and data['worker'] == 'T2' and data['state'] == 'ACTIVE')
    require(isinstance(data['environmentId'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,100}', data['environmentId']))
    expiry = datetime.datetime.fromisoformat(data['expiresAt'].replace('Z', '+00:00'))
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc))
    operation = pathlib.Path(sys.argv[2]).name.removesuffix('.sh')
    operations = data['allowedOperations']
    require(isinstance(operations, list) and operations and all(x in ('up', 'run', 'down') for x in operations))
    require(operation in ('up', 'run', 'down') and operation in operations)
    app, home = canonical(os.environ['RUN_DIR']), canonical(os.environ['SIM_HOME'])
    require(str(app) == data['runDir'] and str(home) == data['simHome'])
    require(app.is_dir() and home != pathlib.Path('/') and home != app and not home.is_relative_to(app) and not app.is_relative_to(home))
    # Credentials/replay outputs must stay outside every Git checkout.
    for private in (assignment.parent, home):
        parent = private
        while not parent.exists():
            parent = parent.parent
        probe = subprocess.run(['git', '-C', str(parent), 'rev-parse', '--show-toplevel'], capture_output=True)
        require(probe.returncode != 0)
    require(re.fullmatch(r'[0-9a-f]{40}', data['sourceCommit']) and git(app, 'rev-parse', 'HEAD') == data['sourceCommit'])
    require(not git(app, 'status', '--porcelain', '--untracked-files=normal'))
    project = data['projectId']
    require(isinstance(project, str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,62}', project) and project != 'gridex-ops-platform')
    keys = ('SIM_API_PORT', 'SIM_DB_PORT', 'SIM_SHADOW_PORT', 'SIM_POOLER_PORT', 'SIM_STUDIO_PORT', 'SIM_MAIL_HTTP_PORT', 'SIM_SMTP_PORT', 'SIM_APP_PORT', 'SIM_COUNTERPART_PORT')
    ports = data['ports']
    require(set(ports) == set(keys))
    require(all(type(ports[k]) is int and 1024 <= ports[k] <= 65535 for k in keys))
    require(len(set(ports.values())) == len(keys))
    expected = {'SIM_PROJECT_ID': project, **{k: str(ports[k]) for k in keys}}
    require(all(k not in os.environ or os.environ[k] == v for k, v in expected.items()))
    persisted = home / 'ports.env'
    if persisted.exists() or persisted.is_symlink():
        require(not persisted.is_symlink() and persisted.is_file())
        saved = {}
        for line in persisted.read_text().splitlines():
            match = re.fullmatch(r'(SIM_[A-Z_]+)=([A-Za-z0-9_-]+)', line)
            require(match is not None and match[1] not in saved)
            saved[match[1]] = match[2]
        require(saved == expected)
    for key, value in expected.items():
        print(key + '\t' + value)
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
    print('runtime_assignment_rejected: check private assignment, operation, source, home and ports', file=sys.stderr)
    raise SystemExit(1)
PY
)" || die "körtilldelningen kunde inte verifieras; inga resurser startas eller städas"
while IFS=$'\t' read -r key value; do
  printf -v "$key" '%s' "$value"
  export "$key"
done <<< "$ASSIGNED_ENV"
unset ASSIGNED_ENV key value
export SIM_HOME RUN_DIR
mkdir -p "$SIM_HOME" "$SIM_HOME/logs" "$SIM_HOME/pids" "$SIM_HOME/reports"
chmod 700 "$SIM_HOME"

# Docker Hub (429) och ECR (data limit) fungerar inte; ghcr.io/supabase/* gör det.
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-ghcr.io}"
export SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NEXT_TELEMETRY_DISABLED=1

# Privat kopia av scripts/ + supabase/ (replayskriptet muterar migrations/, seed.sql,
# .temp/ och e2e-artifacts/; RUN_DIR ska vara orört). Supabase-CLI körs härifrån.
REPLAY_ROOT="$SIM_HOME/replay-root"

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
