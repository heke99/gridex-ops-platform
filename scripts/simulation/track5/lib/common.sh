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
  t5_process_custody alive app >/dev/null
}

# Separata birth/ready-observationer. Endast exakt registrerade ledare får
# signaleras; okända barn/sessioner lämnas åt samordnarens återställning.
t5_process_custody() {
  python3 -I - "$@" "$SIM_HOME" "$RUN_DIR" "$HARNESS_DIR" "$SIM_RUNTIME_ASSIGNMENT_FILE" "$0" <<'PY'
import datetime, fcntl, hashlib, json, os, pathlib, re, select, shutil, signal, stat, subprocess, sys, time, uuid

def require(ok, code):
    if not ok:
        raise ValueError(code)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_key')
        result[key] = value
    return result

def private(path):
    require(str(path.resolve()) == str(path), 'private_path_changed')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600, 'private_file_required')
        raw = os.read(descriptor, 65537)
        require(len(raw) <= 65536, 'private_file_too_large')
        return raw
    finally:
        os.close(descriptor)

def parsed(raw):
    return json.loads(raw, object_pairs_hook=unique_object)

def future(value):
    expiry = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'assignment_expired')

def present(path):
    return path.exists() or path.is_symlink()

def snapshot(pid):
    proc = pathlib.Path('/proc') / str(pid)
    try:
        require(proc.stat().st_uid == os.getuid(), 'process_owner_mismatch')
        fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return {'uid': proc.stat().st_uid, 'parentPid': int(fields[1]), 'processGroup': int(fields[2]),
                'sessionId': int(fields[3]), 'startTimeTicks': fields[19], 'exe': os.readlink(proc / 'exe'),
                'cwd': os.readlink(proc / 'cwd'), 'cmdlineSha256': hashlib.sha256((proc / 'cmdline').read_bytes()).hexdigest()}
    except (FileNotFoundError, ProcessLookupError):
        return None

