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
                'files': sorted(assignment['sourceFiles']),
                'bootstrapProofSHA256':assignment['bootstrapProofSHA256'],
                'installationPolicy':assignment['installationPolicy']}
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


def admission_public_key():
    return json.loads(Path(__file__).with_name('profile.requirements.json').read_text())['admissionPublicKey']


def verified_assignment(assignment):
    import tempfile
    assignment = private_file(assignment)
    signature = private_file(str(assignment) + '.sig')
    with tempfile.TemporaryDirectory() as directory:
        public = Path(directory) / 'admission.pub'
        public.write_text(admission_public_key())
        command(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', str(public),
                 '-rawin', '-in', str(assignment), '-sigfile', str(signature)])
    return json.loads(assignment.read_text())


def authenticate(operation):
    """Pinned T2 signature plus authenticated exact receipts; never trusts ACTIVE alone."""
    assignment = private_file(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
    a = verified_assignment(assignment)
    require(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T2'
            and a['state'] == 'ACTIVE' and operation in a['allowedOperations'], 'assignment-operation-rejected')
    require(type(a['allowedOperations']) is list and set(a['allowedOperations']) == {'up','run','down'}, 'cleanup-operation-must-be-authorized')
    require(datetime.datetime.fromisoformat(a['cleanupExpiresAt'].replace('Z', '+00:00')) > datetime.datetime.fromisoformat(a['expiresAt'].replace('Z', '+00:00')), 'cleanup-window-must-outlast-runtime')
    expiry = a['cleanupExpiresAt'] if operation == 'down' else a['expiresAt']
    require(datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00')) >
            datetime.datetime.now(datetime.timezone.utc), 'assignment-expired')
    import re
    require(re.fullmatch(r'scenarios/(smoke|term01|term02|term03|pilot-term0203)\.test\.ts', a['scenario']) is not None, 'invalid-scenario')
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
    require_pilot_profile(a)
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
                'scripts/migration-history-manifest.runtime.additions.json','supabase/config.toml',
                'scripts/simulation/track2/hosted/imap-mailbox.py'}
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
    if operation != 'down':
        validate_installed_materials(a,assignment)
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
    for resource in resources:
        if resource['kind'] == 'container':
            image_id = command(['docker','inspect','--format','{{.Image}}',resource['id']])
            require(image_id in a['installationPolicy']['images'].values(),'runtime-container-image-not-locked')
    # Append-only snapshots cover failures during startup; no recorded snapshot is replaced.
    import uuid
    save_private(home / ('resources-' + str(uuid.uuid4()) + '.json'),
                 {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']), 'resources': resources})
    return resources


BOOTSTRAP_TITLE = 'T2_BOOTSTRAP_PROOF_V1'


def bootstrap_directory():
    return Path(os.environ['RUNNER_TEMP']) / 't2-bootstrap'


def bootstrap_source():
    app = Path(os.environ['GITHUB_WORKSPACE']).resolve()
    head = git(app,'rev-parse','HEAD')
    require(head == os.environ['GITHUB_SHA'] and not git(app,'status','--porcelain'), 'bootstrap-source-dirty-or-wrong-head')
    paths = ['.github/workflows/t2-term-disposable.yml', 'scripts/simulation/track2/hosted/qualify-runtime.py',
             'scripts/simulation/track2/hosted/profile.requirements.json', 'package-lock.json',
             'scripts/gridex-aud-003-clean-replay.sh']
    return {'commit':head, 'tree':git(app,'rev-parse','HEAD^{tree}'),
            'files':{path:digest(app / path) for path in paths}}


def bootstrap_identity():
    boot = read_text('/proc/sys/kernel/random/boot_id')
    machine = read_text('/etc/machine-id')
    require(boot and machine and read_text('/etc/os-release') and os.uname().nodename,
            'bootstrap-host-identity-unavailable')
    require(os.uname().machine == 'x86_64' and 'ID=ubuntu' in read_text('/etc/os-release')
            and 'VERSION_ID="24.04"' in read_text('/etc/os-release'),'qualified-ubuntu-amd64-required')
    return {'bootId':boot,'machineId':machine,'hostname':os.uname().nodename,'architecture':os.uname().machine,
            'mountNamespace':os.readlink('/proc/self/ns/mnt'), 'osReleaseSHA256':digest('/etc/os-release')}


def bootstrap_run():
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1' and os.environ.get('GITHUB_JOB') in ('term','bootstrap-probe'),
            'bootstrap-not-qualified-actions-job')
    event = os.environ['GITHUB_EVENT_NAME']
    require(event in ('workflow_dispatch','pull_request'), 'bootstrap-event-unsupported')
    if event == 'pull_request':
        event_data = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        require(event_data['pull_request']['head']['repo']['full_name'] == REPOSITORY
                and event_data['pull_request']['base']['repo']['full_name'] == REPOSITORY,
                'bootstrap-fork-forbidden')
    require(os.environ.get('SIM_BOOTSTRAP_MODE') in (('pr-probe',) if event == 'pull_request' else ('bootstrap','admitted')),
            'bootstrap-mode-unsupported')
    return {'repository':REPOSITORY,'runId':int(os.environ['GITHUB_RUN_ID']), 'runAttempt':1,
            'job':os.environ['GITHUB_JOB'], 'event':event, 'sourceCommit':os.environ['GITHUB_SHA'],
            'mode':os.environ['SIM_BOOTSTRAP_MODE'],
            'workflowHeadCommit':event_data['pull_request']['head']['sha'] if event == 'pull_request' else os.environ['GITHUB_SHA']}


def encrypt_bootstrap(proof, directory):
    import base64
    requirements = json.loads(Path(__file__).with_name('profile.requirements.json').read_text())
    cert = directory / 'root-recipient.crt'
    private_bytes(cert,requirements['bootstrapRecipientCertificate'].encode())
    require(digest(cert) == requirements['bootstrapRecipientCertificateSHA256'], 'bootstrap-root-certificate-pin-mismatch')
    command(['openssl','x509','-in',str(cert),'-checkend','600','-noout'])
    source, sealed = directory / 'proof.json', directory / 'proof.cms'
    save_private(source,proof)
    original = os.umask(0o077)
    try:
        command(['openssl','cms','-encrypt','-binary','-aes-256-gcm','-in',str(source),'-outform','DER',
                 '-out',str(sealed),'-recip',str(cert),'-keyopt','rsa_padding_mode:oaep',
                 '-keyopt','rsa_oaep_md:sha256','-keyopt','rsa_mgf1_md:sha256'])
    finally:
        os.umask(original)
    require(0 < sealed.stat().st_size < 24576,'bootstrap-proof-too-large')
    require_cms_algorithms(sealed)
    return base64.b64encode(sealed.read_bytes()).decode('ascii')


BOOTSTRAP_CHUNK_TITLE = 'T2_BOOTSTRAP_CIPHER_V1'


def bootstrap_frames(safe):
    import base64, hashlib
    cipher = base64.b64decode(safe['cmsBase64'],validate=True)
    require(0 < len(cipher) < 24576,'bootstrap-proof-too-large')
    encoded = safe['cmsBase64']
    pieces = [encoded[i:i+2400] for i in range(0,len(encoded),2400)]
    header = {key:value for key,value in safe.items() if key != 'cmsBase64'}
    header.update(transport='cms-framed-v1',cipherSHA256=hashlib.sha256(cipher).hexdigest(),
                  cipherBytes=len(cipher),chunkCount=len(pieces))
    binding = canonical_sha256(header)
    frames = [(BOOTSTRAP_TITLE,header)] + [(BOOTSTRAP_CHUNK_TITLE,
              {'schema':'t2-bootstrap-cipher-chunk-v1','headerSHA256':binding,'index':i,
               'chunkCount':len(pieces),'data':piece}) for i,piece in enumerate(pieces)]
    rendered = [(title,json.dumps(frame,separators=(',',':'),ensure_ascii=True)) for title,frame in frames]
    require(len(rendered) <= 16 and all(len(message.encode('utf-8')) <= 3500 for _,message in rendered),
            'bootstrap-frame-budget-exceeded')
    return rendered  # validate EVERY frame before printing ANY frame


def reassemble_bootstrap(annotations):
    import base64, hashlib
    headers = [item for item in annotations if item['title'] == BOOTSTRAP_TITLE]
    chunks = [item for item in annotations if item['title'] == BOOTSTRAP_CHUNK_TITLE]
    require(len(headers) == 1 and all(item['annotation_level'] == 'notice' and
            len(item['message'].encode('utf-8')) <= 3500 for item in headers+chunks),'bootstrap-framed-notice-invalid')
    header = strict_transport_json(headers[0]['message'])
    require(set(header) == {'schema','run','proofSHA256','state','runtimeActive','wholeScenarioPass','driver',
            'effectiveRAMBytes','dockerRootFreeBytes','capacityErrors','transport','cipherSHA256','cipherBytes','chunkCount'}
            and header['transport'] == 'cms-framed-v1' and type(header['cipherBytes']) is int
            and 0 < header['cipherBytes'] < 24576 and type(header['chunkCount']) is int
            and 1 <= header['chunkCount'] <= 14 and len(chunks) == header['chunkCount'],
            'bootstrap-framed-header-or-count-invalid')
    pieces = {}
    for item in chunks:
        chunk = strict_transport_json(item['message'])
        require(set(chunk) == {'schema','headerSHA256','index','chunkCount','data'}
                and chunk['schema'] == 't2-bootstrap-cipher-chunk-v1' and chunk['headerSHA256'] == canonical_sha256(header)
                and type(chunk['index']) is int and 0 <= chunk['index'] < header['chunkCount'] and chunk['index'] not in pieces
                and type(chunk['chunkCount']) is int and chunk['chunkCount'] == header['chunkCount']
                and isinstance(chunk['data'],str) and 0 < len(chunk['data']) <= 2400,'bootstrap-chunk-binding-or-index-invalid')
        pieces[chunk['index']] = chunk['data']
    encoded = ''.join(pieces[i] for i in range(header['chunkCount']))
    cipher = base64.b64decode(encoded,validate=True)
    require(len(cipher) == header['cipherBytes'] and hashlib.sha256(cipher).hexdigest() == header['cipherSHA256'],
            'bootstrap-reassembled-cipher-mismatch')
    safe = {key:value for key,value in header.items() if key not in ('transport','cipherSHA256','cipherBytes','chunkCount')}
    return dict(safe,cmsBase64=encoded)


def bootstrap_observe():
    # Read-only host/daemon/source probes only: no install, pull, start, native allocation or ACTIVE claim.
    run = bootstrap_run()
    directory = bootstrap_directory()
    require(directory.parent.is_absolute() and directory.parent.resolve() == directory.parent
            and directory.parent.is_dir(), 'runner-temp-not-canonical')
    directory.mkdir(mode=0o700)
    private_material_directory(directory)
    source, host = bootstrap_source(), bootstrap_identity()
    identity, observation = daemon_identity(capacity=False)
    require(not docker_resources('__t2_bootstrap_no_owned_resources__'), 'bootstrap-daemon-not-empty')
    errors = capacity_errors(observation)
    proof = {'schema':'gridex-t2-bootstrap-private-v1','run':run,'source':source,'host':host,
             'daemon':identity,'capacity':observation,'capacityErrors':errors,
             'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'state':'OBSERVED_NOT_BACKEND_ACTIVE','opensslVersion':command(['openssl','version']),
             'pythonVersion':command(['python3','--version'])}
    ciphertext = encrypt_bootstrap(proof,directory)
    safe = {'schema':'gridex-t2-bootstrap-safe-v1','run':run,'proofSHA256':digest(directory / 'proof.json'),
            'state':'CAPACITY_HOLD' if errors else 'CAPACITY_OBSERVED_NOT_ADMITTED',
            'runtimeActive':False,'wholeScenarioPass':False, 'driver':observation['driver'],
            'effectiveRAMBytes':observation['effectiveRAMBytes'],'dockerRootFreeBytes':observation['dockerRootFreeBytes'],
            'capacityErrors':errors,'cmsBase64':ciphertext}
    save_private(directory / 'safe.json',safe)
    frames = bootstrap_frames(safe)
    for title,message in frames:
        print('::notice title=' + title + '::' + message,flush=True)
    require(not errors,'bootstrap-capacity-unqualified')
    return proof


def bootstrap_context(run_id,source,job_name):
    import re
    require(type(run_id) is int and run_id > 0 and re.fullmatch('[0-9a-f]{40}',source)
            and job_name in ('term','bootstrap-probe'),'bootstrap-context-arguments-invalid')
    run = delivery_get('actions/runs/' + str(run_id))
    event = 'pull_request' if job_name == 'bootstrap-probe' else 'workflow_dispatch'
    require(run['run_attempt'] == 1 and run['event'] == event
            and run['path'] == '.github/workflows/t2-term-disposable.yml','bootstrap-api-run-mismatch')
    commit = delivery_get('git/commits/' + source)
    require(commit['sha'] == source and (run['head_sha'] == source if event == 'workflow_dispatch'
            else run['head_sha'] in [parent['sha'] for parent in commit['parents']]),'bootstrap-checkout-head-mismatch')
    jobs = delivery_get('actions/runs/' + str(run_id) + '/attempts/1/jobs?per_page=100')
    require(jobs['total_count'] == len(jobs['jobs']) <= 100,'bootstrap-job-inventory-incomplete')
    selected = [job for job in jobs['jobs'] if job['name'] == job_name]
    require(len(selected) == 1,'bootstrap-job-not-unique')
    job = selected[0]
    require(job['run_id'] == run_id and job['run_attempt'] == 1 and job['head_sha'] == run['head_sha'],
            'bootstrap-api-job-mismatch')
    prefix = 'https://api.github.com/repos/' + REPOSITORY + '/check-runs/'
    require(job['check_run_url'].startswith(prefix) and job['check_run_url'].removeprefix(prefix).isdigit(),
            'bootstrap-check-url-invalid')
    check_id = job['check_run_url'].removeprefix(prefix)
    check = delivery_get('check-runs/' + check_id)
    require(check['app']['slug'] == 'github-actions' and check['head_sha'] == run['head_sha']
            and check['details_url'] == 'https://github.com/' + REPOSITORY + '/actions/runs/' + str(run_id) + '/job/' + str(job['id']),
            'bootstrap-check-provenance-mismatch')
    return {'runId':run_id,'runAttempt':1,'sourceCommit':source,'jobId':job['id'],'checkId':check_id,
            'annotationsCount':check['output']['annotations_count'],'checkoutTree':commit['tree']['sha'],
            'workflowHeadCommit':run['head_sha'],'event':event,'job':job_name}


def published_bootstrap(context):
    import base64
    annotations = delivery_get('check-runs/' + str(context['checkId']) + '/annotations?per_page=100')
    require(len(annotations) == context['annotationsCount'] <= 100,'bootstrap-annotations-incomplete')
    safe = reassemble_bootstrap(annotations)
    require(set(safe) == {'schema','run','proofSHA256','state','runtimeActive','wholeScenarioPass','driver',
                         'effectiveRAMBytes','dockerRootFreeBytes','capacityErrors','cmsBase64'}
            and safe['schema'] == 'gridex-t2-bootstrap-safe-v1' and safe['runtimeActive'] is False
            and safe['wholeScenarioPass'] is False,'bootstrap-safe-schema-invalid')
    require(safe['run']['runId'] == context['runId'] and safe['run']['runAttempt'] == 1
            and safe['run']['repository'] == REPOSITORY and safe['run']['sourceCommit'] == context['sourceCommit']
            and safe['run']['job'] == context.get('job','term') and safe['run']['event'] == context.get('event','workflow_dispatch')
            and safe['run']['workflowHeadCommit'] == context.get('workflowHeadCommit',context['sourceCommit'])
            and safe['run']['mode'] in (('pr-probe',) if context.get('job') == 'bootstrap-probe' else ('bootstrap','admitted')),
            'bootstrap-public-run-binding-mismatch')
    require(0 < len(base64.b64decode(safe['cmsBase64'],validate=True)) < 24576,'bootstrap-proof-too-large')
    return safe


def verify_published_bootstrap(context,a):
    safe = published_bootstrap(context)
    require(safe['run']['mode'] == 'admitted' and not safe['capacityErrors'] and safe['state'] == 'CAPACITY_OBSERVED_NOT_ADMITTED'
            and safe['proofSHA256'] == a.get('bootstrapProofSHA256'), 'delivery-bootstrap-binding-mismatch')


def decrypt_bootstrap(context,key,output):
    import tempfile, base64
    safe = published_bootstrap(context)
    key = private_file(key)
    private_material_directory(output.parent)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        temporary = Path(temporary)
        sealed, plain = temporary / 'proof.cms', temporary / 'proof.json'
        private_bytes(sealed,base64.b64decode(safe['cmsBase64'],validate=True))
        require_cms_algorithms(sealed)
        original = os.umask(0o077)
        try:
            command(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(sealed),
                     '-inkey',str(key),'-out',str(plain)])
        finally:
            os.umask(original)
        proof = load_private(plain)
        require(digest(plain) == safe['proofSHA256'] and proof['run'] == safe['run']
                and proof['source']['commit'] == context['sourceCommit']
                and proof['source']['tree'] == context.get('checkoutTree',proof['source']['tree']) and proof['capacityErrors'] == safe['capacityErrors']
                and proof['schema'] == 'gridex-t2-bootstrap-private-v1','bootstrap-decrypted-binding-mismatch')
        private_bytes(output,plain.read_bytes())
    return safe['proofSHA256']


