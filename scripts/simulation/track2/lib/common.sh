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
    if home.exists():
        require(home.is_dir() and home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700)
    for name in ('logs', 'pids', 'reports'):
        child = home / name
        if child.exists() or child.is_symlink():
            require(canonical(str(child)).is_dir() and child.stat().st_uid == os.getuid())
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
(umask 077; mkdir -p "$SIM_HOME" "$SIM_HOME/logs" "$SIM_HOME/pids" "$SIM_HOME/reports") \
  || die "kunde inte skapa privat körkatalog"
chmod 700 "$SIM_HOME" || die "kunde inte skydda privat körkatalog"
python3 - "$SIM_HOME" <<'PY'
import os, pathlib, stat, sys
p = pathlib.Path(sys.argv[1])
paths = (p, *(p / name for name in ('logs', 'pids', 'reports')))
if any(not x.is_dir() or x.is_symlink() or str(x.resolve()) != str(x) or x.stat().st_uid != os.getuid() for x in paths) or stat.S_IMODE(p.stat().st_mode) != 0o700:
    raise SystemExit('runtime_directory_identity_rejected')
PY
[[ $? == 0 ]] || die "privat körkatalog kunde inte verifieras"

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

# Endast registrerade app-/motpartsprocesser; ingen grupp-, barn- eller DB-cleanup.
t2_process_custody() {
  python3 - "$@" "$SIM_HOME" "$RUN_DIR" "$HARNESS_DIR" "$SIM_RUNTIME_ASSIGNMENT_FILE" <<'PY'
import datetime, hashlib, json, os, pathlib, select, shutil, signal, stat, sys, time, uuid

def require(ok, code):
    if not ok: raise ValueError(code)

def private(path):
    require(str(path.resolve()) == str(path) and not path.is_symlink(), 'private_path_changed')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600, 'private_file_required')
        raw = os.read(fd, 65537); require(len(raw) <= 65536, 'private_file_too_large')
        return raw
    finally: os.close(fd)

def pid_value(path):
    require(not path.is_symlink() and path.is_file() and path.stat().st_uid == os.getuid(), 'pidfile_not_owned')
    value = path.read_text().strip(); require(value.isdigit() and int(value) > 1, 'invalid_pid')
    return int(value)

def snapshot(pid):
    proc = pathlib.Path('/proc') / str(pid)
    try:
        require(proc.stat().st_uid == os.getuid(), 'process_owner_mismatch')
        fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z': return None
        return {'startTimeTicks': fields[19], 'exe': os.readlink(proc / 'exe'), 'cwd': os.readlink(proc / 'cwd'),
                'cmdlineSha256': hashlib.sha256((proc / 'cmdline').read_bytes()).hexdigest()}
    except FileNotFoundError: return None

def exited(fd, timeout=0):
    poll = select.poll(); poll.register(fd, select.POLLIN)
    return bool(poll.poll(timeout))

