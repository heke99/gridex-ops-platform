#!/usr/bin/env python3
"""Source-bound T2 disposable runtime admission, evidence and exact cleanup."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess

GIB = 1024 ** 3
DRIVERS = {"overlay2": 15 * GIB, "overlayfs": 15 * GIB, "vfs": 40 * GIB}


def positive_integer(value):
    return type(value) is int and value > 0


def capacity_errors(observation):
    """Evaluate measured inputs only. Passing does not authenticate their origin."""
    errors = []
    driver = observation.get("driver")
    if driver not in DRIVERS:
        errors.append("unknown-driver")
    ram = observation.get("effectiveRAMBytes")
    if not positive_integer(ram) or ram < 8 * GIB:
        errors.append("insufficient-or-unknown-ram")
    free = observation.get("dockerRootFreeBytes")
    if not positive_integer(free) or (driver in DRIVERS and free < DRIVERS[driver]):
        errors.append("insufficient-or-unknown-docker-root-free")
    if not observation.get("dockerRootDir") or observation.get("rootNamespaceVerified") is not True:
        errors.append("docker-root-namespace-unverified")
    if not observation.get("daemonId") or not observation.get("socketIdentity"):
        errors.append("daemon-or-socket-identity-missing")
    if not observation.get("cpuQuota"):
        errors.append("cpu-quota-unrecorded")
    return errors


def read_text(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def observe_host():
    physical = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    limits = [physical]
    cpu_limits = []
    # Walk visible cgroup ancestors, preserving every finite inherited limit.
    cgroup = Path("/sys/fs/cgroup")
    membership = read_text("/proc/self/cgroup") or ""
    relative = next((line[3:] for line in membership.splitlines() if line.startswith("0::")), "/")
    current = cgroup / relative.lstrip("/")
    while current == cgroup or cgroup in current.parents:
        cpu = read_text(current / "cpu.max")
        if cpu:
            cpu_limits.append({"cgroup":str(current), "quota":cpu})
        raw = read_text(current / "memory.max")
        if raw and raw.isdigit():
            limits.append(int(raw))
        if current == cgroup:
            break
        current = current.parent
    result = {"schema": "gridex-t2-host-observation-v1", "state": "OBSERVED_NOT_ADMITTED",
              "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "effectiveRAMBytes": min(limits), "cpuQuota": cpu_limits or None,
              "cpuCount": os.cpu_count(), "rootNamespaceVerified": False}
    # Select only non-secret fields; never emit environment, Docker config or full info.
    try:
        info = subprocess.run(["docker", "info", "--format", "{{json .}}"],
                              capture_output=True, text=True, timeout=15, check=True)
        data = json.loads(info.stdout)
        result.update(driver=data.get("Driver"), daemonId=data.get("ID"),
                      dockerRootDir=data.get("DockerRootDir"), serverVersion=data.get("ServerVersion"))
        daemon_memory = data.get("MemTotal")
        if positive_integer(daemon_memory):
            result["effectiveRAMBytes"] = min(result["effectiveRAMBytes"], daemon_memory)
        # A daemon can be remote or in another mount namespace: no statvfs guess.
        result["dockerRootFreeBytes"] = None
    except (OSError, subprocess.SubprocessError, ValueError):
        result["dockerObservationError"] = "docker-info-unavailable"
    try:
        stat = Path("/var/run/docker.sock").stat()
        result["socketIdentity"] = {"device": stat.st_dev, "inode": stat.st_ino}
    except OSError:
        result["socketIdentity"] = None
    result["capacityErrors"] = capacity_errors(result)
    return result


# Operational commands have a fixed subprocess surface. Tests replace this function.
def command(argv, *, stdin=None):
    return subprocess.run(argv, input=stdin, text=True, capture_output=True,
                          timeout=120, check=True).stdout.strip()


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private_file(path):
    import stat
    p = Path(path)
    s = p.lstat()
    require(not p.is_symlink() and p.is_file() and s.st_uid == os.getuid()
            and stat.S_IMODE(s.st_mode) == 0o600, 'private-file-required')
    return p


def save_private(path, value):
    # Exclusive creation: old attempt/evidence never overwritten.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write('\n')


def load_private(path):
    return json.loads(private_file(path).read_text())


def git(app, *args):
    return command(['git', '-C', str(app), *args])


def verify_binding(binding):
    import re
    require(isinstance(binding, dict), 'reservation-binding-missing')
    refs, receipt = binding.get('refs', [binding.get('ref', '')]), binding.get('receipt', '')
    require(isinstance(refs, list) and refs and len(set(refs)) == len(refs), 'invalid-reservation-refs')
    ref = refs[0]
    require(re.fullmatch(r'refs/tags/agent-claims/masterplan/[A-Za-z0-9_-]+', ref) is not None
            and re.fullmatch('[0-9a-f]{40}', receipt) is not None, 'invalid-reservation-binding')
    endpoint = 'repos/heke99/gridex-ops-platform/git/'
    for ref in refs:
        require(re.fullmatch(r'refs/tags/agent-claims/masterplan/[A-Za-z0-9_-]+', ref) is not None, 'invalid-reservation-ref')
        actual = json.loads(command(['gh', 'api', endpoint + 'ref/' + ref.removeprefix('refs/')]))
        require(actual['object']['type'] == 'commit' and actual['object']['sha'] == receipt,
                'reservation-ref-changed')
    commit = json.loads(command(['gh', 'api', endpoint + 'commits/' + receipt]))
    base = json.loads(command(['gh', 'api', endpoint + 'commits/' + binding['base']]))
    require(commit['tree']['sha'] == base['tree']['sha'], 'receipt-not-neutral-to-actual-base')
    require(commit['tree']['sha'] == binding['tree']
            and [p['sha'] for p in commit['parents']] == [binding['base']]
            and json.loads(commit['message']) == binding['body'], 'reservation-capsule-mismatch')
    body = binding['body']
    require(set(body) == {'base','files','operation'} and body['base'] == binding['base']
            and body['files'] == sorted(set(body['files'])), 'receipt-neutral-shape-required')
    if '; resources-sha256=' in body['operation']:
        import hashlib
        require(refs == sorted(refs), 'source-resource-order-required')
        expected = hashlib.sha256('\n'.join(refs).encode()).hexdigest()
        require(body['operation'].endswith('; resources-sha256=' + expected), 'source-resource-set-digest-mismatch')
        files = {'refs/tags/agent-claims/masterplan/file-' + hashlib.sha256(p.encode()).hexdigest() for p in body['files']}
        require(files.issubset(refs) and any('/slot-' in ref for ref in refs), 'source-all-target-set-incomplete')



def canonical_sha256(value):
    import hashlib
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def verify_native_binding(binding, assignment, kind):
    """New T2-only binding; never aliases or loosens a legacy native machine binding."""
    import uuid
    native = 'refs/tags/agent-claims/masterplan/' + kind + '-t2-term-disposable'
    proof = binding['privateProof']
    require(proof['protocol'] == 'masterplan-reservation-v1' and proof['worker'] == 'T2'
            and proof['resourceKind'] == kind and proof['epoch'] == 'gridex-five-agent-20261012', 'native-private-proof-protocol-mismatch')
    packet = str(uuid.UUID(proof['packet']))
    require(proof['slot'] == 'session-' + packet and proof['agent'] == assignment['runtimeOwner']
            and proof['branch'] and proof['checkpoint'] and proof['nextAction'] and proof['createdAt']
            and proof['ids'] == [] and proof['base'] == binding['base'], 'native-private-owner-scope-mismatch')
    expected = {'source': assignment['sourceCommit'], 'sourceTree': assignment['sourceTree'],
                'workflowSHA256': assignment['sourceFiles']['.github/workflows/t2-term-disposable.yml'],
                'inputEpoch': assignment['inputEpoch'], 'budget': assignment['budget'],
                'expiresAt': assignment['expiresAt'], 'cleanupExpiresAt': assignment['cleanupExpiresAt'],
                'environmentId': assignment['environmentId'], 'github': assignment['github'],
                'files': sorted(assignment['sourceFiles'])}
    require(all(proof.get(key) == value for key, value in expected.items()), 'native-private-source-input-budget-mismatch')
    refs = sorted([native, 'refs/tags/agent-claims/masterplan/slot-session-' + packet])
    require(binding['ref'] == native and binding['refs'] == refs, 'native-exact-own-resource-set-required')
    operation = ('Acquire qualified T2 disposable backend' if kind == 'backend' else 'Produce qualified T2 TERM native proof')
    body = {'base': binding['base'], 'files': proof['files'],
            'operation': operation + '; private-proof-sha256=' + canonical_sha256(proof)}
    require(binding['body'] == body, 'native-private-proof-digest-mismatch')
    verify_binding(binding)


def verify_owned_source_scope(assignment, app):
    """Authenticated custody must cover the explicit adopted runtime scope, not readonly inputs."""
    workflow = '.github/workflows/t2-term-disposable.yml'
    prefix = 'scripts/simulation/track2/'
    tracked = git(app, 'ls-files', '--', 'scripts/simulation/track2', workflow).splitlines()
    required = sorted(tracked)
    require(required and workflow in required and len(required) == len(set(required))
            and all(path == workflow or path.startswith(prefix) for path in required),
            'adopted-runtime-scope-unavailable')
    require(assignment.get('ownedSourceFiles') == required,
            'signed-owned-source-scope-mismatch')
    require(set(required).issubset(assignment['sourceFiles']),
            'owned-source-bytes-not-pinned')
    authenticated = set()
    for binding in assignment['sourceCustody']:
        authenticated.update(binding['body']['files'])
    require(set(required).issubset(authenticated),
            'ordinary-custody-does-not-cover-runtime-scope')
    # Extra original capsule paths are only readback context, never an implicit grant.


def authenticate(operation):
    """Pinned T2 signature plus authenticated exact receipts; never trusts ACTIVE alone."""
    import tempfile
    assignment = private_file(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
    signature = private_file(str(assignment) + '.sig')
    profile = json.loads(Path(__file__).with_name('profile.requirements.json').read_text())
    with tempfile.TemporaryDirectory() as directory:
        public = Path(directory) / 'admission.pub'
        public.write_text(profile['admissionPublicKey'])
        command(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', str(public),
                 '-rawin', '-in', str(assignment), '-sigfile', str(signature)])
    a = json.loads(assignment.read_text())
    require(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T2'
            and a['state'] == 'ACTIVE' and operation in a['allowedOperations'], 'assignment-operation-rejected')
    require(type(a['allowedOperations']) is list and set(a['allowedOperations']) == {'up','run','down'}, 'cleanup-operation-must-be-authorized')
    require(datetime.datetime.fromisoformat(a['cleanupExpiresAt'].replace('Z', '+00:00')) > datetime.datetime.fromisoformat(a['expiresAt'].replace('Z', '+00:00')), 'cleanup-window-must-outlast-runtime')
    expiry = a['cleanupExpiresAt'] if operation == 'down' else a['expiresAt']
    require(datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00')) >
            datetime.datetime.now(datetime.timezone.utc), 'assignment-expired')
    import re
    require(re.fullmatch(r'scenarios/(smoke|term01|term02|term03)\.test\.ts', a['scenario']) is not None, 'invalid-scenario')
    run = a['github']
    require(type(run['runId']) is int and run['runId'] > 0 and type(run['runAttempt']) is int, 'github-run-number-invalid')
    require(os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('GITHUB_REPOSITORY') == 'heke99/gridex-ops-platform'
            and os.environ.get('GITHUB_RUN_ID') == str(run['runId'])
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1' and run['runAttempt'] == 1
            and os.environ.get('GITHUB_SHA') == a['sourceCommit'], 'github-invocation-mismatch')
    if operation != 'down':
        require(os.environ.get('SIM_REQUIRE_ACTOR_RECEIPT') == '1', 'observed-actor-mode-required')
    observed = json.loads(command(['gh', 'api', 'repos/heke99/gridex-ops-platform/actions/runs/' + str(run['runId'])]))
    require(observed['head_sha'] == a['sourceCommit'] and observed['run_attempt'] == 1
            and observed['event'] == 'workflow_dispatch'
            and observed['path'] == '.github/workflows/t2-term-disposable.yml', 'github-run-not-qualified')
    require(a['budget'] == {'startup': 1, 'scenario': 1}
            and all(type(v) is int for v in a['budget'].values()) and a['inputEpoch'] and a['genSource']
            and isinstance(a['syntheticActors'], dict) and a['clock'] and a['cleanupPolicy'] == 'exact-owned-resources',
            'runtime-inputs-missing')
    for kind in ('backend', 'producer'):
        verify_native_binding(a['startupAttempt'][kind + 'Reservation'], a, kind)
    require(a['startupAttempt']['exclusiveHost'] is True and a['sourceCustody'], 'exclusive-allocation-required')
    for binding in a['sourceCustody']:
        require(binding['body']['operation'].startswith('Reserve source files and rule IDs; resources-sha256='), 'ordinary-source-custody-required')
        verify_binding(binding)
    app = Path(os.environ['RUN_DIR'])
    home = Path(os.environ['SIM_HOME'])
    require(str(app.resolve()) == a['runDir'] and str(home.resolve()) == a['simHome']
            and not home.is_relative_to(app) and not home.is_symlink(), 'runtime-path-binding-mismatch')
    verify_owned_source_scope(a, app)
    require(git(app, 'rev-parse', 'HEAD') == a['sourceCommit']
            and git(app, 'rev-parse', 'HEAD^{tree}') == a['sourceTree'], 'source-tuple-changed')
    required = {'.github/workflows/t2-term-disposable.yml', 'package-lock.json',
                'scripts/gridex-aud-003-clean-replay.sh', 'scripts/gridex-aud-003-main-ledger.json',
                'scripts/migration-history-manifest.json', 'scripts/migration-history-manifest.additions.json',
                'scripts/migration-history-manifest.runtime.additions.json'}
    required.add('scripts/simulation/track2/' + a['scenario'])
    required.update('scripts/simulation/track2/' + p for p in ('up.sh','run.sh','down.sh','lib/common.sh','lib/prepare-supabase.py'))
    required.update('scripts/simulation/track2/hosted/' + p for p in ('prepare.sh','cleanup.sh','qualify-runtime.py','profile.requirements.json'))
    require(required.issubset(a['sourceFiles']),
            'source-file-vector-missing')
    for relative, expected in a['sourceFiles'].items():
        path = app / relative
        require(not Path(relative).is_absolute() and path.resolve().is_relative_to(app.resolve())
                and not path.is_symlink() and digest(path) == expected, 'source-file-changed')
    require(a['clock'] == {'jwt':'REAL_UTC','businessOracle':'EXPLICIT_FIXTURE_DATES','marketOffset':'+01:00','civilZone':'Europe/Stockholm','clockMutation':False}, 'clock-policy-mismatch')
    actors = a['syntheticActors']
    require(actors.get('policy') == 'source-bound-synthetic-only-observed-receipts-required'
            and actors.get('ordinarySignup') == 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION'
            and actors.get('observedReceiptState') == 'REQUIRED_AFTER_SCENARIO', 'synthetic-actor-policy-unqualified')
    expected_actor_sources = ['scripts/simulation/track2/lib/fixture.ts', 'scripts/simulation/track2/lib/session.ts',
                              'scripts/simulation/track2/lib/term-fixture.ts']
    require(set(actors['sourceFiles']) == set(expected_actor_sources)
            and all(a['sourceFiles'].get(path) == expected for path, expected in actors['sourceFiles'].items()),
            'synthetic-actor-source-policy-mismatch')
    if home.exists():
        import stat
        require(home.is_dir() and home.stat().st_uid == os.getuid()
                and stat.S_IMODE(home.stat().st_mode) == 0o700, 'private-home-required')
    if operation != 'down':
        gen = a['genSource']
        require(isinstance(gen, dict) and gen['commit'] and gen['files'], 'gen-source-binding-missing')
        git(app, 'merge-base', '--is-ancestor', gen['commit'], a['sourceCommit'])
        for relative, expected in gen['files'].items():
            require(relative in a['sourceFiles'] and a['sourceFiles'][relative] == expected, 'gen-source-hash-mismatch')
        require(not git(app, 'status', '--porcelain', '--untracked-files=normal'), 'source-dirty')
    return a, home, app


def daemon_identity(capacity=True):
    # Operational mode accepts only a local system daemon in this mount namespace.
    require(os.environ.get('DOCKER_HOST', 'unix:///var/run/docker.sock') == 'unix:///var/run/docker.sock'
            and not os.environ.get('DOCKER_CONTEXT'), 'remote-daemon-forbidden')
    require(command(['docker', 'context', 'show']) == 'default'
            and json.loads(command(['docker','context','inspect','default','--format','{{json .Endpoints.docker.Host}}'])) == 'unix:///var/run/docker.sock', 'local-default-docker-context-required')
    info = json.loads(command(['docker', 'info', '--format', '{{json .}}']))
    pid = int(Path('/var/run/docker.pid').read_text().strip())
    require(Path(f'/proc/{pid}/comm').read_text().strip() == 'dockerd'
            and command(['sudo', '-n', 'readlink', f'/proc/{pid}/ns/mnt']) == os.readlink('/proc/self/ns/mnt'),
            'daemon-mount-namespace-unverified')
    root = Path(info['DockerRootDir'])
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(), 'docker-root-unavailable')
    # sudo statvfs runs in this already verified mount namespace, no container/image pull.
    free = int(command(['sudo', '-n', 'python3', '-c',
                        'import os,sys;s=os.statvfs(sys.argv[1]);print(s.f_bavail*s.f_frsize)', str(root)]))
    sock = Path('/var/run/docker.sock').stat()
    observation = observe_host()
    observation.update(driver=info['Driver'], daemonId=info['ID'], dockerRootDir=str(root),
                       dockerRootFreeBytes=free, rootNamespaceVerified=True,
                       socketIdentity={'device': sock.st_dev, 'inode': sock.st_ino})
    if capacity:
        require(not capacity_errors(observation), 'host-capacity-unqualified')
    return {k: observation[k] for k in ('driver', 'daemonId', 'dockerRootDir', 'socketIdentity')}, observation


def docker_resources(project):
    """Exact immutable identity fields only; never retain inspect's env/secrets."""
    result = []
    for kind in ('container', 'network', 'volume'):
        args = ['docker', kind, 'ls', '-q']
        if kind == 'container':
            args.append('-a')
        ids = command(args).splitlines()
        for resource in ids:
            data = json.loads(command(['docker', kind, 'inspect', resource]))[0]
            labels = data.get('Config', {}).get('Labels', {}) if kind == 'container' else data.get('Labels', {})
            labels = labels or {}
            if kind == 'network' and data.get('Name') in ('bridge', 'host', 'none'):
                continue
            require(labels.get('com.supabase.cli.project') == project, 'foreign-daemon-resource')
            require(data.get('Created') or data.get('CreatedAt'), 'resource-birth-identity-missing')
            import re
            require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', data.get('Id') or data['Name']) is not None, 'invalid-resource-id')
            result.append({'kind': kind, 'id': data.get('Id') or data['Name'], 'name': data['Name'],
                           'created': data.get('Created') or data.get('CreatedAt'),
                           'project': labels['com.supabase.cli.project']})
    return sorted(result, key=lambda x: (x['kind'], x['id']))