def bootstrap_observed():
    return load_private(bootstrap_directory() / 'proof.json')


def validate_bootstrap(a, *, reobserve=False):
    directory = bootstrap_directory()
    proof_path = private_file(directory / 'proof.json')
    proof = load_private(proof_path)
    require(proof['schema'] == 'gridex-t2-bootstrap-private-v1' and not proof['capacityErrors']
            and a.get('bootstrapProofSHA256') == digest(proof_path), 'bootstrap-proof-not-bound-or-unqualified')
    require(proof['run'] == bootstrap_run() and proof['run']['event'] == 'workflow_dispatch'
            and proof['run']['job'] == 'term' and proof['run']['mode'] == 'admitted' and proof['source'] == bootstrap_source()
            and proof['source']['commit'] == a['sourceCommit'] and proof['source']['tree'] == a['sourceTree'],
            'bootstrap-run-or-source-changed')
    age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(proof['observedAt'])
    require(datetime.timedelta(0) <= age <= datetime.timedelta(minutes=45), 'bootstrap-proof-stale')
    require(proof['host'] == bootstrap_identity(), 'bootstrap-host-or-boot-changed')
    if reobserve:
        identity, _ = daemon_identity()
        require(identity == proof['daemon'], 'bootstrap-daemon-changed')
    return proof


