#!/usr/bin/env bash
# Stoppa bara resurser i en privat, uttrycklig tilldelning. Ingen global cleanup.
set -euo pipefail
T3_REQUESTED_SIM_HOME="${SIM_HOME:-}"
T3_REQUESTED_RUN_DIR="${SIM_RUN_DIR:-}"
# shellcheck source=lib/common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
for a in "$@"; do
  case "$a" in
    --stack|--purge) t3_die "$a saknar kvalificerad backend-/retentionstilldelning; ingen cleanup utförd" ;;
    *) t3_die "okänd parameter: $a" ;;
  esac
done
[[ -n "$T3_REQUESTED_SIM_HOME" && -n "$T3_REQUESTED_RUN_DIR" ]] || t3_die "SIM_HOME och SIM_RUN_DIR måste anges uttryckligen"
[[ -n "${T3_CLEANUP_ASSIGNMENT_FILE:-}" ]] || t3_die "T3_CLEANUP_ASSIGNMENT_FILE krävs; ingen cleanup utförd"
python3 - "$SIM_HOME" "$RUN_DIR" "$T3_CLEANUP_ASSIGNMENT_FILE" <<'PY'
import fcntl, hashlib, json, os, re, select, signal, stat, subprocess, sys, time
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4


def require(condition, code):
    if not condition:
        raise ValueError(code)


def canonical(value):
    path = Path(value)
    require(path.is_absolute() and str(path) == str(path.resolve(strict=True)), 'noncanonical_path')
    return path


def private_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        meta = os.fstat(descriptor)
        require(stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid()
                and stat.S_IMODE(meta.st_mode) == 0o600, 'assignment_not_private_regular_file')
        return os.read(descriptor, 65537)
    finally:
        os.close(descriptor)


def outside_git(path):
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        result = subprocess.run(['git', '-C', str(path), 'rev-parse', flag], capture_output=True, text=True)
        require(not (result.returncode == 0 and result.stdout.strip() == 'true'), 'private_path_inside_git')


def docker(*arguments):
    return subprocess.run(['docker', *arguments], capture_output=True, text=True, timeout=15)


def container_present(identifier):
    result = docker('container', 'ls', '-aq', '--no-trunc', '--filter', 'id=' + identifier)
    require(result.returncode == 0, 'container_inventory_failed')
    require(all(item == identifier for item in result.stdout.split()), 'container_inventory_identity_mismatch')
    return identifier in result.stdout.split()


def check_container(resource):
    if not container_present(resource['id']):
        return False
    result = docker('inspect', '--type', 'container', resource['id'])
    require(result.returncode == 0, 'container_inspection_failed')
    observed = json.loads(result.stdout)
    require(len(observed) == 1 and observed[0]['Id'] == resource['id'], 'container_identity_mismatch')
    labels = observed[0].get('Config', {}).get('Labels') or {}
    require(all(labels.get(key) == value for key, value in resource['labels'].items()), 'container_ownership_mismatch')
    return True


def snapshot(pid):
    directory = Path('/proc') / str(pid)
    try:
        require(directory.stat().st_uid == os.getuid(), 'process_owner_mismatch')
        fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return {'startTimeTicks': fields[19], 'exe': os.readlink(directory / 'exe'),
                'cwd': os.readlink(directory / 'cwd'),
                'cmdlineSha256': hashlib.sha256((directory / 'cmdline').read_bytes()).hexdigest()}
    except FileNotFoundError:
        return None