handles = []
try:
    operation, *arguments = sys.argv[1:]
    role_args, tail = arguments[:-4], arguments[-4:]
    home, app, harness, assignment = map(pathlib.Path, tail)
    info = home.stat(); pids = home / 'pids'
    require(home.is_dir() and str(home.resolve()) == str(home) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'home_identity_mismatch')
    require(pids.is_dir() and not pids.is_symlink() and pids.stat().st_uid == os.getuid(), 'pid_directory_mismatch')
    raw = private(assignment); assigned = json.loads(raw); assignment_sha = hashlib.sha256(raw).hexdigest()
    require(assigned['worker'] == 'T2' and assigned['state'] == 'ACTIVE' and assigned['simHome'] == str(home) and assigned['runDir'] == str(app), 'assignment_identity_mismatch')
    def still_assigned():
        current = home.stat()
        require(private(assignment) == raw and (current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), 'assignment_changed')
        require(not pids.is_symlink() and pids.resolve() == home / 'pids', 'pid_directory_changed')
        expiry = datetime.datetime.fromisoformat(assigned['expiresAt'].replace('Z', '+00:00'))
        require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'assignment_expired')
    roles = ('app', 'counterparts'); keys = ('startTimeTicks', 'exe', 'cwd', 'cmdlineSha256')
    def bound(record, role):
        require(record['schema'] == 'track2-process-identity-v1' and record['worker'] == 'T2' and record['role'] == role
                and record['environmentId'] == assigned['environmentId'] and record['assignmentSha256'] == assignment_sha, 'process_receipt_assignment_mismatch')
    require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'pidfd_support_required')
    if operation in ('record', 'ready'):
        require(len(role_args) == 1 and role_args[0] in roles, 'invalid_process_role')
        role = role_args[0]; path = pids / (role + '.identity.json'); pid = pid_value(pids / (role + '.pid'))
        require(pid not in (os.getpid(), os.getppid()), 'invalid_process_pid')
        fd = os.pidfd_open(pid); handles.append(fd); identity = snapshot(pid)
        # PID-fd binder födelseobservationen medan shell/setsid exec:ar Node.
        for _ in range(50):
            if exited(fd) or (identity is not None and identity['exe'] == str(pathlib.Path(shutil.which('node')).resolve())
                              and identity['cwd'] == str(app if role == 'app' else harness)): break
            time.sleep(.02); identity = snapshot(pid)
        require(not exited(fd) and identity is not None and identity['exe'] == str(pathlib.Path(shutil.which('node')).resolve())
                and identity['cwd'] == str(app if role == 'app' else harness), 'new_process_identity_mismatch')
        record = {'schema': 'track2-process-identity-v1', 'worker': 'T2', 'role': role,
                  'environmentId': assigned['environmentId'], 'assignmentSha256': assignment_sha, 'pid': pid, **identity}
        if operation == 'ready':
            original = private(path); birth = json.loads(original); bound(birth, role)
            require(all(record[key] == birth[key] for key in ('pid', 'startTimeTicks', 'exe', 'cwd')), 'birth_process_identity_changed')
            record['birthSha256'] = hashlib.sha256(original).hexdigest()
            path = pids / (role + '.ready.identity.json')
        still_assigned(); fdout = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fdout, 'w') as stream: json.dump(record, stream); stream.write('\n')
    else:
        require(operation == 'stop' and not role_args, 'invalid_process_operation'); resources = []; seen_pids = set()
        for role in roles:
            path, pidfile = pids / (role + '.identity.json'), pids / (role + '.pid')
            if not path.exists() and not path.is_symlink():
                ready_path = pids / (role + '.ready.identity.json')
                require(not pidfile.exists() and not pidfile.is_symlink() and not ready_path.exists() and not ready_path.is_symlink(), 'unreceipted_pidfile'); continue
            birth_path = path; birth_original = private(path); birth = json.loads(birth_original); bound(birth, role)
            ready_path = pids / (role + '.ready.identity.json')
            if ready_path.exists() or ready_path.is_symlink():
                path = ready_path
            original = private(path); record = json.loads(original); bound(record, role); pid = record['pid']
            if path != birth_path:
                require(record['birthSha256'] == hashlib.sha256(birth_original).hexdigest()
                        and all(record[key] == birth[key] for key in ('pid', 'startTimeTicks', 'exe', 'cwd')), 'birth_process_identity_changed')
            require(type(pid) is int and pid > 1 and pid not in (os.getpid(), os.getppid()) and pid not in seen_pids, 'invalid_process_pid')
            seen_pids.add(pid)
            require(not pidfile.is_symlink() and (not pidfile.exists() or pid_value(pidfile) == pid), 'pidfile_changed')
            try: fd = os.pidfd_open(pid)
            except ProcessLookupError: fd = None
            if fd is not None:
                handles.append(fd); require(exited(fd) or snapshot(pid) == {key: record[key] for key in keys}, 'process_identity_mismatch')
            resources.append((record, path, pidfile, fd, original, birth_path, birth_original))
        # Privat journal reserveras före den första signalen, med originalkvitton.
        receipts = home / 'process-cleanup-receipts'; require(not receipts.is_symlink(), 'cleanup_receipt_directory_symlink')
        receipts.mkdir(mode=0o700, exist_ok=True)
        require(receipts.is_dir() and receipts.stat().st_uid == os.getuid() and stat.S_IMODE(receipts.stat().st_mode) == 0o700, 'cleanup_receipt_directory_not_private')
        destination = receipts / (str(uuid.uuid4()) + '.jsonl')
        fdout = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fdout, 'w') as journal:
            def event(state, **data):
                journal.write(json.dumps({'state': state, 'assignmentSha256': assignment_sha, **data}) + '\n'); journal.flush()
            event('STARTED', scope='recorded_processes_only', originals=[{'active': r, 'birth': json.loads(b)} for r, _, _, _, _, _, b in resources])
            for record, path, pidfile, fd, original, birth_path, birth_original in resources:
                still_assigned(); require(private(path) == original, 'process_receipt_changed')
                require(private(birth_path) == birth_original, 'birth_process_receipt_changed')
                require(not pidfile.is_symlink() and (not pidfile.exists() or pid_value(pidfile) == record['pid']), 'pidfile_changed')
                if fd is not None and not exited(fd):
                    require(snapshot(record['pid']) == {key: record[key] for key in keys}, 'process_identity_changed')
                    signal.pidfd_send_signal(fd, signal.SIGTERM)
                    if not exited(fd, 2000):
                        still_assigned(); signal.pidfd_send_signal(fd, signal.SIGKILL)
                        require(exited(fd, 2000), 'recorded_process_still_running')
                event('PROCESS_STOPPED', role=record['role'], pid=record['pid'])
                if pidfile.exists(): pidfile.unlink()
                path.unlink()
                if path != birth_path: birth_path.unlink()
            still_assigned(); event('DONE', scope='recorded_processes_only', backendStopped=False, volumesPurged=False, childrenChecked=False)
        print(json.dumps({'scope': 'recorded_processes_only', 'processesStopped': len(resources), 'backendStopped': False,
                          'volumesPurged': False, 'childrenChecked': False, 'receipt': str(destination)}))
except (OSError, ValueError, TypeError, KeyError) as error:
    code = str(error) if isinstance(error, ValueError) and str(error).replace('_', '').isalpha() else 'process_custody_failed'
    print('track2_process_refused: ' + code, file=sys.stderr); raise SystemExit(1)
finally:
    for fd in handles: os.close(fd)
PY
}

# Utanför repot finns ingen node_modules i föräldrakedjan; länka RUN_DIR:s (ignoreras av git).
ensure_node_modules() {
  if [[ ! -e "$HARNESS_DIR/node_modules" ]] && ! (cd "$HARNESS_DIR" && node -e "require.resolve('vitest/package.json')" >/dev/null 2>&1); then
    ln -s "$RUN_DIR/node_modules" "$HARNESS_DIR/node_modules"
  fi
}