def inventory(a, home):
    identity, _ = daemon_identity(capacity=False)
    state = load_private(home / 'attempt.json')
    require(identity == state['daemon'], 'daemon-identity-changed')
    resources = docker_resources(a['projectId'])
    # Append-only snapshots cover failures during startup; no recorded snapshot is replaced.
    import uuid
    save_private(home / ('resources-' + str(uuid.uuid4()) + '.json'),
                 {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']), 'resources': resources})
    return resources


def prepare_attempt():
    require(__import__('sys').version_info >= (3, 11), 'python311-required')
    a, home, app = authenticate('up')
    import re
    require(re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', a['projectId']) is not None
            and a['projectId'] != 'gridex-ops-platform', 'invalid-project')
    ports = a['ports']
    require(len(ports) == 9 and len(set(ports.values())) == 9
            and all(type(v) is int and 1024 <= v <= 65535 for v in ports.values()), 'invalid-ports')
    require(not home.exists(), 'fresh-home-required')
    require(command(['node', '--version']).startswith('v22.')
            and command(['supabase', '--version']).splitlines()[-1] == '2.101.0'
            and ' 17.' in command(['psql', '--version']) and ' 17.' in command(['pg_dump', '--version']),
            'runtime-toolchain-mismatch')
    identity, observation = daemon_identity()
    require(not docker_resources(a['projectId']), 'fresh-daemon-required')
    # Check nine assigned listen ports before any service startup.
    import socket
    sockets = []
    try:
        for port in ports.values():
            listener = socket.socket()
            listener.bind(('127.0.0.1', port))
            sockets.append(listener)
    finally:
        for listener in sockets:
            listener.close()
    home.mkdir(mode=0o700)
    require(subprocess.run(['git', '-C', str(home), 'rev-parse', '--is-inside-work-tree'], capture_output=True).returncode != 0, 'private-home-inside-git')
    save_private(home / 'attempt.json', {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                                       'daemon': identity, 'host': observation})
    # One cgroup owns every runtime child, including detached Next descendants.
    cgroup = Path('/sys/fs/cgroup') / ('gridex-t2-' + str(a['github']['runId']))
    command(['sudo', '-n', 'mkdir', str(cgroup)])
    stat = cgroup.stat()
    save_private(home / 'cgroup.json', {'path': str(cgroup), 'device': stat.st_dev, 'inode': stat.st_ino})
    require((cgroup / 'cgroup.kill').exists(), 'cgroup-v2-kill-required')


def validate_attempt(a, home):
    attempt = load_private(home / 'attempt.json')
    require(attempt['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']), 'attempt-assignment-changed')
    identity, _ = daemon_identity(capacity=False)
    require(attempt['daemon'] == identity, 'daemon-identity-changed')


def owned_cgroup(a, home):
    group = load_private(home / 'cgroup.json')
    path = Path(group['path'])
    require(path.parent == Path('/sys/fs/cgroup')
            and path.name == 'gridex-t2-' + str(a['github']['runId']), 'cgroup-path-mismatch')
    stat = path.stat()
    require(stat.st_dev == group['device'] and stat.st_ino == group['inode'], 'cgroup-identity-changed')
    return path


def authorize(operation):
    a, home, app = authenticate(operation)
    validate_attempt(a, home)
    if operation in ('up', 'run'):
        path = owned_cgroup(a, home)
        require(read_text('/proc/self/cgroup').splitlines() == ['0::/' + path.name], 'runtime-process-outside-owned-cgroup')
    if operation == 'up':
        save_private(home / 'up-consumed.json', {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])})
    elif operation == 'run':
        evidence = load_private(home / 'qualified.json')
        require(evidence['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
                and evidence['buildId'] == (app / '.next/BUILD_ID').read_text().strip()
                and evidence['buildManifest'] == digest(app / '.next/build-manifest.json')
                and evidence['buildLog'] == digest(home / 'logs/build.log')
                and evidence['replayLog'] == digest(home / 'logs/replay.log'), 'runtime-evidence-changed')
        require(evidence['resources'] == inventory(a, home), 'runtime-resource-identity-changed')
        require(evidence['database'] == database_evidence(a, home), 'database-evidence-changed')
        save_private(home / 'scenario-consumed.json', {'scenario': a['scenario']})
    return a, home, app


def database_evidence(a, home):
    # Local replay identity, no caller DB URL or credential values in argv/output logs.
    port = str(a['ports']['SIM_DB_PORT'])
    def query(sql):
        return command(['psql', '-X', '-w', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres',
                        '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])
    old = os.environ.get('PGPASSWORD')
    os.environ['PGPASSWORD'] = 'postgres'  # disposable CLI local replay fixture, never a customer credential
    try:
        ledger = query("select version::text||E'\\t'||name from supabase_migrations.schema_migrations order by version::text")
        expected = json.loads((Path(a['runDir']) / 'scripts/gridex-aud-003-main-ledger.json').read_text())['entries']
        require(ledger.splitlines() == [str(x['version']) + '\t' + x['name'] for x in expected], 'installed-ledger-mismatch')
        system = query('select system_identifier::text from pg_control_system()')
        version = query("select current_setting('server_version_num')")
        require(int(version) // 10000 == 17 and system.isdigit(), 'database-identity-unqualified')
        fingerprint = command(['psql', '-X', '-w', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres',
                               '-At', '-v', 'ON_ERROR_STOP=1', '-f', str(Path(a['runDir']) / 'scripts/gridex-aud-003-schema-fingerprint.sql')])
        require(fingerprint == a['schemaFingerprint'], 'schema-fingerprint-mismatch')
        return {'systemIdentifier': system, 'version': version, 'ledger': ledger, 'fingerprint': fingerprint}
    finally:
        if old is None:
            os.environ.pop('PGPASSWORD', None)
        else:
            os.environ['PGPASSWORD'] = old


def qualify():
    a, home, app = authenticate('run')
    validate_attempt(a, home)
    require((home / 'up-consumed.json').exists() and not (home / 'scenario-consumed.json').exists(), 'startup-not-owned')
    require((home / 'replay-commit').read_text().strip() == a['sourceCommit']
            and (home / 'built-commit').read_text().strip() == a['sourceCommit'], 'replay-build-source-mismatch')
    database = database_evidence(a, home)
    ledger = home / 'applied-migrations.tsv'
    with ledger.open('x') as stream:
        os.chmod(ledger, 0o600)
        stream.write(database['ledger'] + '\n')
    require(digest(home / 'replay-root/scripts/gridex-aud-003-clean-replay.sh') == a['replayPatchSha256'],
            'replay-patch-not-qualified')
    restore = load_private(home / 'replay-restoration.json')
    require(restore['before'] == restore['after'], 'replay-source-not-restored')
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    private_env = private_file(home / 'app.env').read_text().splitlines()
    values = dict(line.split('=', 1) for line in private_env if line and not line.startswith('#') and '=' in line)
    auth_url = 'http://127.0.0.1:' + str(a['ports']['SIM_API_PORT']) + '/auth/v1/health'
    with opener.open(urllib.request.Request(auth_url, headers={'apikey': values['NEXT_PUBLIC_SUPABASE_ANON_KEY']}), timeout=10) as response:
        require(response.status == 200, 'local-auth-health-unqualified')
    for url in ('http://127.0.0.1:' + str(a['ports']['SIM_APP_PORT']) + '/',
                'http://127.0.0.1:' + str(a['ports']['SIM_COUNTERPART_PORT']) + '/__health',
                'http://127.0.0.1:' + str(a['ports']['SIM_MAIL_HTTP_PORT']) + '/api/v1/info'):
        with opener.open(url, timeout=10) as response:
            require(response.status == 200, 'runtime-endpoint-unqualified')
    save_private(home / 'qualified.json', {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                 'resources': inventory(a, home), 'database': database,
                 'buildId': (app / '.next/BUILD_ID').read_text().strip(),
                 'buildManifest': digest(app / '.next/build-manifest.json'),
                 'replayLog': digest(home / 'logs/replay.log'), 'buildLog': digest(home / 'logs/build.log')})


def cleanup():
    a, home, app = authenticate('down')
    if not home.exists():
        return  # no prepared attempt, no runtime side effects authorized
    validate_attempt(a, home)
    resources = docker_resources(a['projectId'])
    recorded = []
    for snapshot in home.glob('resources-*.json'):
        evidence = load_private(snapshot)
        require(evidence['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']), 'inventory-assignment-changed')
        recorded.extend(evidence['resources'])
    require(all(resource in recorded for resource in resources), 'unrecorded-resource-refuse-cleanup')
    import uuid
    journal = home / ('cleanup-' + str(uuid.uuid4()) + '.json')
    save_private(journal, {'state': 'PREFLIGHT', 'resources': resources})
    cgroup_file = home / 'cgroup.json'
    if cgroup_file.exists():
        stopped = home / 'cgroup-stopped.json'
        if stopped.exists():
            record = load_private(stopped)
            require(record == {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                               'groupReceipt': digest(cgroup_file)}, 'cgroup-stop-receipt-changed')
            require(not Path(load_private(cgroup_file)['path']).exists(), 'stopped-cgroup-reappeared')
        else:
            path = owned_cgroup(a, home)
            command(['sudo', '-n', 'sh', '-c', 'printf 1 > "$1/cgroup.kill"', 'sh', str(path)])
            import time
            for _ in range(50):
                if not (path / 'cgroup.procs').read_text().strip():
                    break
                time.sleep(.1)
            require(not (path / 'cgroup.procs').read_text().strip(), 'cgroup-not-empty')
            command(['sudo', '-n', 'rmdir', str(path)])
            save_private(stopped, {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                                   'groupReceipt': digest(cgroup_file)})
    # New inventories must equal the exact preflight set; foreign changes stop cleanup.
    require(resources == docker_resources(a['projectId']), 'resource-set-changed-before-cleanup')
    for kind in ('container', 'network', 'volume'):
        for resource in [x for x in resources if x['kind'] == kind]:
            current = docker_resources(a['projectId'])
            require(resource in current, 'cleanup-resource-identity-changed')
            command(['docker', kind, 'rm', *(['-f'] if kind == 'container' else []), resource['id']])
    require(not docker_resources(a['projectId']), 'cleanup-incomplete')
    save_private(home / ('cleanup-done-' + journal.stem + '.json'), {'state': 'DONE', 'preflight': digest(journal)})


def snapshot_replay(home, phase):
    root = home / 'replay-root'
    data = {}
    for directory in ('supabase/migrations', 'scripts'):
        for path in sorted((root / directory).rglob('*')):
            if path.is_file() and not path.is_symlink():
                data[str(path.relative_to(root))] = digest(path)
    for relative in ('supabase/seed.sql', 'supabase/config.toml'):
        data[relative] = digest(root / relative)
    if phase == 'before':
        save_private(home / 'replay-before.json', data)
    else:
        before = load_private(home / 'replay-before.json')
        save_private(home / 'replay-restoration.json', {'before': before, 'after': data})
        require(before == data, 'replay-source-not-restored')


def qualify_actors():
    """Per-case collector sources enforce observations before each ordinary business fetch."""
    import re
    import uuid
    a, home, _ = authenticate('run')
    validate_attempt(a, home)
    require((home / 'scenario-consumed.json').exists(), 'scenario-not-consumed')
    directory = home / 'actor-receipts'
    import stat
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == os.getuid()
            and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'actor-receipt-directory-not-private')
    paths = sorted(directory.glob('*.json'))
    require(paths, 'observed-actor-receipts-missing')
    observations = []
    counts = {'authorized':0, 'expected_denial':0}
    for path in paths:
        receipt = load_private(path)
        require(receipt['schema'] == 'gridex-t2-observed-actor-v1'
                and receipt['assignmentSha256'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
                and receipt['sourceCommit'] == a['sourceCommit']
                and receipt['environmentId'] == a['environmentId'], 'actor-receipt-binding-mismatch')
        require(all(receipt.get(key) is True for key in ('authVerified','tenantRoleVerified')),
                'actual-auth-tenant-observation-missing')
        intent = receipt['intent']
        if intent == 'authorized':
            require(receipt.get('selectedCompanyVerified') is True and receipt['requestedCompanyId'] == receipt['companyId'], 'authorized-company-not-observed')
        else:
            require(intent == 'expected_denial' and receipt.get('selectedCompanyVerified') is False
                    and receipt['requestedCompanyId'] != receipt['companyId'] and receipt.get('requestedCompanyDenied') is True, 'negative-company-probe-not-qualified')
        counts[intent] += 1
        require(receipt.get('licenseVerified') is False
                and receipt.get('licensePolicy') == 'NO_APPLICATION_LICENSE_GATE_IDENTIFIED', 'license-observation-policy-mismatch')
        require(str(uuid.UUID(receipt['userId'])) == receipt['userId']
                and str(uuid.UUID(receipt['companyId'])) == receipt['companyId']
                and str(uuid.UUID(receipt['requestedCompanyId'])) == receipt['requestedCompanyId']
                and re.fullmatch('[0-9a-f]{64}', receipt['contextEvidenceSHA256']) is not None,
                'actor-receipt-identity-invalid')
        observed = datetime.datetime.fromisoformat(receipt['observedAt'].replace('Z', '+00:00'))
        start = datetime.datetime.fromisoformat(load_private(home / 'attempt.json')['host']['observedAt'])
        require(start <= observed <= datetime.datetime.now(datetime.timezone.utc), 'actor-observation-time-invalid')
        observations.append(digest(path))
    require(counts['authorized'] > 0, 'authorized-actor-observation-missing')
    save_private(home / 'actors-qualified.json', {'count': len(observations), 'intents': counts, 'receiptsSHA256': canonical_sha256(observations),
                 'scope': 'AUTH_TENANT_OBSERVED_LICENSE_NOT_GATED',
                 'ordinarySignup': 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION'})


def safe_summary():
    """Fixed allowlist; never copy assignment, environment, report steps or log messages."""
    import hashlib
    home = Path(os.environ['SIM_HOME'])
    import re
    require(re.fullmatch('[0-9a-f]{40}', os.environ['GITHUB_SHA']) is not None, 'unsafe-summary-source')
    safe = {'schema': 'gridex-t2-safe-runtime-summary-v1',
            'runId': int(os.environ['GITHUB_RUN_ID']), 'runAttempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
            'sourceCommit': os.environ['GITHUB_SHA'], 'qualification': 'UNOBSERVED',
            'qualificationScope': 'RUNTIME_INFRASTRUCTURE_SOURCE_BUILD_REPLAY_ENDPOINTS_ONLY',
            'wholeScenarioPass': False,
            'cleanup': 'UNOBSERVED', 'actorQualification': 'HOLD_OBSERVED_PER_CASE_RECEIPTS_REQUIRED', 'scenario': None, 'scenarioExitCode': None,
            'assertions': None, 'wholeScenarioAcceptance': 'HOLD_INDEPENDENT_EFFECT_REVIEW_REQUIRED'}
    if (home / 'qualified.json').exists():
        proof = load_private(home / 'qualified.json')
        import re
        require(all(re.fullmatch('[0-9a-f]{64}', proof[k]) is not None for k in ('buildManifest','replayLog','buildLog')), 'unsafe-summary-hash-field')
        safe.update(qualification='QUALIFIED', installedLedgerSHA256=hashlib.sha256(proof['database']['ledger'].encode()).hexdigest(),
                    installedLedgerRows=len(proof['database']['ledger'].splitlines()),
                    buildManifestSHA256=proof['buildManifest'], replayLogSHA256=proof['replayLog'],
                    buildLogSHA256=proof['buildLog'],
                    resourceIdentitySHA256=hashlib.sha256(json.dumps(proof['resources'],sort_keys=True).encode()).hexdigest())
    if (home / 'actors-qualified.json').exists():
        actors = load_private(home / 'actors-qualified.json')
        import re
        require(type(actors['count']) is int and actors['count'] > 0 and re.fullmatch('[0-9a-f]{64}', actors['receiptsSHA256']) is not None, 'unsafe-actor-summary')
        intents = actors['intents']
        require(set(intents) == {'authorized','expected_denial'} and all(type(v) is int and v >= 0 for v in intents.values()) and sum(intents.values()) == actors['count'], 'unsafe-actor-summary-intents')
        safe.update(actorQualification='AUTH_TENANT_OBSERVED_LICENSE_NOT_GATED', actorReceiptCount=actors['count'], actorIntents=intents, actorReceiptsSHA256=actors['receiptsSHA256'])
    reports = list((home / 'reports').glob('*.json')) if home.exists() else []
    if len(reports) == 1:
        report = json.loads(reports[0].read_text())
        if report.get('scenario') in ('smoke', 'term01', 'term02', 'term03'):
            safe['scenario'] = report['scenario']
            code = report.get('exitCode')
            if type(code) is int and 0 <= code <= 255:
                safe['scenarioExitCode'] = code
            counts = report.get('summary', {})
            if set(counts) == {'passed','failed','skipped','total'} and all(type(x) is int and x >= 0 for x in counts.values()) and counts['total'] == counts['passed'] + counts['failed'] + counts['skipped']:
                safe['assertions'] = counts
    receipts = list(home.glob('cleanup-done-*.json')) if home.exists() else []
    if len(receipts) == 1 and load_private(receipts[0]).get('state') == 'DONE':
        safe['cleanup'] = 'COMPLETE'
    save_private(Path(os.environ['RUNNER_TEMP']) / 't2-safe-receipt.json', safe)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observe-host', action='store_true')
    parser.add_argument('--operation', choices=['prepare', 'up', 'run', 'down', 'inventory', 'qualify', 'replay-before', 'replay-after', 'execute', 'enter', 'check-down', 'check-source', 'safe-summary', 'scenario', 'actor-proof'])
    args = parser.parse_args()
    if args.observe_host:
        print(json.dumps(observe_host(), sort_keys=True))
        return 78
    if not args.operation:
        print(json.dumps({'state': 'HOLD', 'errors': ['explicit-operation-and-signed-assignment-required']}))
        return 78
    if args.operation == 'safe-summary':
        safe_summary()
    elif args.operation == 'check-source':
        authenticate('up')
    elif args.operation == 'execute':
        prepare_attempt()
        a, home, _ = authenticate('up')
        inventory(a, home)
        process = subprocess.Popen(['python3', '-B', __file__, '--operation', 'enter'])
        import time
        while process.poll() is None:
            inventory(a, home)
            time.sleep(2)
        inventory(a, home)
        require(process.returncode == 0, 'startup-failed')
        qualify()
    elif args.operation in ('enter', 'scenario'):
        a, home, _ = authenticate('up' if args.operation == 'enter' else 'run')
        path = owned_cgroup(a, home)
        command(['sudo', '-n', 'tee', str(path / 'cgroup.procs')], stdin=str(os.getpid()))
        script = 'up.sh' if args.operation == 'enter' else 'run.sh'
        argv = ['bash', str(Path(__file__).parent.parent / script)]
        if script == 'run.sh':
            argv.append(a['scenario'])
        os.execv('/bin/bash', argv)
    elif args.operation == 'prepare':
        prepare_attempt()
    elif args.operation in ('up', 'run'):
        authorize(args.operation)
    elif args.operation == 'down':
        cleanup()
    elif args.operation == 'check-down':
        a, home, _ = authenticate('down')
        validate_attempt(a, home)
    elif args.operation == 'qualify':
        qualify()
    elif args.operation == 'actor-proof':
        qualify_actors()
    else:
        a, home, _ = authenticate('up')
        if args.operation == 'inventory':
            inventory(a, home)
        else:
            snapshot_replay(home, args.operation.removeprefix('replay-'))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # Only fixed internal reason codes, never subprocess stderr/argv/private values.
        import re
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z][a-z0-9-]{2,100}', str(error)) else 'runtime-qualification-failed'
        print('HOLD: ' + code, file=__import__('sys').stderr)
        raise SystemExit(78)
