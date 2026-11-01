#!/usr/bin/env bash
# Gemensam shell-hjälp för up.sh / down.sh / run.sh (källas, körs ej direkt).
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "FEL: $*"; exit 1; }

# Samordnarens uttryckliga tilldelning kontrolleras före katalogskapande och
# före up/run/down når processer, Docker, credentials eller nätändringar.
# En tilldelning ersätter inte separat kvalificering av dessa livscykler.
[[ -n "${SIM_RUNTIME_ASSIGNMENT_FILE:-}" && -n "${SIM_HOME:-}" && -n "${RUN_DIR:-}" ]] \
  || die "explicit SIM_RUNTIME_ASSIGNMENT_FILE, SIM_HOME och RUN_DIR krävs"
ASSIGNED_ENV="$(python3 -I - "$SIM_RUNTIME_ASSIGNMENT_FILE" "$0" <<'PY'
import datetime, ipaddress, json, os, pathlib, re, stat, subprocess, sys

def require(ok):
    if not ok:
        raise ValueError('runtime_assignment_rejected')

def canonical(value):
    require(isinstance(value, str) and value.startswith('/') and not any(ord(c) < 32 for c in value))
    path = pathlib.Path(value)
    require(str(path.resolve()) == value)
    return path

def read_regular(path, private=False):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        meta = os.fstat(descriptor)
        require(stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid())
        require(not private or stat.S_IMODE(meta.st_mode) == 0o600)
        value = os.read(descriptor, 65537)
        require(len(value) <= 65536)
        return value.decode()
    finally:
        os.close(descriptor)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result

def git(app, *args):
    return subprocess.check_output(['git', '-C', str(app), *args], text=True, stderr=subprocess.DEVNULL).strip()

def outside_git(path):
    while not path.exists():
        path = path.parent
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        result = subprocess.run(['git', '-C', str(path), 'rev-parse', flag], capture_output=True, text=True)
        require(not (result.returncode == 0 and result.stdout.strip() == 'true'))

try:
    assignment = canonical(sys.argv[1])
    data = json.loads(read_regular(assignment, private=True), object_pairs_hook=unique_object)
    require(data['schema'] == 'gridex-simulation-runtime-assignment-v1' and data['worker'] == 'T5' and data['state'] == 'ACTIVE')
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
    if home.exists():
        require(home.is_dir() and home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700)
    for name in ('logs', 'pids', 'reports'):
        child = home / name
        if child.exists() or child.is_symlink():
            require(canonical(str(child)).is_dir() and child.stat().st_uid == os.getuid())
    outside_git(assignment.parent)
    outside_git(home)
    require(re.fullmatch(r'[0-9a-f]{40}', data['sourceCommit']) and git(app, 'rev-parse', 'HEAD') == data['sourceCommit'])
    require(not git(app, 'status', '--porcelain', '--untracked-files=normal'))
    project = data['projectId']
    require(isinstance(project, str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,62}', project) and project != 'gridex-ops-platform')
    keys = ('SIM_API_PORT', 'SIM_DB_PORT', 'SIM_SHADOW_PORT', 'SIM_POOLER_PORT', 'SIM_STUDIO_PORT', 'SIM_MAIL_HTTP_PORT',
            'SIM_SMTP_PORT', 'SIM_APP_PORT', 'SIM_COUNTERPART_PORT', 'SIM_RECEIVER_TLS_PORT', 'SIM_RECEIVER_CTRL_PORT')
    ports = data['ports']
    require(set(ports) == set(keys) and all(type(ports[key]) is int and 1024 <= ports[key] <= 65535 for key in keys))
    require(len(set(ports.values())) == len(keys))
    receiver = data['receiver']
    require(isinstance(receiver, dict) and isinstance(receiver.get('ip'), str)
            and isinstance(ipaddress.ip_address(receiver['ip']), ipaddress.IPv4Address)
            and ipaddress.ip_address(receiver['ip']).is_global)
    hosts, tag = receiver.get('hosts'), receiver.get('networkTag')
    require(isinstance(hosts, list) and hosts and len(hosts) == len(set(hosts))
            and all(isinstance(host, str) and re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.t5\.sim\.invalid', host) for host in hosts))
    require(isinstance(tag, str) and re.fullmatch(r'gridex-sim-t5-[a-z0-9][a-z0-9_-]{2,60}', tag))
    persisted_values = {'SIM_PROJECT_ID': project, **{key: str(ports[key]) for key in keys}, 'SIM_RECEIVER_IP': receiver['ip']}
    expected = {**persisted_values, 'SIM_RECEIVER_HOSTS': ' '.join(hosts), 'SIM_IPT_TAG': tag}
    require(all(key not in os.environ or os.environ[key] == value for key, value in expected.items()))
    persisted = home / 'ports.env'
    if persisted.exists() or persisted.is_symlink():
        saved = {}
        for line in read_regular(persisted).splitlines():
            match = re.fullmatch(r'(SIM_[A-Z_]+)=([A-Za-z0-9_.-]+)', line)
            require(match is not None and match[1] not in saved)
            saved[match[1]] = match[2]
        require(saved == persisted_values)
    for key, value in expected.items():
        print(key + '\t' + value)
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
    print('runtime_assignment_rejected: check private assignment, operation, source, home and identities', file=sys.stderr)
    raise SystemExit(1)
PY
)" || die "körtilldelningen kunde inte verifieras; inga resurser startas eller städas"
while IFS=$'\t' read -r key value; do
  printf -v "$key" '%s' "$value"
  export "$key"
done <<< "$ASSIGNED_ENV"
unset ASSIGNED_ENV key value
export SIM_HOME RUN_DIR
(umask 077; mkdir -p "$SIM_HOME" "$SIM_HOME/logs" "$SIM_HOME/pids" "$SIM_HOME/reports") \
  || die "kunde inte skapa privat körkatalog"
chmod 700 "$SIM_HOME" || die "kunde inte skydda privat körkatalog"
python3 -I - "$SIM_HOME" <<'PY'
import os, pathlib, stat, sys
home = pathlib.Path(sys.argv[1])
paths = (home, *(home / name for name in ('logs', 'pids', 'reports')))
if any(not path.is_dir() or path.is_symlink() or str(path.resolve()) != str(path) or path.stat().st_uid != os.getuid() for path in paths) or stat.S_IMODE(home.stat().st_mode) != 0o700:
    raise SystemExit('runtime_directory_identity_rejected')
PY
[[ $? == 0 ]] || die "privat körkatalog kunde inte verifieras"
# AUTH01.05: verklig kort sessionslivslängd i stackens Auth (bara i konfigkopian; real tid).
export SIM_AUTH_JWT_EXPIRY="${SIM_AUTH_JWT_EXPIRY:-60}"
export SIM_AUTH_SESSION_TIMEBOX="${SIM_AUTH_SESSION_TIMEBOX:-3m}"

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