def pidfile(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        meta = os.fstat(descriptor)
        require(stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid(), 'pidfile_not_owned_regular_file')
        value = os.read(descriptor, 64).decode().strip()
        require(re.fullmatch(r'[1-9][0-9]*', value), 'pidfile_invalid')
        return int(value)
    finally:
        os.close(descriptor)


def exited(descriptor, timeout=0):
    poller = select.poll()
    poller.register(descriptor, select.POLLIN)
    return bool(poller.poll(timeout))


handles = []
try:
    home, run_dir, assignment_path = (canonical(value) for value in sys.argv[1:])
    require(home.is_dir() and run_dir.is_dir(), 'assignment_directory_required')
    meta = home.stat()
    require(meta.st_uid == os.getuid() and stat.S_IMODE(meta.st_mode) == 0o700, 'sim_home_not_private')
    outside_git(home)
    outside_git(assignment_path.parent)
    original = private_file(assignment_path)
    require(len(original) <= 65536, 'assignment_too_large')
    assignment = json.loads(original)
    require(isinstance(assignment, dict), 'assignment_object_required')
    require(assignment.get('schema') == 'track3-cleanup-assignment-v1'
            and assignment.get('worker') == 'codex-track3', 'assignment_worker_mismatch')
    environment = assignment.get('environmentId')
    require(isinstance(environment, str) and re.fullmatch(r'[A-Za-z0-9_-]{8,80}', environment), 'assignment_environment_required')
    require(assignment.get('simHome') == str(home) and assignment.get('runDir') == str(run_dir), 'assignment_path_mismatch')
    pid_dir = home / 'pids'
    require(not pid_dir.is_symlink() and pid_dir.is_dir() and pid_dir.stat().st_uid == os.getuid(), 'pid_directory_not_owned')
    lock = os.open(home / 'run.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    handles.append(lock)
    require(stat.S_ISREG(os.fstat(lock).st_mode) and os.fstat(lock).st_uid == os.getuid(), 'run_lock_not_owned')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    resources = assignment.get('processes')
    require(isinstance(resources, list) and len(resources) <= 2, 'process_assignment_invalid')
    require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'pidfd_support_required')
    registered, processes = {}, []
    keys = ('startTimeTicks', 'exe', 'cwd', 'cmdlineSha256')
    for resource in resources:
        require(isinstance(resource, dict), 'process_assignment_object_required')
        pid, name = resource.get('pid'), resource.get('pidFile')
        require(type(pid) is int and pid > 1 and pid not in (os.getpid(), os.getppid()), 'process_pid_invalid')
        require(name in ('app.pid', 'counterparty.pid') and name not in registered
                and pid not in registered.values(), 'process_assignment_duplicate_or_unknown')
        registered[name] = pid
        require(isinstance(resource.get('startTimeTicks'), str) and resource['startTimeTicks'].isdigit()
                and isinstance(resource.get('cmdlineSha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', resource['cmdlineSha256']), 'process_identity_required')
        require(all(isinstance(resource.get(key), str) and resource[key].startswith('/') for key in ('exe', 'cwd')), 'process_paths_required')
        path = pid_dir / name
        require(not path.is_symlink() and (not path.exists() or pidfile(path) == pid), 'pidfile_identity_mismatch')
        try:
            descriptor = os.pidfd_open(pid)
        except ProcessLookupError:
            descriptor = None
        if descriptor is not None:
            handles.append(descriptor)
            require(exited(descriptor) or snapshot(pid) == {key: resource[key] for key in keys}, 'process_identity_mismatch')
        processes.append((resource, descriptor))
    for name in ('app.pid', 'counterparty.pid'):
        path = pid_dir / name
        require(not path.is_symlink() and (not path.exists() or name in registered), 'unassigned_pidfile')
    container = assignment.get('greenmail')
    if container is not None:
        require(isinstance(container, dict) and isinstance(container.get('id'), str)
                and re.fullmatch(r'[0-9a-f]{64}', container['id']), 'full_container_id_required')
        labels = {'sim.track': 'track3', 'sim.campaign': '20261029-3f1a8ab1',
                  'sim.worker': 'codex-track3', 'sim.environment': environment}
        require(container.get('labels') == labels, 'container_assignment_labels_mismatch')
        check_container(container)

    def still_assigned():
        require(private_file(assignment_path) == original, 'assignment_changed')
        current = home.stat()
        require(current.st_ino == meta.st_ino and current.st_dev == meta.st_dev, 'sim_home_changed')
        require(not pid_dir.is_symlink() and pid_dir.resolve() == home / 'pids', 'pid_directory_changed')

    # Hela målsetet verifieras före första signal/Docker-mutation. PID-fd binder
    # signalen till rätt process även om ett numeriskt PID senare återanvänds.
    for resource, descriptor in processes:
        still_assigned()
        path = pid_dir / resource['pidFile']
        require(not path.is_symlink() and (not path.exists() or pidfile(path) == resource['pid']), 'pidfile_changed')
        if descriptor is not None and not exited(descriptor):
            require(snapshot(resource['pid']) == {key: resource[key] for key in keys}, 'process_identity_changed')
            signal.pidfd_send_signal(descriptor, signal.SIGTERM)
            if not exited(descriptor, 2000):
                still_assigned()
                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                require(exited(descriptor, 2000), 'assigned_process_did_not_exit')
        if path.exists():
            require(pidfile(path) == resource['pid'], 'pidfile_changed')
            path.unlink()
    if container is not None:
        still_assigned()
        if check_container(container):
            require(docker('rm', '-f', container['id']).returncode == 0, 'assigned_container_remove_failed')
        require(not container_present(container['id']), 'assigned_container_still_present')
    still_assigned()
    receipts = home / 'cleanup-receipts'
    require(not receipts.is_symlink(), 'receipt_directory_symlink')
    receipts.mkdir(mode=0o700, exist_ok=True)
    require(receipts.is_dir() and receipts.stat().st_uid == os.getuid()
            and stat.S_IMODE(receipts.stat().st_mode) == 0o700, 'receipt_directory_not_private')
    receipt = {'at': datetime.now(timezone.utc).isoformat(), 'worker': 'codex-track3', 'environmentId': environment,
               'assignmentSha256': hashlib.sha256(original).hexdigest(), 'scope': 'assigned_processes_and_greenmail_only',
               'processes': [resource['pid'] for resource in resources], 'containerId': container['id'] if container else None,
               'stack_stopped': False, 'purged': False, 'clean': True}
    destination = receipts / (str(uuid4()) + '.json')
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(receipt, stream, indent=2)
        stream.write('\n')
    print(json.dumps(receipt))
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
    # Inga Docker-inspektioner, kommandorader eller privata env-värden i felutdata.
    code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z_]+', str(error)) else 'cleanup_validation_or_runtime_failed'
    print('track3_cleanup_rejected: ' + code, file=sys.stderr)
    sys.exit(1)
finally:
    for descriptor in handles:
        os.close(descriptor)
PY