def installed_tool_receipt(a):
    import shutil
    versions = {'node':['node','--version'],'npm':['npm','--version'], 'supabase':['supabase','--version'],
                'psql':['psql','--version'],'pg_dump':['pg_dump','--version']}
    tools = {}
    for tool, argv in versions.items():
        path = shutil.which(tool)
        require(path is not None,'locked-tool-missing')
        executable = Path(path).resolve()
        tools[tool] = {'version':command(argv), 'executableSHA256':digest(executable)}
    require(tools['node']['version'] == 'v22.22.0' and tools['supabase']['version'].splitlines()[-1] == '2.101.0'
            and ' 17.' in tools['psql']['version'] and ' 17.' in tools['pg_dump']['version'], 'required-tool-version-mismatch')
    policy = a.get('installationPolicy',{})
    require(set(policy) == {'tools','packageLockSHA256','images','imageSelectors','provenanceSHA256'} and policy['tools'] == tools
            and policy['packageLockSHA256'] == digest(Path(a['runDir']) / 'package-lock.json'),
            'signed-installation-policy-mismatch')
    import re
    images = policy['images']
    require(type(images) is dict and images and all(re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}',image)
            and re.fullmatch(r'sha256:[0-9a-f]{64}',image_id) for image,image_id in images.items()),
            'signed-image-digest-lock-required')
    require(json.loads(Path(__file__).with_name('profile.requirements.json').read_text())['pilotMailboxImage'] in images,
            'mailbox-image-lock-missing')
    require(type(policy['imageSelectors']) is dict and policy['imageSelectors']
            and all(isinstance(tag,str) and re.fullmatch(r'[A-Za-z0-9./_-]+:[A-Za-z0-9._-]+',tag)
                    and reference in images for tag,reference in policy['imageSelectors'].items())
            and re.fullmatch('[0-9a-f]{64}',policy['provenanceSHA256']), 'qualified-image-selectors-and-provenance-required')
    requirements = json.loads(Path(__file__).with_name('profile.requirements.json').read_text())
    require({tool:entry['executableSHA256'] for tool,entry in tools.items()} == requirements['qualifiedToolHashes']
            and tools['npm']['version'] == '10.9.2', 'tool-distribution-provenance-mismatch')
    require(images == requirements['qualifiedImagePolicy']['images']
            and policy['imageSelectors'] == requirements['qualifiedImagePolicy']['imageSelectors'],
            'complete-qualified-image-inventory-required')
    return {'tools':tools,'packageLockSHA256':policy['packageLockSHA256'], 'images':images,
            'imageSelectors':policy['imageSelectors'],'provenanceSHA256':policy['provenanceSHA256'],
            'source':a['sourceCommit'],'bootstrapProofSHA256':a['bootstrapProofSHA256']}


def install_dependencies():
    a, _, app = authenticate('up')
    validate_bootstrap(a,reobserve=True)
    receipt = installed_tool_receipt(a)  # exact expected versions + bytes before running any dependency lifecycle scripts
    directory = bootstrap_directory()
    require(not (directory / 'installation-started.json').exists(),'dependency-install-already-attempted')
    save_private(directory / 'installation-started.json',receipt)
    log = directory / 'npm-ci.private.log'
    with open(log,'x',opener=lambda path, flags:os.open(path,flags,0o600)) as output:
        result = subprocess.run(['npm','ci'],cwd=app,stdout=output,stderr=subprocess.STDOUT,timeout=600)
    require(result.returncode == 0,'dependency-install-failed-private-log')
    require(installed_tool_receipt(a) == receipt,'tool-or-lock-drift-during-install')
    receipt['installedLockSHA256'] = digest(app / 'node_modules/.package-lock.json')
    save_private(directory / 'installation.json',receipt)


def verify_image_cache(policy):
    for reference, expected_id in policy['images'].items():
        observed = json.loads(command(['docker','image','inspect',reference]))
        require(len(observed) == 1 and observed[0]['Id'] == expected_id
                and reference in observed[0]['RepoDigests'], 'locked-image-cache-missing-or-mismatched')
    for selector, reference in policy['imageSelectors'].items():
        require(command(['docker','image','inspect','--format','{{.Id}}',selector]) == policy['images'][reference],
                'locked-image-selector-mismatch')


def prime_images():
    import time
    a, _, _ = authenticate('up')
    validate_bootstrap(a,reobserve=True)
    policy = installed_tool_receipt(a)
    directory = bootstrap_directory()
    require(len(policy['images']) <= 32 and not (directory / 'image-priming-started.json').exists(),
            'image-priming-budget-exceeded')
    save_private(directory / 'image-priming-started.json',policy)
    deadline = time.monotonic() + 900
    with open(directory / 'image-pulls.private.log','x',opener=lambda path,flags:os.open(path,flags,0o600)) as log:
        for reference in policy['images']:
            remaining = deadline-time.monotonic()
            require(remaining > 0,'image-priming-timeout')
            result = subprocess.run(['docker','pull',reference],stdout=log,stderr=subprocess.STDOUT,timeout=min(300,remaining))
            require(result.returncode == 0,'immutable-image-pull-failed')
            data = json.loads(command(['docker','image','inspect',reference]))
            require(len(data) == 1 and data[0]['Id'] == policy['images'][reference]
                    and reference in data[0]['RepoDigests'],'pulled-image-digest-or-id-mismatch')
        for selector, reference in policy['imageSelectors'].items():
            command(['docker','tag',reference,selector])  # local cache alias, never mutable network pull
    verify_image_cache(policy)
    save_private(directory / 'image-priming.json',policy)


def validate_installation(a):
    validate_bootstrap(a,reobserve=True)
    receipt = load_private(bootstrap_directory() / 'installation.json')
    expected = installed_tool_receipt(a)
    expected['installedLockSHA256'] = digest(Path(a['runDir']) / 'node_modules/.package-lock.json')
    require(receipt == expected,'installed-tool-or-dependency-receipt-changed')
    require(load_private(bootstrap_directory() / 'image-priming.json') == installed_tool_receipt(a),'image-priming-receipt-changed')
    verify_image_cache(expected)


