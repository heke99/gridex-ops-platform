#!/usr/bin/env python3
"""Record/check the same live T5 backend, never replay, start or stop it.

The producer sources the unmodified canonical replay in a private scripts/supabase
copy, then invokes record before running up/scenarios in THAT SAME shell. Its
original EXIT trap retains cleanup ownership. This receipt binds observed identity;
it does not grant producer authority or authenticate canonical execution by itself.
The separate qualified producer/input/budget/custody gates remain required.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

# Production imports must preserve the clean source checkout, including when
# the caller did not pass -B. An unignored __pycache__ would invalidate custody.
sys.dont_write_bytecode = True


def require(value):
    if not value:
        raise ValueError('prepared_backend_rejected')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result)
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: require(False))


def digest(value, size=64):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{' + str(size) + '}', value)


def time(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None)
    return result


def validate(receipt, observation, assignment_bytes, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    a = parse(assignment_bytes)
    require(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T5' and a['state'] == 'ACTIVE')
    require(receipt['schema'] == 'gridex-t5-prepared-backend-v1'
            and receipt['assignmentSha256'] == sha(assignment_bytes)
            and time(receipt['recordedAt']) <= now < time(receipt['expiresAt']) <= time(a['expiresAt']))
    require(receipt['observation'] == observation)
    require(observation['sourceCommit'] == a['sourceCommit'] and digest(a['sourceCommit'], 40)
            and digest(observation['sourceTree'], 40))
    for k in ('sourceInputsSha256', 'replayScriptSha256', 'configSha256', 'replayLogSha256', 'schemaFingerprint', 'containerId', 'receiverJournalSha256'):
        require(digest(observation[k]))
    for k in ('environmentId', 'projectId', 'runDir', 'simHome'):
        require(observation[k] == a[k])
    require(isinstance(observation['dockerDaemonId'], str) and bool(observation['dockerDaemonId'].strip()))
    require(type(observation['dockerSocket']['device']) is int and observation['dockerSocket']['device'] >= 0
            and type(observation['dockerSocket']['inode']) is int and observation['dockerSocket']['inode'] > 0)
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', observation['containerImageId']))
    require(time(observation['containerStartedAt']) <= now)
    require(re.fullmatch(r'[1-9][0-9]*', observation['postgresSystemIdentifier']))
    require(type(observation['postgresVersion']) is int and 170000 <= observation['postgresVersion'] < 180000)
    ns, producer = observation['networkNamespace'], observation['producer']
    require(re.fullmatch(r'net:\[[0-9]+\]', ns) and producer['networkNamespace'] == ns
            and type(producer['pid']) is int and producer['pid'] > 1
            and re.fullmatch(r'[0-9]+', producer['startTimeTicks']))


def private(path, limit=131072):
    p = Path(path)
    require(p.is_absolute() and str(p.resolve()) == str(p))
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        r = subprocess.run(['git', '-C', str(p.parent), 'rev-parse', flag], capture_output=True, text=True, timeout=10)
        require(not (r.returncode == 0 and r.stdout.strip() == 'true'))
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600)
        with os.fdopen(fd, 'rb', closefd=False) as f:
            raw = f.read(limit + 1)
        require(len(raw) <= limit)
        return raw
    finally:
        os.close(fd)


def command(argv, raw=None):
    return subprocess.check_output(argv, input=raw, stderr=subprocess.DEVNULL, timeout=45).decode().strip()


def birth(pid):
    p = Path('/proc') / str(pid)
    require(p.stat().st_uid == os.getuid())
    fields = (p / 'stat').read_text().rsplit(')', 1)[1].split()
    require(fields[0] != 'Z')
    return {'pid': pid, 'startTimeTicks': fields[19], 'networkNamespace': os.readlink(p / 'ns/net')}


def socket_identity(home):
    endpoint = os.environ.get('DOCKER_HOST', '')
    require(not os.environ.get('DOCKER_CONTEXT') and endpoint == 'unix://' + str(home / 'docker.sock'))
    p = Path(endpoint[7:])
    require(str(p.resolve()) == str(p))
    info = p.stat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid())
    return {'device': info.st_dev, 'inode': info.st_ino}


def effective_ram(physical, cgroups, mounts, read):
    """Minimum visible current/ancestor limits, resolving actual cgroup mounts."""
    limits, matched = [physical], False
    groups = [line.split(':', 2) for line in cgroups.splitlines() if line]
    for line in mounts.splitlines():
        fields = line.split(); sep = fields.index('-')
        kind, options = fields[sep + 1], fields[sep + 3].split(',')
        if kind == 'cgroup2':
            paths = [g[2] for g in groups if g[0] == '0' and g[1] == '']
            filename = 'memory.max'
        elif kind == 'cgroup' and 'memory' in options:
            paths = [g[2] for g in groups if 'memory' in g[1].split(',')]
            filename = 'memory.limit_in_bytes'
        else:
            continue
        require(len(paths) == 1)
        root, mount, group = map(Path, (fields[3], fields[4], paths[0]))
        require(all(p.is_absolute() and '..' not in p.parts for p in (root, mount, group))
                and '\\' not in str(mount) and group.is_relative_to(root))
        current = mount / group.relative_to(root)
        while True:
            value = read(current / filename).strip()
            require(value == 'max' or value.isdigit())
            if value != 'max':
                limits.append(int(value))
            if current == mount:
                break
            current = current.parent
        matched = True
    # This Linux native profile requires readable memory-controller evidence.
    require(matched)
    return min(limits)


def capacity(docker):
    driver = docker['Driver']
    require(driver in ('vfs', 'overlay2', 'overlayfs'))
    root = Path(docker['DockerRootDir'])
    require(root.is_absolute() and root.resolve() == root)
    disk = os.statvfs(root)
    require(disk.f_bavail * disk.f_frsize >= (40 if driver == 'vfs' else 15) * 2 ** 30)
    physical = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    require(effective_ram(physical, Path('/proc/self/cgroup').read_text(),
                         Path('/proc/self/mountinfo').read_text(), lambda p: p.read_text()) >= 8 * 2 ** 30)


def source_inventory(app):
    paths = command(['git', '-C', str(app), 'ls-files', '-z']).split('\0')
    selected = sorted(p for p in paths if p and (p.startswith('supabase/') or p.startswith('scripts/')))
    require(selected)
    result = []
    for rel in selected:
        p = app / rel
        require(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(app))
        result.append([rel, sha(p.read_bytes())])
    return result


def source_inputs(app):
    return sha(json.dumps(source_inventory(app), separators=(',', ':')).encode())


def write_private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, separators=(',', ':')); f.write('\n')


def receiver_binding(a, assignment_sha, run=command, hosts_path=Path('/etc/hosts')):
    """Read-only consumption of the pre-Docker all-host probe in this same realm."""
    directory = Path(a['simHome']) / 'receiver'
    raw = private(Path(a['simHome']) / 'receiver-network.private.json')
    journal = parse(raw)
    require(journal['state'] == 'NETWORK_PROBED_NOT_RUNTIME_ADMITTED'
            and journal['assignmentSha256'] == assignment_sha
            and journal['namespaces'] == {k: os.readlink('/proc/self/ns/' + k) for k in ('net', 'mnt', 'pid')})
    require(journal['transportSha256'] == sha((Path(a['runDir']) / 'lib/integrations/publicWebhookTransport.ts').read_bytes()))
    hosts = directory / 'hosts.private'
    require(journal['hostsSha256'] == sha(private(hosts)) and hosts.samefile(hosts_path))
    for name in ('ca.pem', 'server.pem', 'server.key'):
        require(journal['tlsSha256'][name] == sha(private(directory / name)))
    spec = importlib.util.spec_from_file_location('t5_receiver_checks', Path(__file__).with_name('receiver-network.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.rules_present(a, lambda argv: run(argv))
    return sha(raw)


def stage(a, assignment_bytes):
    """Create the exact private pre-replay copy; preserve its inventory separately."""
    app, home = Path(a['runDir']), Path(a['simHome'])
    require(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T5' and a['state'] == 'ACTIVE'
            and time(a['expiresAt']) > dt.datetime.now(dt.timezone.utc)
            and a['ports']['SIM_DB_PORT'] == 54322)
    require(str(app.resolve()) == str(app) and str(home.resolve()) == str(home)
            and not app.is_relative_to(home) and not home.is_relative_to(app)
            and home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700)
    require(command(['git', '-C', str(app), 'rev-parse', 'HEAD']) == a['sourceCommit']
            and not command(['git', '-C', str(app), 'status', '--porcelain', '--untracked-files=normal']))
    inventory = source_inventory(app)
    replay = home / 'replay-root'
    replay.mkdir(mode=0o700)  # existing/partial copies never get overwritten
    for rel, expected in inventory:
        target = replay / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(app / rel, target)
        require(sha(target.read_bytes()) == expected)
    env = {**os.environ, 'SIM_AUTH_JWT_EXPIRY': '60', 'SIM_AUTH_SESSION_TIMEBOX': '3m'}
    args = ['SIM_API_PORT', 'SIM_DB_PORT', 'SIM_SHADOW_PORT', 'SIM_POOLER_PORT', 'SIM_STUDIO_PORT', 'SIM_MAIL_HTTP_PORT', 'SIM_SMTP_PORT']
    subprocess.run([sys.executable, '-I', str(app / 'scripts/simulation/track5/lib/prepare-supabase.py'),
                    str(replay / 'supabase/config.toml'), a['projectId'], *[str(a['ports'][k]) for k in args]],
                   env=env, check=True, capture_output=True, timeout=15)
    # The sole intentional staged difference is the declared disposable config.
    for rel, expected in inventory:
        if rel != 'supabase/config.toml':
            require(sha((replay / rel).read_bytes()) == expected)
    require(source_inventory(app) == inventory)
    write_private(home / 'replay-inputs.private.json', {'schema': 'gridex-t5-replay-input-copy-v1',
                  'assignmentSha256': sha(assignment_bytes), 'sourceCommit': a['sourceCommit'], 'files': inventory,
                  'configSha256': sha((replay / 'supabase/config.toml').read_bytes()), 'producer': birth(os.getppid())})


def observe(a, log_path, producer_pid):
    app, home = Path(a['runDir']), Path(a['simHome'])
    require(str(app.resolve()) == str(app) and str(home.resolve()) == str(home)
            and not app.is_relative_to(home) and not home.is_relative_to(app))
    require(home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700)
    require(command(['git', '-C', str(app), 'rev-parse', 'HEAD']) == a['sourceCommit']
            and not command(['git', '-C', str(app), 'status', '--porcelain', '--untracked-files=normal']))
    require(a['ports']['SIM_DB_PORT'] == 54322)  # canonical replay's existing local ABI
    replay = home / 'replay-root'
    require(replay.resolve() == replay)
    staged = parse(private(home / 'replay-inputs.private.json', 16 * 1024 * 1024))
    require(staged['schema'] == 'gridex-t5-replay-input-copy-v1' and staged['sourceCommit'] == a['sourceCommit']
            and staged['files'] == source_inventory(app) and staged['producer'] == birth(producer_pid))
    receiver_journal = receiver_binding(a, staged['assignmentSha256'])
    # Canonical sourcing transforms migration/seed bytes until its EXIT cleanup.
    # Bind all other executed-copy inputs to the actual pre-replay inventory.
    for rel, expected in staged['files']:
        if not rel.startswith('supabase/migrations/') and rel not in ('supabase/seed.sql', 'supabase/config.toml'):
            p = replay / rel
            require(not p.is_symlink() and p.resolve().is_relative_to(replay) and sha(p.read_bytes()) == expected)
    original = app / 'scripts/gridex-aud-003-clean-replay.sh'
    require((replay / 'scripts/gridex-aud-003-clean-replay.sh').read_bytes() == original.read_bytes())
    log = private(log_path, 64 * 1024 * 1024)
    require(b'external mode: NO ledger provenance' not in log)
    require(b'[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger' in log)
    fingerprints = re.findall(rb'^\[GRIDEX-REM-002 replay\] schema fingerprint verified: ([0-9a-f]{64})$', log, re.M)
    require(len(fingerprints) == 1)
    config = (replay / 'supabase/config.toml').read_bytes()
    require(sha(config) == staged['configSha256'])
    import tomllib
    cfg = tomllib.loads(config.decode())
    require(cfg['project_id'] == a['projectId'] and cfg['db']['port'] == 54322 and cfg['db']['major_version'] == 17)
    for table, key in [('api', 'SIM_API_PORT'), ('db', 'SIM_DB_PORT'), ('studio', 'SIM_STUDIO_PORT')]:
        require(cfg[table]['port'] == a['ports'][key])
    require(cfg['db']['shadow_port'] == a['ports']['SIM_SHADOW_PORT']
            and cfg['db']['pooler']['port'] == a['ports']['SIM_POOLER_PORT']
            and cfg['inbucket']['port'] == a['ports']['SIM_MAIL_HTTP_PORT']
            and cfg['inbucket']['smtp_port'] == a['ports']['SIM_SMTP_PORT'])
    docker = parse(command(['docker', 'info', '--format', '{{json .}}']))
    capacity(docker)
    socket = socket_identity(home)
    data = parse(command(['docker', 'inspect', 'supabase_db_' + a['projectId']]))
    require(isinstance(data, list) and len(data) == 1)
    container = data[0]
    require(container['State']['Running'] is True
            and container['Config']['Labels'].get('com.supabase.cli.project') == a['projectId'])
    port = container['NetworkSettings']['Ports']['5432/tcp']
    require(port and all(x['HostPort'] == '54322' and x['HostIp'] in ('127.0.0.1', '0.0.0.0', '::') for x in port))
    argv = ['docker', 'exec', '-i', container['Id'], 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
    identity = parse(command(argv, b"select json_build_object('systemIdentifier',(select system_identifier::text from pg_control_system()),'version',current_setting('server_version_num')::int);"))
    fingerprint = command(argv, (app / 'scripts/gridex-aud-003-schema-fingerprint.sql').read_bytes())
    require(fingerprint == fingerprints[0].decode())
    expected = [(str(x['version']), x['name']) for x in parse((app / 'scripts/gridex-aud-003-main-ledger.json').read_bytes())['entries']]
    actual = command(argv, b"select version::text||chr(9)||name from supabase_migrations.schema_migrations order by version::text;")
    require([tuple(x.split('\t', 1)) for x in actual.splitlines()] == expected)
    return {'sourceCommit': a['sourceCommit'], 'sourceTree': command(['git', '-C', str(app), 'rev-parse', 'HEAD^{tree}']),
            'sourceInputsSha256': source_inputs(app), 'replayScriptSha256': sha(original.read_bytes()),
            'configSha256': sha(config), 'replayLogSha256': sha(log), 'schemaFingerprint': fingerprint,
            'receiverJournalSha256': receiver_journal,
            **{k: a[k] for k in ('environmentId', 'projectId', 'runDir', 'simHome')},
            'dockerDaemonId': docker['ID'], 'dockerSocket': socket,
            'networkNamespace': os.readlink('/proc/self/ns/net'), 'containerId': container['Id'],
            'containerImageId': container['Image'], 'containerStartedAt': container['State']['StartedAt'],
            'postgresSystemIdentifier': identity['systemIdentifier'], 'postgresVersion': identity['version'],
            'producer': birth(producer_pid)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('stage', 'record', 'verify'))
    parser.add_argument('--assignment', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--replay-log', required=True)
    args = parser.parse_args()
    try:
        raw = private(args.assignment); a = parse(raw)
        p = Path(args.receipt)
        require(p == Path(a['simHome']) / 'prepared-backend.json')
        if args.operation == 'stage':
            stage(a, raw)
            print(json.dumps({'state': 'EXACT_REPLAY_INPUT_COPY_STAGED', 'canonicalExecutionAuthority': False}))
            return 0
        if args.operation == 'record':
            observation = observe(a, args.replay_log, os.getppid())
            staged = parse(private(Path(a['simHome']) / 'replay-inputs.private.json', 16 * 1024 * 1024))
            require(staged['assignmentSha256'] == sha(raw))
            receipt = {'schema': 'gridex-t5-prepared-backend-v1', 'assignmentSha256': sha(raw),
                       'recordedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'expiresAt': a['expiresAt'], 'observation': observation}
            validate(receipt, observation, raw)
            write_private(p, receipt)
        else:
            receipt = parse(private(args.receipt))
            require(parse(private(Path(a['simHome']) / 'replay-inputs.private.json', 16 * 1024 * 1024))['assignmentSha256'] == sha(raw))
            observation = observe(a, args.replay_log, receipt['observation']['producer']['pid'])
            validate(receipt, observation, raw)
        print(json.dumps({'state': 'SAME_PREPARED_BACKEND_OBSERVED', 'canonicalExecutionAuthority': False}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        print(json.dumps({'state': 'HOLD', 'error': 'prepared_backend_rejected'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