def members(pid):
    found = []
    for proc in pathlib.Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            if fields[0] != 'Z' and pid in (int(fields[2]), int(fields[3])):
                found.append(int(proc.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found

def descendants(pid):
    # Read-only PPID ancestry also sees a live child with another SID/PGID.
    # A child already reparented before observation cannot be proven absent.
    parents = {}
    for proc in pathlib.Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            if fields[0] != 'Z':
                parents[int(proc.name)] = int(fields[1])
        except (FileNotFoundError, ProcessLookupError):
            pass
    found, pending = set(), [pid]
    while pending:
        current = pending.pop()
        children = {child for child, parent in parents.items() if parent == current and child not in found}
        found.update(children)
        pending.extend(children)
    return found

def exited(descriptor, timeout=0):
    poller = select.poll()
    poller.register(descriptor, select.POLLIN)
    return bool(poller.poll(timeout))

handles = []
try:
    operation, *arguments = sys.argv[1:]
    role_args, tail = arguments[:-5], arguments[-5:]
    home, app, harness, assignment = map(pathlib.Path, tail[:4])
    entry = pathlib.Path(tail[4]).name.removesuffix('.sh')
    info = home.stat()
    pids = home / 'pids'
    pids_info = pids.stat()
    require(home.is_dir() and str(home.resolve()) == str(home) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'home_identity_mismatch')
    require(pids.is_dir() and str(pids.resolve()) == str(pids) and pids_info.st_uid == os.getuid(), 'pid_directory_mismatch')
    original_assignment = private(assignment)
    assigned = parsed(original_assignment)
    assignment_sha = hashlib.sha256(original_assignment).hexdigest()
    require(assigned['schema'] == 'gridex-simulation-runtime-assignment-v1'
            and assigned['worker'] == 'T5' and assigned['state'] == 'ACTIVE'
            and assigned['simHome'] == str(home) and assigned['runDir'] == str(app)
            and isinstance(assigned['allowedOperations'], list) and entry in assigned['allowedOperations'], 'assignment_identity_mismatch')
    require(re.fullmatch(r'[0-9a-f]{40}', assigned['sourceCommit'])
            and subprocess.check_output(['git', '-C', str(app), 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL).strip() == assigned['sourceCommit']
            and not subprocess.check_output(['git', '-C', str(app), 'status', '--porcelain', '--untracked-files=normal'], text=True, stderr=subprocess.DEVNULL).strip(),
            'assignment_source_mismatch')
    require(entry in ('up', 'down') or (entry == 'run' and operation == 'alive'), 'operation_not_assigned')
    require(operation not in ('birth', 'ready', 'namespace-plan') or entry == 'up', 'operation_not_assigned')

    def still_assigned():
        current, current_pids = home.stat(), pids.stat()
        require(private(assignment) == original_assignment
                and (current.st_dev, current.st_ino) == (info.st_dev, info.st_ino)
                and current.st_uid == os.getuid() and stat.S_IMODE(current.st_mode) == 0o700
                and str(home.resolve()) == str(home)
                and (current_pids.st_dev, current_pids.st_ino) == (pids_info.st_dev, pids_info.st_ino)
                and str(pids.resolve()) == str(pids), 'assignment_or_directory_changed')
        future(assigned['expiresAt'])

    still_assigned()
    lock = os.open(home / 'process-custody.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    handles.append(lock)
    lock_info = os.fstat(lock)
    require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_uid == os.getuid()
            and stat.S_IMODE(lock_info.st_mode) == 0o600, 'process_lock_not_private')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    roles = ('app', 'counterparts', 'receiver')
    immutable = ('uid', 'processGroup', 'sessionId', 'startTimeTicks', 'exe', 'cwd')
    identity_keys = (*immutable, 'cmdlineSha256')
    require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'pidfd_support_required')

    def validate(record, role, phase):
        pid = record['pid']
        require(record['schema'] == 'track5-process-identity-v1' and record['worker'] == 'T5'
                and record['role'] == role and record['phase'] == phase
                and record['environmentId'] == assigned['environmentId']
                and record['assignmentSha256'] == assignment_sha, 'receipt_assignment_mismatch')
        require(type(pid) is int and pid > 1 and pid not in (os.getpid(), os.getppid())
                and type(record['uid']) is int and record['uid'] == os.getuid()
                and record['processGroup'] == pid and record['sessionId'] == pid,
                'receipt_process_identity_invalid')
        require(isinstance(record['startTimeTicks'], str) and record['startTimeTicks'].isdigit()
                and re.fullmatch(r'[0-9a-f]{64}', record['cmdlineSha256']), 'receipt_process_identity_invalid')
        require(record['cwd'] == str(app if role == 'app' else harness)
                and record['exe'] == str(pathlib.Path(shutil.which('node')).resolve()), 'receipt_process_paths_invalid')
        return pid

    def write_new(path, record):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(record, stream)
            stream.write('\n')

    if operation == 'namespace-plan':
        require(not role_args, 'invalid_namespace_plan_operation')
        plan_path = pathlib.Path(os.environ.get('SIM_NAMESPACE_PLAN_FILE', ''))
        require(plan_path.is_absolute(), 'external_namespace_plan_required')
        plan = parsed(private(plan_path))
        for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
            probe = subprocess.run(['git', '-C', str(plan_path.parent), 'rev-parse', flag], capture_output=True, text=True)
            require(not (probe.returncode == 0 and probe.stdout.strip() == 'true'), 'namespace_plan_inside_git')
        require(plan['schema'] == 'gridex-simulation-namespace-plan-v1' and plan['worker'] == 'T5'
                and plan['state'] == 'QUALIFIED' and plan['mode'] == 'PREPARED_EXTERNALLY'
                and plan['environmentId'] == assigned['environmentId'] and plan['assignmentSha256'] == assignment_sha
                and plan['networkNamespace'] == os.readlink('/proc/self/ns/net'), 'namespace_plan_mismatch')
        require(plan['receiver'] == {**assigned['receiver'], 'tlsPort': assigned['ports']['SIM_RECEIVER_TLS_PORT'],
                                    'controlPort': assigned['ports']['SIM_RECEIVER_CTRL_PORT']}, 'namespace_receiver_mismatch')
        future(plan['expiresAt'])
    elif operation == 'birth':
        require(len(role_args) == 2 and role_args[0] in roles and role_args[1].isdigit(), 'invalid_birth_arguments')
        role, pid = role_args[0], int(role_args[1])
        require(pid > 1 and pid not in (os.getpid(), os.getppid()), 'invalid_process_pid')
        require(not any(present(pids / (role + suffix)) for suffix in ('.pid', '.birth.json', '.ready.json')), 'process_receipt_already_exists')
        descriptor = os.pidfd_open(pid)
        handles.append(descriptor)
        node = str(pathlib.Path(shutil.which('node')).resolve())
        for _ in range(100):
            identity = snapshot(pid)
            require(not exited(descriptor) and identity is not None, 'new_process_exited')
            if identity['exe'] == node:
                break
            time.sleep(.01)
        require(identity['exe'] == node and identity['parentPid'] == os.getppid()
                and identity['processGroup'] == pid and identity['sessionId'] == pid
                and identity['cwd'] == str(app if role == 'app' else harness), 'new_process_identity_mismatch')
        record = {'schema': 'track5-process-identity-v1', 'worker': 'T5', 'role': role, 'phase': 'birth',
                  'environmentId': assigned['environmentId'], 'assignmentSha256': assignment_sha, 'pid': pid, **identity}
        still_assigned()
        write_new(pids / (role + '.birth.json'), record)
        descriptor = os.open(pids / (role + '.pid'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(str(pid) + '\n')
    elif operation == 'ready':
        require(len(role_args) == 1 and role_args[0] in roles, 'invalid_ready_arguments')
        role = role_args[0]
        birth_raw = private(pids / (role + '.birth.json'))
        birth = parsed(birth_raw)
        pid = validate(birth, role, 'birth')
        descriptor = os.pidfd_open(pid)
        handles.append(descriptor)
        identity = snapshot(pid)
        require(not exited(descriptor) and identity is not None
                and all(identity[key] == birth[key] for key in immutable), 'ready_birth_identity_mismatch')
        still_assigned()
        require(private(pids / (role + '.birth.json')) == birth_raw, 'birth_receipt_changed')
        write_new(pids / (role + '.ready.json'), {**birth, **identity, 'phase': 'ready',
                                                'birthSha256': hashlib.sha256(birth_raw).hexdigest()})
    else:
        require(operation in ('stop', 'alive') and (not role_args if operation == 'stop'
                else len(role_args) == 1 and role_args[0] in roles), 'invalid_process_operation')
        resources, seen = [], set()
        for role in roles if operation == 'stop' else role_args:
            birth_path, ready_path, pid_path = (pids / (role + suffix) for suffix in ('.birth.json', '.ready.json', '.pid'))
            if not present(birth_path):
                require(not present(ready_path) and not present(pid_path), 'unreceipted_process')
                require(operation != 'alive', 'recorded_process_not_alive')
                continue
            birth_raw = private(birth_path)
            birth = parsed(birth_raw)
            pid = validate(birth, role, 'birth')
            selected, originals = birth, [(birth_path, birth_raw)]
            if present(ready_path):
                ready_raw = private(ready_path)
                ready = parsed(ready_raw)
                require(validate(ready, role, 'ready') == pid and ready['birthSha256'] == hashlib.sha256(birth_raw).hexdigest()
                        and all(ready[key] == birth[key] for key in immutable), 'ready_birth_binding_mismatch')
                selected = ready
                originals.append((ready_path, ready_raw))
            require(pid not in seen, 'duplicate_process_pid')
            seen.add(pid)
            if present(pid_path):
                require(private(pid_path).decode().strip() == str(pid), 'pidfile_identity_mismatch')
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                descriptor = None
            if descriptor is not None:
                handles.append(descriptor)
                observed = snapshot(pid)
                require(exited(descriptor) or observed is not None and all(observed[key] == selected[key] for key in identity_keys),
                        'process_identity_mismatch')
            require(set(members(pid)) <= {pid}, 'unassigned_session_members')
            require(not descendants(pid), 'observed_descendants_require_coordinator')
            if operation == 'alive':
                require(descriptor is not None and not exited(descriptor), 'recorded_process_not_alive')
            resources.append((pid, selected, originals, pid_path, descriptor))
        if operation == 'stop':
            receipts = home / 'process-cleanup-receipts'
            require(not receipts.is_symlink(), 'cleanup_receipt_directory_symlink')
            receipts.mkdir(mode=0o700, exist_ok=True)
            require(receipts.is_dir() and receipts.stat().st_uid == os.getuid()
                    and stat.S_IMODE(receipts.stat().st_mode) == 0o700, 'cleanup_receipt_directory_not_private')
            destination = receipts / (str(uuid.uuid4()) + '.jsonl')
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as journal:
                def event(state, **data):
                    journal.write(json.dumps({'state': state, 'assignmentSha256': assignment_sha, **data}) + '\n')
                    journal.flush()
                event('STARTED', scope='recorded_leaders_only', descendantContainment='NOT_PROVEN',
                      originals=[parsed(raw) for _, _, originals, _, _ in resources for _, raw in originals])
                for pid, selected, originals, pid_path, descriptor in resources:
                    still_assigned()
                    require(all(private(path) == raw for path, raw in originals), 'process_receipt_changed')
                    require(not present(pid_path) or private(pid_path).decode().strip() == str(pid), 'pidfile_changed')
                    require(set(members(pid)) <= {pid}, 'unassigned_session_members')
                    require(not descendants(pid), 'observed_descendants_require_coordinator')
                    if descriptor is not None and not exited(descriptor):
                        observed = snapshot(pid)
                        require(observed is not None and all(observed[key] == selected[key] for key in identity_keys), 'process_identity_changed')
                        signal.pidfd_send_signal(descriptor, signal.SIGTERM)
                        if not exited(descriptor, 2000):
                            still_assigned()
                            require(not descendants(pid), 'observed_descendants_require_coordinator')
                            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                            require(exited(descriptor, 2000), 'recorded_process_did_not_exit')
                    require(not members(pid), 'session_not_empty')
                    if present(pid_path):
                        require(private(pid_path).decode().strip() == str(pid), 'pidfile_changed')
                        pid_path.unlink()
                    for path, raw in reversed(originals):
                        require(private(path) == raw, 'process_receipt_changed')
                        path.unlink()
                    event('PROCESS_STOPPED', pid=pid, sessionEmpty=True)
                still_assigned()
                event('DONE', scope='recorded_leaders_only', backendStopped=False, hostNetworkChanged=False,
                      descendantsStopped=False, descendantContainment='NOT_PROVEN')
            print(json.dumps({'scope': 'recorded_leaders_only', 'processesStopped': len(resources), 'backendStopped': False,
                              'hostNetworkChanged': False, 'descendantsStopped': False,
                              'descendantContainment': 'NOT_PROVEN', 'receipt': str(destination)}))
except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
    code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z_]+', str(error)) else 'process_custody_failed'
    print('track5_process_refused: ' + code, file=sys.stderr)
    raise SystemExit(1)
finally:
    for descriptor in handles:
        os.close(descriptor)
PY
}

t5_acquire_runtime_lock() {
  LOCK="$SIM_HOME/run.lock"
  mkdir "$LOCK" 2>/dev/null || die "run.lock finns; samordnaren måste avstämma kvarlämnad låsning"
  (umask 077; printf '%s\n' "$$" >"$LOCK/pid") || die "kunde inte registrera egen körlåsning"
  trap 'if [[ "$(cat "$LOCK/pid" 2>/dev/null)" == "$$" ]]; then rm -f -- "$LOCK/pid"; rmdir -- "$LOCK" 2>/dev/null || true; fi' EXIT
}

# Utanför repot finns ingen node_modules i föräldrakedjan; länka RUN_DIR:s (ignoreras av git).
ensure_node_modules() {
  if [[ ! -e "$HARNESS_DIR/node_modules" ]] && ! (cd "$HARNESS_DIR" && node -e "require.resolve('vitest/package.json')" >/dev/null 2>&1); then
    ln -s "$RUN_DIR/node_modules" "$HARNESS_DIR/node_modules"
  fi
}