def prepare_attempt():
    require(__import__('sys').version_info >= (3, 11), 'python311-required')
    a, home, app = authenticate('up')
    validate_installed_materials(a,Path(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']))
    validate_installation(a)
    import re
    require(re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', a['projectId']) is not None
            and a['projectId'] != 'gridex-ops-platform', 'invalid-project')
    ports = a['ports']
    require(len(ports) == 9 and len(set(ports.values())) == 9
            and all(type(v) is int and 1024 <= v <= 65535 for v in ports.values()), 'invalid-ports')
    require_pilot_profile(a)
    mailbox_ports = a['pilotMailbox']['ports']
    require(set(mailbox_ports) == {'smtps','imaps'} and len(set(mailbox_ports.values())) == 2
            and not set(mailbox_ports.values()).intersection(ports.values())
            and all(type(v) is int and 1024 <= v <= 65535 for v in mailbox_ports.values()), 'signed-mailbox-ports-invalid')
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
        for port in [*ports.values(),*mailbox_ports.values()]:
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
    if a.get('pilotId') == 'TERM02.03':
        verify_supervisor(a,home,require_parent=operation == 'up')
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
    verify_supervisor(a,home,require_parent=True)
    canonical_copy(a,home,app)
    live = load_private(home / 'replay-live.json')
    require(live['supervisorBirthSHA256'] == digest(home / 'supervisor-birth.json'), 'live-source-shell-not-qualified')
    mailbox_descriptor('up')
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    private_env = private_file(home / 'app.env').read_text().splitlines()
    values = dict(line.split('=', 1) for line in private_env if line and not line.startswith('#') and '=' in line)
    auth_url = 'http://127.0.0.1:' + str(a['ports']['SIM_API_PORT']) + '/auth/v1/health'
    with opener.open(urllib.request.Request(auth_url, headers={'apikey': values['NEXT_PUBLIC_SUPABASE_ANON_KEY']}), timeout=10) as response:
        require(response.status == 200, 'local-auth-health-unqualified')
    for url in ('http://127.0.0.1:' + str(a['ports']['SIM_APP_PORT']) + '/',
                'http://127.0.0.1:' + str(a['ports']['SIM_COUNTERPART_PORT']) + '/__health'):
        with opener.open(url, timeout=10) as response:
            require(response.status == 200, 'runtime-endpoint-unqualified')
    save_private(home / 'qualified.json', {'assignment': digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                 'resources': inventory(a, home), 'database': database,
                 'sourceRestoration':'PENDING_CANONICAL_EXIT_NOT_YET_RESTORED',
                 'buildId': (app / '.next/BUILD_ID').read_text().strip(),
                 'buildManifest': digest(app / '.next/build-manifest.json'),
                 'replayLog': digest(home / 'logs/replay.log'), 'buildLog': digest(home / 'logs/build.log')})


def cleanup():
    a, home, app = authenticate('down')
    if not home.exists():
        return  # no prepared attempt, no runtime side effects authorized
    validate_attempt(a, home)
    require_terminal_supervisor(a,home)
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
    if (home / 'supervisor-terminal.json').exists():
        terminal = load_private(home / 'supervisor-terminal.json')
        safe['lifecycle'] = {'actualChildExitObserved':terminal['actualChildExitObserved'],
                             'sourceRestored':terminal['sourceRestored'],'returnCode':terminal['returnCode'],
                             'failure':terminal['failure']}
    reports = list((home / 'reports').glob('*.json')) if home.exists() else []
    if len(reports) == 1:
        report = json.loads(reports[0].read_text())
        if report.get('scenario') in ('smoke', 'term01', 'term02', 'term03','pilot-term0203'):
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


# No environment/secret administration. The only public payload is a recipient
# certificate or CMS ciphertext; existing private signed admission stays intact.
REPOSITORY = 'heke99/gridex-ops-platform'
RECIPIENT_TITLE = 'T2_CMS_RECIPIENT_V1'
DELIVERY_PREFIX = 'T2_CMS_ADMISSION_V1 '
MAX_CMS_BYTES = 524288


def strict_transport_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate-transport-key')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('nonstandard-transport-json')
    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


def delivery_api(method, route, body=None, timeout=35):
    """Fixed GitHub API surface; capture headers without logging tokens or redirects."""
    import re
    require(method == 'GET' or (method == 'POST' and route in ('git/commits','git/refs')),
            'delivery-api-mutation-out-of-scope')
    args = ['gh','api','--hostname','github.com','--method',method,'--include',
            '-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28',
            'repos/' + REPOSITORY + '/' + route]
    if body is not None:
        args += ['--input','-']
    env = dict(os.environ, GH_PROMPT_DISABLED='1', GH_PAGER='cat')
    env.pop('GH_DEBUG', None)
    result = subprocess.run(args, input=None if body is None else json.dumps(body),
                            capture_output=True, text=True, timeout=timeout, env=env)
    match = re.match(r'HTTP/\S+ (\d{3})[^\r\n]*\r?\n', result.stdout)
    parts = re.split(r'\r?\n\r?\n', result.stdout, maxsplit=1)
    require(match is not None and len(parts) == 2, 'delivery-api-response-unrecognized')
    status = int(match[1])
    value = strict_transport_json(parts[1])
    require((status == 404 and method == 'GET') or result.returncode == 0,
            'delivery-api-process-failed')
    return status, value


def delivery_get(route,timeout=35):
    status, value = delivery_api('GET', route,timeout=timeout)
    require(status == 200, 'delivery-read-not-successful')
    return value


def delivery_context(run_id, source):
    import re
    require(type(run_id) is int and run_id > 0 and re.fullmatch('[0-9a-f]{40}', source),
            'invalid-delivery-invocation')
    run = delivery_get('actions/runs/' + str(run_id))
    require(run['head_sha'] == source and run['run_attempt'] == 1 and run['event'] == 'workflow_dispatch'
            and run['path'] == '.github/workflows/t2-term-disposable.yml'
            and run['status'] == 'in_progress', 'delivery-run-not-current')
    jobs = delivery_get('actions/runs/' + str(run_id) + '/attempts/1/jobs?per_page=100')
    require(jobs['total_count'] == len(jobs['jobs']) and len(jobs['jobs']) <= 100,
            'delivery-job-inventory-incomplete')
    selected = [job for job in jobs['jobs'] if job['name'] == 'term' and job['status'] == 'in_progress']
    require(len(selected) == 1, 'delivery-job-not-unique')
    job = selected[0]
    require(job['run_id'] == run_id and job['run_attempt'] == 1 and job['head_sha'] == source,
            'delivery-job-binding-mismatch')
    check_url = job['check_run_url']
    prefix = 'https://api.github.com/repos/' + REPOSITORY + '/check-runs/'
    require(check_url.startswith(prefix) and check_url.removeprefix(prefix).isdigit(),
            'delivery-check-url-invalid')
    check_id = check_url.removeprefix(prefix)
    check = delivery_get('check-runs/' + check_id)
    require(check['app']['slug'] == 'github-actions' and check['head_sha'] == source
            and check['details_url'] == 'https://github.com/' + REPOSITORY + '/actions/runs/' + str(run_id) + '/job/' + str(job['id']),
            'delivery-check-provenance-mismatch')
    return {'runId':run_id,'runAttempt':1,'sourceCommit':source,'jobId':job['id'],
            'checkId':check_id, 'annotationsCount':check['output']['annotations_count']}


def delivery_ref(context):
    return 'refs/tags/t2-private-admission/' + str(context['runId']) + '-attempt-1'


def private_bytes(path, data):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def recipient_directory():
    import stat
    root = Path(os.environ['RUNNER_TEMP'])
    require(root.is_absolute() and root.resolve() == root and root.is_dir(), 'runner-temp-not-canonical')
    directory = root / 't2-admission-rendezvous'
    directory.mkdir(mode=0o700)  # reused/unknown keys or attempts are never adopted
    require(directory.stat().st_uid == os.getuid() and stat.S_IMODE(directory.stat().st_mode) == 0o700,
            'recipient-directory-not-private')
    return directory


def generate_recipient(directory, context):
    import base64
    version = command(['openssl','version']).split()
    require(version[0] == 'OpenSSL' and int(version[1].split('.')[0]) >= 3,'openssl3-required')
    key, cert, der = (directory / name for name in ('recipient.key','recipient.crt','recipient.der'))
    original = os.umask(0o077)
    try:
        command(['openssl','req','-newkey','rsa:4096','-x509','-noenc','-sha256','-days','1',
                 '-subj','/CN=gridex-t2-run-' + str(context['runId']),'-keyout',str(key),'-out',str(cert)])
        command(['openssl','x509','-in',str(cert),'-outform','DER','-out',str(der)])
    finally:
        os.umask(original)
    private_file(key)
    private_file(cert)
    require(len(der.read_bytes()) < 8192, 'recipient-certificate-too-large')
    public = {'version':'t2-cms-recipient-v1','repository':REPOSITORY,
              **{k:context[k] for k in ('runId','runAttempt','sourceCommit','jobId')},
              'certificateSHA256':digest(der),'certificateDERBase64':base64.b64encode(der.read_bytes()).decode('ascii')}
    save_private(directory / 'recipient.json', public)
    return public


def discover_recipient(context):
    import base64
    annotations = delivery_get('check-runs/' + context['checkId'] + '/annotations?per_page=100')
    require(type(context['annotationsCount']) is int and context['annotationsCount'] <= 100
            and len(annotations) == context['annotationsCount'], 'recipient-annotation-inventory-incomplete')
    selected = [item for item in annotations if item['title'] == RECIPIENT_TITLE]
    require(len(selected) == 1 and selected[0]['annotation_level'] == 'notice',
            'recipient-notice-not-unique')
    public = strict_transport_json(selected[0]['message'])
    require(set(public) == {'version','repository','runId','runAttempt','sourceCommit','jobId',
                            'certificateSHA256','certificateDERBase64'}
            and public['version'] == 't2-cms-recipient-v1' and public['repository'] == REPOSITORY
            and all(public[k] == context[k] for k in ('runId','runAttempt','sourceCommit','jobId')),
            'recipient-notice-binding-mismatch')
    der = base64.b64decode(public['certificateDERBase64'], validate=True)
    import hashlib
    require(0 < len(der) < 8192 and hashlib.sha256(der).hexdigest() == public['certificateSHA256'],
            'recipient-certificate-digest-mismatch')
    return public


MAX_ASSIGNMENT_BYTES = 65536
MAX_MATERIAL_PACKET_BYTES = 131072


def private_material_directory(parent):
    import stat
    parent = Path(parent)
    require(parent.is_absolute() and parent.resolve() == parent,'material-path-not-canonical')
    info = parent.stat()
    require(parent.is_dir() and not parent.is_symlink() and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'material-directory-not-private')
    return parent


def private_material_path(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path,'material-path-not-canonical')
    private_material_directory(path.parent)
    probe = subprocess.run(['git','-C',str(path.parent),'rev-parse','--is-inside-work-tree'],capture_output=True)
    require(probe.returncode != 0,'material-file-inside-git-forbidden')
    return private_file(path)


def typed_material_specification(spec):
    # Fixed string/object/array schema: compact insertion-order UTF-8 JSON has
    # the same bytes as the scenario's JSON.stringify; no numeric-key/float gap.
    required = {'declaration','billingMonth','signedDate','offerValidFrom','startsAt','startAt',
                'signedPdfBase64','groundPdfBase64','authority','groundVersion','groundDecisionReference',
                'network','z04','e66'}
    require(type(spec) is dict and set(spec) == required, 'material-specification-schema-invalid')
    for key in required - {'authority','network','e66'}:
        require(type(spec[key]) is str and bool(spec[key]), 'material-specification-string-required')
    require(spec['declaration'] == 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE', 'material-declaration-invalid')
    authority = spec['authority']
    fields = {'declaration','authoritySourceSha256','validFrom','validTo','regulatedIssuerCode',
              'regulatedReference','regulatedKeyHex','networkRegistryVersion','networkReference','networkKeyHex'}
    require(type(authority) is dict and set(authority) == fields
            and all(type(value) is str and bool(value) for value in authority.values())
            and authority['declaration'] == 'TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE', 'material-authority-schema-invalid')
    network = spec['network']
    require(type(network) is dict and set(network) == {'pdfBase64','reference','version','validFrom','validUntil','clause'}
            and all(type(network[key]) is str and bool(network[key]) for key in set(network)-{'clause'}),
            'material-network-schema-invalid')
    require(type(network['clause']) is dict and set(network['clause']) == {'locator','quote'}
            and all(type(value) is str and bool(value) for value in network['clause'].values()), 'material-network-clause-invalid')
    require(type(spec['e66']) is list and bool(spec['e66'])
            and all(type(item) is str and bool(item) for item in spec['e66']), 'material-e66-array-invalid')
    import hashlib
    return hashlib.sha256(json.dumps(spec,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()


def validate_material_packet(assignment_path,materials_path,assignment=None):
    import re
    assignment_path = private_file(assignment_path)
    require(0 < assignment_path.stat().st_size <= MAX_ASSIGNMENT_BYTES,'private-admission-size-invalid')
    a = assignment if assignment is not None else strict_transport_json(assignment_path.read_text())
    require(type(a['expiresAt']) is str,'material-appointment-expiry-invalid')
    expiry = datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'))
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'material-appointment-expired')
    path = private_material_path(materials_path)
    require(0 < path.stat().st_size <= MAX_MATERIAL_PACKET_BYTES,'material-packet-size-invalid')
    packet = strict_transport_json(path.read_text())
    require(type(packet) is dict and set(packet) == {'schema','assignmentSha256','sourceCommit','environmentId','specification'}
            and packet['schema'] == 'gridex-t2-term0203-materials-v1', 'material-packet-schema-invalid')
    require(packet['assignmentSha256'] == digest(assignment_path) and packet['sourceCommit'] == a['sourceCommit']
            and packet['environmentId'] == a['environmentId'], 'material-packet-assignment-mismatch')
    expected = a['pilotTerm0203']['materialSpecificationSha256']
    require(type(expected) is str and re.fullmatch('[0-9a-f]{64}',expected) is not None
            and typed_material_specification(packet['specification']) == expected, 'material-specification-hash-mismatch')
    return {'packetSHA256':digest(path),'specificationSHA256':expected}


def export_material_path(directory):
    import stat
    material = private_material_path(directory / 'materials.json')
    runner = Path(os.environ['RUNNER_TEMP'])
    target = Path(os.environ['GITHUB_ENV'])
    require(target.is_absolute() and target.resolve() == target and target.is_relative_to(runner.resolve())
            and not target.is_symlink() and target != material, 'github-env-path-not-owned-runner-output')
    require(not any(char in str(material) for char in ('\r','\n','\x00')), 'material-environment-path-unsafe')
    descriptor = os.open(target,os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'a') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), 'github-env-not-owned-regular-file')
        stream.write('SIM_TERM0203_MATERIALS_FILE='+str(material)+'\n')
        stream.flush()
        os.fsync(stream.fileno())


def validate_installed_materials(a,assignment):
    directory = Path(os.environ['RUNNER_TEMP']) / 't2-admission-rendezvous'
    expected = directory / 'materials.json'
    require(os.environ.get('SIM_TERM0203_MATERIALS_FILE') == str(expected), 'material-private-environment-handoff-missing')
    proof = validate_material_packet(assignment,expected,a)
    received = load_private(directory / 'delivery-received.json')
    require(received.get('materialPacketSHA256') == proof['packetSHA256']
            and received.get('materialSpecificationSHA256') == proof['specificationSHA256'], 'installed-material-packet-drift')


def cms_encrypt(assignment, certificate_der, directory, materials):
    import base64
    # Keep exact signed bytes; JSON wrapping is fixed, not an archive or executable payload.
    assignment = private_file(assignment)
    private_file(str(assignment) + '.sig')
    require(0 < assignment.stat().st_size <= MAX_ASSIGNMENT_BYTES, 'private-admission-size-invalid')
    validate_material_packet(assignment,materials)
    packet = directory / 'packet.json'
    save_private(packet, {'assignment':base64.b64encode(assignment.read_bytes()).decode('ascii'),
                          'signature':base64.b64encode(Path(str(assignment) + '.sig').read_bytes()).decode('ascii'),
                          'materials':base64.b64encode(private_material_path(materials).read_bytes()).decode('ascii')})
    cert_der, cert_pem, output = (directory / name for name in ('recipient.der','recipient.crt','admission.cms'))
    private_bytes(cert_der, certificate_der)
    command(['openssl','x509','-inform','DER','-in',str(cert_der),'-out',str(cert_pem)])
    original = os.umask(0o077)
    try:
        command(['openssl','cms','-encrypt','-binary','-aes-256-gcm','-in',str(packet),'-outform','DER',
                 '-out',str(output),'-recip',str(cert_pem),'-keyopt','rsa_padding_mode:oaep',
                 '-keyopt','rsa_oaep_md:sha256','-keyopt','rsa_mgf1_md:sha256'])
    finally:
        os.umask(original)
    require(0 < output.stat().st_size <= MAX_CMS_BYTES, 'cms-envelope-size-invalid')
    return output.read_bytes()


def carrier_body(context, public, ciphertext):
    import base64
    require(0 < len(ciphertext) <= MAX_CMS_BYTES, 'cms-envelope-size-invalid')
    data = {k:context[k] for k in ('runId','runAttempt','sourceCommit','jobId')}
    data.update(recipientSHA256=public['certificateSHA256'], cmsBase64=base64.b64encode(ciphertext).decode('ascii'))
    return {'base':context['sourceCommit'],'files':[],
            'operation':DELIVERY_PREFIX + json.dumps(data,sort_keys=True,separators=(',',':'))}


def parse_carrier(commit, context, public, base_tree):
    import base64
    require(commit['tree']['sha'] == base_tree
            and [parent['sha'] for parent in commit['parents']] == [context['sourceCommit']],
            'carrier-not-neutral-to-source')
    body = strict_transport_json(commit['message'])
    require(set(body) == {'base','files','operation'} and body['base'] == context['sourceCommit']
            and body['files'] == [] and body['operation'].startswith(DELIVERY_PREFIX), 'carrier-shape-invalid')
    require(len(body['operation']) <= MAX_CMS_BYTES * 2, 'carrier-operation-too-large')
    data = strict_transport_json(body['operation'].removeprefix(DELIVERY_PREFIX))
    require(set(data) == {'runId','runAttempt','sourceCommit','jobId','recipientSHA256','cmsBase64'}
            and all(data[k] == context[k] for k in ('runId','runAttempt','sourceCommit','jobId'))
            and data['recipientSHA256'] == public['certificateSHA256'], 'carrier-run-or-recipient-mismatch')
    ciphertext = base64.b64decode(data['cmsBase64'],validate=True)
    require(0 < len(ciphertext) <= MAX_CMS_BYTES, 'cms-envelope-size-invalid')
    return ciphertext


def require_cms_algorithms(path):
    # Parse OpenSSL's ASN.1 OBJECT rows, never arbitrary rendered string/ciphertext text.
    import re
    structure = command(['openssl','asn1parse','-inform','DER','-in',str(path)])
    objects = re.findall(r'^\s*\d+:d=\d+\s+hl=\d+\s+l=\s*\d+\s+prim:\s+OBJECT\s+:(\S+)\s*$',structure,re.M)
    require(objects.count('id-smime-ct-authEnvelopedData') == 1
            and objects.count('rsaesOaep') == 1 and objects.count('mgf1') == 1
            and objects.count('sha256') == 2 and objects.count('aes-256-gcm') == 1
            and 'rsaEncryption' not in objects, 'cms-algorithms-not-approved')


def consume_carrier(directory, commit, context, public, base_tree, assignment_path):
    import base64
    import tempfile
    ciphertext = parse_carrier(commit,context,public,base_tree)
    # Even failed decrypt/signature consumes this appointment; never blindly reuse keys/tag.
    save_private(directory / 'delivery-consumed.json', {'carrier':commit['sha'], 'recipient':public['certificateSHA256']})
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        temporary = Path(temporary)
        sealed, packet = temporary / 'admission.cms', temporary / 'packet.json'
        private_bytes(sealed,ciphertext)
        require_cms_algorithms(sealed)
        original = os.umask(0o077)
        try:
            command(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(sealed),
                     '-recip',str(private_file(directory / 'recipient.crt')),
                     '-inkey',str(private_file(directory / 'recipient.key')),'-out',str(packet)])
        finally:
            os.umask(original)
        value = strict_transport_json(private_file(packet).read_text())
        require(set(value) == {'assignment','signature','materials'}, 'decrypted-packet-shape-invalid')
        candidate = temporary / 'assignment.json'
        private_bytes(candidate,base64.b64decode(value['assignment'],validate=True))
        private_bytes(str(candidate) + '.sig',base64.b64decode(value['signature'],validate=True))
        a = verified_assignment(candidate)
        require(a['github'] == {'runId':context['runId'],'runAttempt':1}
                and a['sourceCommit'] == context['sourceCommit'], 'decrypted-admission-run-mismatch')
        validate_bootstrap(a,reobserve=True)
        material_candidate = temporary / 'materials.json'
        private_bytes(material_candidate,base64.b64decode(value['materials'],validate=True))
        material_proof = validate_material_packet(candidate,material_candidate,a)
        # Material data never enters environment/output; only this fixed private file.
        private_material_directory(directory)
        private_bytes(directory / 'materials.json',material_candidate.read_bytes())
        private_bytes(assignment_path,candidate.read_bytes())
        private_bytes(str(assignment_path) + '.sig',Path(str(candidate) + '.sig').read_bytes())
    save_private(directory / 'delivery-received.json', {'carrier':commit['sha'], 'state':'SIGNED_INPUT_RECEIVED_NOT_RUNTIME_ADMITTED',
                 'materialPacketSHA256':material_proof['packetSHA256'],
                 'materialSpecificationSHA256':material_proof['specificationSHA256']})


def receive_admission():
    import time
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
            and os.environ.get('GITHUB_JOB') == 'term' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
            'recipient-must-be-current-term-job')
    context = delivery_context(int(os.environ['GITHUB_RUN_ID']),os.environ['GITHUB_SHA'])
    validate_bootstrap_observed = bootstrap_observed()
    require(not validate_bootstrap_observed['capacityErrors'],'bootstrap-capacity-unqualified')
    directory = recipient_directory()
    public = generate_recipient(directory,context)
    # Fixed safe notice, deliberately outside raw private logs; no private key/path/input.
    print('::notice title=' + RECIPIENT_TITLE + '::' + json.dumps(public,separators=(',',':')),flush=True)
    base_tree = delivery_get('git/commits/' + context['sourceCommit'])['tree']['sha']
    deadline = time.monotonic() + 600
    ref = delivery_ref(context)
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        status, value = delivery_api('GET','git/ref/' + ref.removeprefix('refs/'),timeout=min(35,max(.1,remaining)))
        if status == 200:
            require(value['ref'] == ref and value['object']['type'] == 'commit', 'delivery-ref-shape-invalid')
            remaining = deadline - time.monotonic()
            require(remaining > 0,'private-admission-rendezvous-timeout')
            commit = delivery_get('git/commits/' + value['object']['sha'],timeout=min(35,remaining))
            require(time.monotonic() < deadline,'private-admission-rendezvous-timeout')
            require(commit['sha'] == value['object']['sha'], 'delivery-ref-readback-mismatch')
            consume_carrier(directory,commit,context,public,base_tree,Path(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']))
            export_material_path(directory)
            return
        require(status == 404, 'delivery-poll-not-authoritative-absence')
        time.sleep(min(30,max(0,deadline-time.monotonic())))
    raise ValueError('private-admission-rendezvous-timeout')


class DeliveryJournal:
    """Durable write intentions; existing/ambiguous journals are never retried automatically."""
    def __init__(self,path,context,public):
        import stat
        path = Path(path)
        require(path.is_absolute() and path.resolve() == path and path.parent.is_dir()
                and path.parent.stat().st_uid == os.getuid()
                and stat.S_IMODE(path.parent.stat().st_mode) == 0o700, 'delivery-journal-directory-not-private')
        probe = subprocess.run(['git','-C',str(path.parent),'rev-parse','--is-inside-work-tree'],capture_output=True)
        require(probe.returncode != 0, 'delivery-journal-inside-git')
        descriptor = os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
        self.stream = os.fdopen(descriptor,'w')
        self.data = {'state':'LOCAL_PREFLIGHT','runId':context['runId'],'source':context['sourceCommit'],
                     'recipientSHA256':public['certificateSHA256'],'ref':delivery_ref(context),
                     'operations':[],'noAutomaticMutationRetry':True}
        self.save()
        parent = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)

    def save(self):
        self.stream.seek(0)
        json.dump(self.data,self.stream,sort_keys=True)
        self.stream.write('\n')
        self.stream.truncate()
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def post(self,route,body):
        require(route in ('git/commits','git/refs'),'delivery-write-route-forbidden')
        if route == 'git/commits':
            require(set(body) == {'message','tree','parents'}
                    and strict_transport_json(body['message']) == self.data['expectedCarrier']
                    and body['tree'] == self.data['sourceTree'] and body['parents'] == [self.data['source']],
                    'delivery-commit-body-out-of-scope')
        else:
            require(set(body) == {'ref','sha'} and body['ref'] == self.data['ref']
                    and body['sha'] == self.data['carrier'], 'delivery-ref-body-out-of-scope')
        operation = {'route':route,'state':'STARTED','body':body}
        self.data['operations'].append(operation)
        self.save()
        try:
            status,value = delivery_api('POST',route,body)
            operation.update(state='RETURNED',status=status,result=value)
            self.save()
            require(status == 201,'delivery-create-not-successful')
            return value
        except Exception:
            operation['state'] = 'FAILED_OR_AMBIGUOUS_RECONCILE_NO_RETRY'
            self.save()
            raise


def recipient_still_current(context,public):
    current = delivery_context(context['runId'],context['sourceCommit'])
    require(all(current[key] == context[key] for key in ('runId','runAttempt','sourceCommit','jobId','checkId')),
            'recipient-job-changed-before-publication')
    require(discover_recipient(current) == public,'recipient-notice-changed-before-publication')


def publish_delivery(assignment_path,journal_path,materials_path):
    import tempfile
    import base64
    a = verified_assignment(assignment_path)
    validate_material_packet(assignment_path,materials_path,a)  # local before any API/publication
    context = delivery_context(a['github']['runId'],a['sourceCommit'])
    require(a['github'] == {'runId':context['runId'],'runAttempt':1} and a['worker'] == 'T2'
            and a['state'] == 'ACTIVE','delivery-input-not-exact-active-appointment')
    expiry = datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'))
    require(expiry > datetime.datetime.now(datetime.timezone.utc),'delivery-input-expired')
    # Real native/ordinary custody is required; ciphertext delivery grants none itself.
    for kind in ('backend','producer'):
        verify_native_binding(a['startupAttempt'][kind + 'Reservation'],a,kind)
    for binding in a['sourceCustody']:
        require(binding['body']['operation'].startswith('Reserve source files and rule IDs; resources-sha256='), 'ordinary-source-custody-required')
        verify_binding(binding)
    public = discover_recipient(context)
    verify_published_bootstrap(context,a)
    journal = DeliveryJournal(journal_path,context,public)
    try:
        ref = delivery_ref(context)
        status,_ = delivery_api('GET','git/ref/' + ref.removeprefix('refs/'))
        require(status == 404,'delivery-tag-already-exists-or-ambiguous')
        base = delivery_get('git/commits/' + context['sourceCommit'])
        require(base['tree']['sha'] == a['sourceTree'],'delivery-source-tree-changed')
        with tempfile.TemporaryDirectory(dir=Path(journal_path).parent) as temporary:
            ciphertext = cms_encrypt(assignment_path,base64.b64decode(public['certificateDERBase64'],validate=True),Path(temporary),materials_path)
        body = carrier_body(context,public,ciphertext)
        recipient_still_current(context,public)
        journal.data.update(expectedCarrier=body,sourceTree=a['sourceTree'])
        journal.save()
        created = journal.post('git/commits',{'message':json.dumps(body,sort_keys=True,separators=(',',':')),
                                          'tree':a['sourceTree'],'parents':[context['sourceCommit']]})
        commit = delivery_get('git/commits/' + created['sha'])
        require(parse_carrier(commit,context,public,a['sourceTree']) == ciphertext,'created-carrier-readback-mismatch')
        recipient_still_current(context,public)
        journal.data['carrier'] = created['sha']
        journal.save()
        created_ref = journal.post('git/refs',{'ref':ref,'sha':created['sha']})
        require(created_ref['ref'] == ref and created_ref['object']['sha'] == created['sha'], 'created-delivery-ref-mismatch')
        readback = delivery_get('git/ref/' + ref.removeprefix('refs/'))
        require(readback['ref'] == ref and readback['object']['type'] == 'commit'
                and readback['object']['sha'] == created['sha'],'delivery-final-ref-mismatch')
        journal.data.update(state='PUBLISHED_EXACT_READBACK',carrier=created['sha'])
        journal.save()
    finally:
        journal.stream.close()


MAIL_CAPABILITIES = {'mode':'GREENMAIL_TLS_ONLY','smtps':'VERIFIED_TLS','imaps':'VERIFIED_TLS',
                     'legacySmtp':'RESERVED_NOT_USED','mailHttp':'RESERVED_NOT_USED'}


def require_pilot_profile(a):
    require(a.get('pilotId') == 'TERM02.03' and a.get('scenario') == 'scenarios/pilot-term0203.test.ts'
            and a.get('mailCapabilities') == MAIL_CAPABILITIES, 'unsupported-pilot-or-mail-capability-profile')
    require(a['ports']['SIM_DB_PORT'] == 54322, 'explicit-canonical-db-port-required')
    import re
    cfg = a['pilotMailbox']
    profile = json.loads(Path(__file__).with_name('profile.requirements.json').read_text())
    require(cfg['image'] == profile['pilotMailboxImage']
            and cfg['containerName'] == a['projectId']+'-pilot-mailbox'
            and re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,63}@t2\.sim\.invalid',cfg['mailboxAddress']) is not None,
            'signed-pilot-mailbox-profile-invalid')
    require(set(cfg['ports']) == {'smtps','imaps'} and len(set(cfg['ports'].values())) == 2
            and all(type(v) is int and 1024 <= v <= 65535 for v in cfg['ports'].values())
            and not set(cfg['ports'].values()).intersection(a['ports'].values()), 'signed-mailbox-ports-invalid')
    require(not os.environ.get('GRIDEX_REPLAY_DB_URL'), 'external-replay-substitution-forbidden')
    require(os.environ.get('NODE_TLS_REJECT_UNAUTHORIZED','1') == '1', 'tls-verification-must-remain-enabled')


def reserved_mail_ports(a):
    import socket
    listeners = []
    try:
        for key in ('SIM_SMTP_PORT','SIM_MAIL_HTTP_PORT'):
            listener = socket.socket()
            listeners.append(listener)
            listener.bind(('127.0.0.1',a['ports'][key]))
    finally:
        for listener in listeners:
            listener.close()


def mailbox_helper():
    import importlib.util
    import types
    path = Path(__file__).with_name('imap-mailbox.py')
    spec = importlib.util.spec_from_file_location('t2_owned_pilot_mailbox',path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    helper = types.SimpleNamespace(**{name:globals()[name] for name in (
        'authenticate','validate_attempt','owned_cgroup','read_text','digest','load_private',
        'daemon_identity','docker_resources','inventory')})
    return module,helper


def mailbox_descriptor(operation='up',fresh_probe=True):
    a,_,_ = authenticate(operation)
    require_pilot_profile(a)
    reserved_mail_ports(a)
    module,helper = mailbox_helper()
    descriptor = module.read_descriptor(helper=helper,operation=operation)
    if fresh_probe:
        module.tls_auth(a['pilotMailbox'],descriptor['imap']['password'],Path(descriptor['tlsCaPath']))
    return descriptor


def start_mailbox():
    a,_,_ = authenticate('up')
    require_pilot_profile(a)
    reserved_mail_ports(a)
    module,helper = mailbox_helper()
    module.start(helper=helper)  # once; module exclusive directory/intent prevents replay


def export_mailbox():
    import shlex
    a,home,_ = authenticate('up')
    descriptor = mailbox_descriptor('up')
    smtp = descriptor['smtp']
    require(smtp['secure'] is True and descriptor['imap']['secure'] is True,'verified-tls-mail-descriptor-required')
    values = {'NODE_EXTRA_CA_CERTS':descriptor['nodeExtraCaPath'],
              'SIM_PILOT_MAILBOX_PASSWORD':descriptor['imap']['password'],
              'EDIEL_SMTP_HOST':smtp['host'],'EDIEL_SMTP_PORT':str(smtp['port']),
              'EDIEL_SMTP_SECURE':'true','EDIEL_SMTP_USER':smtp['user'],
              'EDIEL_SMTP_PASSWORD':smtp['password'],'EDIEL_SMTP_FROM':descriptor['mailboxAddress']}
    private_bytes(home / 'mailbox.env', ''.join(k+'='+shlex.quote(v)+'\n' for k,v in values.items()).encode())


def process_identity(pid):
    fields = Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()
    return {'pid':pid,'ticks':fields[19],'group':int(fields[2]),'session':int(fields[3]),'state':fields[0]}


def verify_supervisor(a,home,require_parent=False):
    birth = load_private(home / 'supervisor-birth.json')
    require(birth['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
            and birth['wrapperSHA256'] == a['sourceFiles']['scripts/simulation/track2/up.sh']
            and digest(birth['wrapper']) == birth['wrapperSHA256'], 'supervisor-source-binding-changed')
    actual = process_identity(birth['pid'])
    require(actual['state'] != 'Z' and all(actual[k] == birth[k] for k in ('pid','ticks','group','session'))
            and actual['group'] == actual['pid'] == actual['session'], 'supervisor-birth-identity-changed')
    require(Path('/proc',str(birth['pid']),'exe').resolve() == Path('/bin/bash').resolve(), 'supervisor-not-owned-bash')
    argv = Path('/proc',str(birth['pid']),'cmdline').read_bytes().split(b'\0')[:-1]
    require(len(argv) == 2 and Path(os.fsdecode(argv[0])).name == 'bash'
            and os.fsdecode(argv[1]) == birth['wrapper'], 'supervisor-wrapper-argv-changed')
    if require_parent:
        require(os.getppid() == birth['pid'], 'not-same-canonical-source-shell')
    return birth


def copy_state(root):
    state = {}
    for directory in ('scripts','supabase'):
        for path in sorted((root / directory).rglob('*')):
            relative = path.relative_to(root)
            require(not path.is_symlink(), 'private-source-copy-symlink-forbidden')
            if '.temp' not in relative.parts and path.is_file():
                state[str(relative)] = {'sha256':digest(path),'mode':path.stat().st_mode & 0o777}
    pin = root / 'supabase/.temp/postgres-version'
    require(not pin.is_symlink(), 'private-postgres-pin-symlink')
    state['supabase/.temp/postgres-version'] = {'sha256':digest(pin),'mode':pin.stat().st_mode & 0o777} if pin.exists() else None
    return state


def verify_config_patch(a,app,root):
    import copy,tomllib
    original = tomllib.loads((app / 'supabase/config.toml').read_text())
    expected = copy.deepcopy(original)
    expected['project_id'] = a['projectId']
    for table,key,port in [('api','port','SIM_API_PORT'),('db','port','SIM_DB_PORT'),
                           ('db','shadow_port','SIM_SHADOW_PORT'),('db.pooler','port','SIM_POOLER_PORT'),
                           ('studio','port','SIM_STUDIO_PORT'),('inbucket','port','SIM_MAIL_HTTP_PORT'),
                           ('inbucket','smtp_port','SIM_SMTP_PORT')]:
        current = expected
        for part in table.split('.'):
            current = current[part]
        current[key] = a['ports'][port]
    require(tomllib.loads((root / 'supabase/config.toml').read_text()) == expected,
            'private-config-patch-exceeds-assigned-ports-project')


def canonical_copy(a,home,app):
    root = home / 'replay-root'
    relative = 'scripts/gridex-aud-003-clean-replay.sh'
    require(a['canonicalReplaySHA256'] == digest(app / relative) == digest(root / relative),
            'canonical-replay-copy-must-be-pristine')
    return root


def lifetime_snapshot(a,home,app,phase):
    root = canonical_copy(a,home,app)
    if phase == 'before':
        verify_config_patch(a,app,root)
        state = copy_state(root)
        source = copy_state(app)
        for path,value in state.items():
            if path != 'supabase/config.toml':
                require(value == source.get(path),'unqualified-private-source-copy')
        save_private(home / 'replay-before.json',{'files':state,'sourceIndexSHA256':canonical_sha256(git(app,'ls-files','--stage'))})
    else:
        before = load_private(home / 'replay-before.json')
        after = {'files':copy_state(root),'sourceIndexSHA256':canonical_sha256(git(app,'ls-files','--stage'))}
        save_private(home / 'replay-restoration.json',{'before':before,'after':after})
        require(before == after and not git(app,'status','--porcelain','--untracked-files=normal'),
                'canonical-source-or-index-not-restored')


def live_replay(a,home,app):
    birth = verify_supervisor(a,home,require_parent=True)
    canonical_copy(a,home,app)
    require('[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger'
            in (home / 'logs/replay.log').read_text(), 'canonical-replay-did-not-complete')
    inventory(a,home)
    save_private(home / 'replay-live.json',{'assignment':digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                 'supervisorBirthSHA256':digest(home / 'supervisor-birth.json'),'pid':birth['pid'],
                 'sourceRestoration':'PENDING_CANONICAL_EXIT_NOT_YET_RESTORED'})


def canonical_cleanup_preflight(a,home,app):
    verify_supervisor(a,home,require_parent=True)
    validate_attempt(a,home)
    canonical_copy(a,home,app)
    recorded = []
    for path in home.glob('resources-*.json'):
        value = load_private(path)
        require(value['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']), 'canonical-cleanup-inventory-changed')
        recorded.extend(value['resources'])
    require(all(r in recorded for r in docker_resources(a['projectId'])), 'canonical-cleanup-unknown-resources')


def supervisor_signal(birth,descriptor):
    import select,signal
    if select.select([descriptor],[],[],0)[0]:
        return
    actual = process_identity(birth['pid'])
    require(all(actual[k] == birth[k] for k in ('pid','ticks','group','session'))
            and actual['pid'] == actual['group'] == actual['session'],'supervisor-signal-identity-changed')
    os.killpg(birth['pid'],signal.SIGTERM)  # only this captured still-live source session


def wait_owned_supervisor(process,birth,descriptor,timeout,grace,observe):
    import time,signal
    require(timeout > 0 and 0 < grace <= 240,'bounded-supervisor-deadlines-required')
    deadline = time.monotonic()+timeout
    requested = [False]
    handlers = {sig:signal.getsignal(sig) for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
    for sig in handlers:
        signal.signal(sig,lambda *_: requested.__setitem__(0,True))
    failure = None
    try:
        while process.poll() is None:
            if requested[0] or time.monotonic() >= deadline:
                failure = ValueError('canonical-supervisor-deadline-or-signal')
                break
            try:
                observe()
            except Exception as error:
                failure = error
                break
            time.sleep(min(1,max(0,deadline-time.monotonic())))
        if failure is not None:
            supervisor_signal(birth,descriptor)
        try:
            code = process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            # No SIGKILL before canonical restoration: preserve unknown live shell/backend.
            raise ValueError('canonical-supervisor-still-live-reconcile-no-full-cleanup') from None
        if failure is not None:
            raise failure
        return code
    finally:
        for sig,handler in handlers.items():
            signal.signal(sig,handler)


def run_supervisor(argv,a,home,app,timeout,grace=180,observe=None):
    process = subprocess.Popen(argv,start_new_session=True)
    descriptor = os.pidfd_open(process.pid)
    try:
        birth = process_identity(process.pid)
        birth.update(assignment=digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                     wrapper=str(app / 'scripts/simulation/track2/up.sh'),
                     wrapperSHA256=a['sourceFiles']['scripts/simulation/track2/up.sh'])
        require(birth['group'] == birth['pid'] == birth['session'],'supervisor-session-not-exclusive')
        save_private(home / 'supervisor-birth.json',birth)
        failure = None
        try:
            code = wait_owned_supervisor(process,birth,descriptor,timeout,grace,observe or (lambda:inventory(a,home)))
        except Exception as error:
            failure = error
            code = process.returncode
        require(code is not None,'supervisor-exit-not-observed')
        restored = False
        if (home / 'replay-before.json').exists():
            # This observation happens AFTER wait/reap; source restoration is not a READY marker.
            lifetime_snapshot(a,home,app,'after') if not (home / 'replay-restoration.json').exists() else None
            value = load_private(home / 'replay-restoration.json')
            require(value['before'] == value['after'],'canonical-source-not-restored-after-exit')
            restored = True
        save_private(home / 'supervisor-terminal.json',{'assignment':digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                     'birthSHA256':digest(home / 'supervisor-birth.json'),'actualChildExitObserved':True,
                     'returnCode':code,'replayStarted':(home / 'replay-before.json').exists(),
                     'sourceRestored':restored,'failure':failure is not None})
        if failure is not None:
            raise failure
        require(code == 0,'canonical-supervisor-consumer-or-cleanup-failed')
    finally:
        os.close(descriptor)


def reconcile_supervisor(a,home,grace=180):
    """Cleanup may observe an orphan's real exit, never invent a successful consumer status."""
    import select,time
    birth = load_private(home / 'supervisor-birth.json')
    require(birth['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
            and digest(birth['wrapper']) == birth['wrapperSHA256'] == a['sourceFiles']['scripts/simulation/track2/up.sh'],
            'orphan-supervisor-binding-changed')
    code = None
    try:
        descriptor = os.pidfd_open(birth['pid'])
    except ProcessLookupError:
        descriptor = None  # actual kernel absence, status unknown; never a PASS
    if descriptor is not None:
        try:
            if not select.select([descriptor],[],[],0)[0]:
                supervisor_signal(birth,descriptor)
                require(select.select([descriptor],[],[],grace)[0], 'orphan-supervisor-still-live')
            try:
                waited,status = os.waitpid(birth['pid'],os.WNOHANG)
                if waited == birth['pid']:
                    code = os.waitstatus_to_exitcode(status)
            except ChildProcessError:
                pass
        finally:
            os.close(descriptor)
    replay_started = (home / 'replay-before.json').exists()
    if replay_started:
        if not (home / 'replay-restoration.json').exists():
            lifetime_snapshot(a,home,Path(a['runDir']),'after')
        proof = load_private(home / 'replay-restoration.json')
        require(proof['before'] == proof['after'],'orphan-source-restoration-missing')
    save_private(home / 'supervisor-terminal.json',{'assignment':digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']),
                 'birthSHA256':digest(home / 'supervisor-birth.json'),'actualChildExitObserved':True,
                 'returnCode':code,'replayStarted':replay_started,'sourceRestored':replay_started,
                 'failure':True,'observation':'CLEANUP_RECONCILIATION_NOT_CONSUMER_ACCEPTANCE'})


def require_terminal_supervisor(a,home):
    birth = home / 'supervisor-birth.json'
    if not birth.exists():
        require(not (home / 'up-consumed.json').exists(),'unknown-started-supervisor')
        return
    terminal_path = home / 'supervisor-terminal.json'
    if not terminal_path.exists():
        reconcile_supervisor(a,home)
    terminal = load_private(terminal_path)
    require(terminal['assignment'] == digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
            and terminal['birthSHA256'] == digest(birth) and terminal['actualChildExitObserved'] is True
            and (not terminal['replayStarted'] or terminal['sourceRestored'] is True),
            'supervisor-exit-or-restoration-unqualified')
    if terminal['replayStarted']:
        app = Path(a['runDir'])
        root = canonical_copy(a,home,app)
        proof = load_private(home / 'replay-restoration.json')
        current = {'files':copy_state(root),'sourceIndexSHA256':canonical_sha256(git(app,'ls-files','--stage'))}
        require(proof['before'] == proof['after'] == current,'terminal-source-restoration-drift')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observe-host', action='store_true')
    parser.add_argument('--operation', choices=['prepare', 'up', 'run', 'down', 'inventory', 'qualify', 'replay-before', 'replay-after', 'execute', 'enter', 'check-down', 'check-source', 'safe-summary', 'scenario', 'actor-proof', 'receive-admission', 'publish-delivery','supervisor-entered','replay-live','supervisor-cleanup-preflight','mailbox-start','mailbox-export','check-materials','bootstrap-observe','install-dependencies','read-bootstrap','prime-images'])
    parser.add_argument('--assignment-file')
    parser.add_argument('--journal-file')
    parser.add_argument('--materials-file')
    parser.add_argument('--bootstrap-key')
    parser.add_argument('--bootstrap-proof-file')
    parser.add_argument('--run-id',type=int)
    parser.add_argument('--source-commit')
    parser.add_argument('--bootstrap-job',choices=['term','bootstrap-probe'],default='term')
    args = parser.parse_args()
    if args.observe_host:
        print(json.dumps(observe_host(), sort_keys=True))
        return 78
    if not args.operation:
        print(json.dumps({'state': 'HOLD', 'errors': ['explicit-operation-and-signed-assignment-required']}))
        return 78
    if args.operation == 'read-bootstrap':
        require(args.run_id and args.source_commit and args.bootstrap_key and args.bootstrap_proof_file,'bootstrap-read-private-arguments-required')
        context = bootstrap_context(args.run_id,args.source_commit,args.bootstrap_job)
        decrypt_bootstrap(context,Path(args.bootstrap_key),Path(args.bootstrap_proof_file))
    elif args.operation == 'bootstrap-observe':
        bootstrap_observe()
    elif args.operation == 'prime-images':
        prime_images()
    elif args.operation == 'install-dependencies':
        install_dependencies()
    elif args.operation == 'receive-admission':
        receive_admission()
    elif args.operation == 'publish-delivery':
        require(args.assignment_file and args.journal_file and args.materials_file, 'delivery-private-input-materials-and-journal-required')
        publish_delivery(Path(args.assignment_file),Path(args.journal_file),Path(args.materials_file))
    elif args.operation == 'safe-summary':
        safe_summary()
    elif args.operation == 'check-materials':
        assignment = private_file(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
        a = verified_assignment(assignment)
        validate_installed_materials(a,assignment)
    elif args.operation == 'check-source':
        authenticate('up')
    elif args.operation == 'execute':
        prepare_attempt()
        a, home, _ = authenticate('up')
        inventory(a, home)
        seconds = min(7200,(datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'))-datetime.datetime.now(datetime.timezone.utc)).total_seconds()-180)
        run_supervisor(['python3','-B',__file__,'--operation','enter'],a,home,Path(a['runDir']),seconds)
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
    elif args.operation == 'supervisor-entered':
        a,home,_ = authenticate('up')
        verify_supervisor(a,home,require_parent=True)
    elif args.operation == 'replay-live':
        a,home,app = authenticate('up')
        live_replay(a,home,app)
    elif args.operation == 'supervisor-cleanup-preflight':
        a,home,app = authenticate('down')
        canonical_cleanup_preflight(a,home,app)
    elif args.operation == 'mailbox-start':
        start_mailbox()
    elif args.operation == 'mailbox-export':
        export_mailbox()
    elif args.operation == 'qualify':
        qualify()
    elif args.operation == 'actor-proof':
        qualify_actors()
    else:
        a, home, app = authenticate('down' if args.operation == 'replay-after' else 'up')
        if args.operation == 'inventory':
            inventory(a, home)
        else:
            lifetime_snapshot(a,home,app,args.operation.removeprefix('replay-'))
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
