#!/usr/bin/env python3
"""Manual, one-host T5 producer. Missing independently qualified inputs => HOLD.

Bundle (root0700 outside Git): grant.json and assignment.json (root0600),
inventory.json and images.tar. Nothing downloads/creates a grant or claims refs.
The private grant contains source{commit,tree,files:path->SHA256}, assignmentSha256,
inventorySha256, archiveSha256, runtimeRefs[producer,backend], runtimeReceipt,
sourceCustody[{receipt,resources}], publicBinding{ref,receipt}, two independent
reviews[{ref,receipt}], actor, repository, inputEpoch, producer, hostBootId,
github{runId,attempt,sha}, groups, scenarioIds, allowedOperations, remainingRuns=1,
dockerDriver, expiresAt, cleanupExpiresAt, evidenceDir, dependencyReceiptSha256.
The public binding is ONLY {schema:gridex-t5-native-commitment-v1,inputSha256}.
Runtime neutral capsules commit that digest, never private allocation fields.
Review commitments likewise bind the digest with APPROVE_NATIVE_INPUT and actual
independent reviewer-session refs. This is a new profile, not legacy full-v1.

Images inventory: {images:[{id:sha256:...,tags:[ghcr.io/supabase/...:...]}]}.
Tools and lock-preserving npm dependencies must already be independently prepared.
The private assignment supplies actual ACTIVE resources; this program never fills
templates with guessed ports/IPs. Network QUALIFIED is written only after actual
all-host product-transport/receiver-effect probes. Actual results need independent
review: successful execution is never a whole-scenario PASS attestation.
"""
import argparse
import ctypes
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
WF = '.github/workflows/simulation-track5-native.yml'
CATALOG = {'auth01': ['AUTH01.' + f'{n:02}' for n in range(1, 7)], 'api01': ['API01.01', 'API01.02', 'API01.04', 'API01.05'],
           'api01-poa': ['API01.03'], 'event01': ['EVENT01.' + f'{n:02}' for n in range(1, 6)], 'scan': ['AUTH01.06']}


def need(ok, code):
    if not ok:
        raise ValueError('native_' + code)


def packed(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            need(k not in out, 'duplicate_json'); out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: need(False, 'nonfinite'))


def stamp(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    need(result.tzinfo is not None, 'clock')
    return result.timestamp()


def core_digest(grant):
    return sha(packed({k: v for k, v in grant.items() if k not in ('runtimeReceipt', 'publicBinding', 'reviews')}))


def scenario_ids(groups):
    return list(dict.fromkeys(case for group in groups for case in CATALOG[group]))


def check_groups(groups, ids):
    need(isinstance(groups, list) and groups and len(set(groups)) == len(groups)
         and all(g in CATALOG for g in groups) and ids == scenario_ids(groups), 'scenario_scope')
    if 'scan' in groups:
        need(groups == list(CATALOG), 'scan_requires_full_prior_groups')


def call(argv, **kwargs):
    timeout = kwargs.pop('timeout', 45)
    return subprocess.check_output(argv, stderr=subprocess.DEVNULL, text=True, timeout=timeout, **kwargs).strip()


def private(path, limit=1048576):
    p = Path(path)
    need(p.is_absolute() and str(p.resolve()) == str(p), 'private_path')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= limit, 'private_file')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(limit + 1)
        need(len(raw) <= limit, 'private_file')
        return raw
    finally:
        os.close(fd)


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(packed(value))


def consume_budget(path, digest):
    write_new(path, {'inputSha256': digest, 'state': 'ONE_RUN_CONSUMED_NO_AUTOMATIC_RETRY'})


def namespaces():
    return {key: os.readlink('/proc/self/ns/' + key) for key in ('net', 'mnt', 'pid')}


def load_module(app, name):
    path = app / 'scripts/simulation/track5/lib' / (name + '.py')
    spec = importlib.util.spec_from_file_location('t5_' + name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def git(app, *args):
    return call(['git', '-C', str(app), *args])


def clean_source(app, g):
    need(git(app, 'rev-parse', 'HEAD') == g['source']['commit']
         and git(app, 'rev-parse', 'HEAD^{tree}') == g['source']['tree']
         and not git(app, 'status', '--porcelain', '--untracked-files=normal'), 'dirty_source')
    paths = git(app, 'ls-files', '--', 'scripts/simulation/track5', WF).splitlines()
    need(paths and set(paths) == set(g['source']['files']), 'source_inventory')
    for rel in paths:
        p = app / rel
        need(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(app)
             and sha(p.read_bytes()) == g['source']['files'][rel], 'source_hash')
    for name in ('.env', '.env.local', '.env.production', '.env.production.local', '.env.development.local'):
        need(not (app / name).exists(), 'ambient_provider_config')


def api(repo, path):
    return parse(call(['gh', 'api', 'repos/' + repo + '/' + path]))


def exact_ref(repo, name, receipt):
    need(re.fullmatch(r'refs/tags/agent-(?:claims/masterplan|runtime-admissions)/[A-Za-z0-9._/-]+', name), 'ref_scope')
    ref = api(repo, 'git/ref/' + name.removeprefix('refs/'))
    need(ref['ref'] == name and ref['object']['type'] == 'commit' and ref['object']['sha'] == receipt, 'ref_drift')


def neutral(repo, receipt, resources, operation):
    c = api(repo, 'git/commits/' + receipt); value = parse(c['message'])
    need(set(value) == {'base', 'files', 'operation'} and value['operation'] == operation
         and len(c['parents']) == 1 and c['parents'][0]['sha'] == value['base']
         and c['tree']['sha'] == api(repo, 'git/commits/' + value['base'])['tree']['sha'], 'neutral_capsule')
    for ref in resources:
        exact_ref(repo, ref, receipt)
    return value


def authenticate(g, digest):
    repo = g['repository']
    need(repo == 'heke99/gridex-ops-platform', 'repository')
    # GITHUB_TOKEN is installation-scoped: /user is not an actor proof for it.
    # The authenticated repository run and platform actor must both match.
    run = api(repo, 'actions/runs/' + str(g['github']['runId']))
    need(run['actor']['login'] == run['triggering_actor']['login'] == g['actor'], 'actor')
    authors, covered = set(), set()
    for group in g['sourceCustody']:
        resources = group['resources']
        need(resources == sorted(set(resources)), 'source_resources')
        m = neutral(repo, group['receipt'], resources, 'Reserve source files and rule IDs; resources-sha256=' + sha('\n'.join(resources).encode()))
        files = {'refs/tags/agent-claims/masterplan/file-' + sha(p.encode()) for p in m['files']}
        sessions = {r for r in resources if '/slot-session-' in r}
        need(len(sessions) == 1 and set(resources) == files | sessions, 'full_source_capsule')
        covered.update(files); authors.update(sessions)
    need({'refs/tags/agent-claims/masterplan/file-' + sha(p.encode()) for p in g['source']['files']} <= covered, 'full_source_custody')
    refs = g['runtimeRefs']
    need(len(refs) == 2 and refs == sorted(set(refs))
         and sum('/producer-t5-native-' in r for r in refs) == 1
         and sum('/backend-t5-native-' in r for r in refs) == 1, 'producer_backend_refs')
    operation = 'Reserve T5 native producer/backend; resources-sha256=' + sha('\n'.join(refs).encode()) + '; inputs-sha256=' + digest
    need(neutral(repo, g['runtimeReceipt'], refs, operation)['files'] == [], 'runtime_scope')
    binding = g['publicBinding']; exact_ref(repo, binding['ref'], binding['receipt'])
    need(parse(api(repo, 'git/commits/' + binding['receipt'])['message'])
         == {'schema': 'gridex-t5-native-commitment-v1', 'inputSha256': digest}, 'public_digest')
    need(len(g['reviews']) == 2, 'input_reviews')
    reviewers = set()
    for review in g['reviews']:
        exact_ref(repo, review['ref'], review['receipt'])
        r = parse(api(repo, 'git/commits/' + review['receipt'])['message'])
        need(r['schema'] == 'gridex-t5-native-review-v1' and r['inputSha256'] == digest
             and r['verdict'] == 'APPROVE_NATIVE_INPUT' and stamp(r['expiresAt']) >= stamp(g['expiresAt'])
             and r['reviewerSession'] not in authors, 'independent_review')
        need(re.fullmatch(r'refs/tags/agent-claims/masterplan/slot-session-[a-f0-9-]{36}', r['reviewerSession']), 'reviewer_session')
        exact_ref(repo, r['reviewerSession'], r['sessionReceipt']); reviewers.add(r['reviewerSession'])
    need(len(reviewers) == 2, 'independent_review')
    need(run['event'] == 'workflow_dispatch' and run['head_sha'] == g['source']['commit']
         and run['run_attempt'] == g['github']['attempt'] == 1
         and run['path'] == WF, 'workflow_run')


def read_bundle(bundle):
    directory = Path(bundle)
    need(directory.is_absolute() and directory.resolve() == directory and directory.stat().st_uid == os.getuid()
         and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'bundle_directory')
    g = parse(private(directory / 'grant.json')); raw = private(directory / 'assignment.json'); a = parse(raw)
    return directory, g, a, raw


def dependency_inventory(root, max_files=200000, max_bytes=8 * 2 ** 30):
    """Bound the actual prepared installation, including executable modes/links."""
    root = Path(root).resolve(); entries, size = [], 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            p = Path(directory) / name; info = p.lstat(); rel = p.relative_to(root).as_posix()
            if stat.S_ISLNK(info.st_mode):
                need(p.resolve().is_relative_to(root) and p.exists(), 'dependency_link')
                entries.append([rel, 'link', os.readlink(p)])
            elif stat.S_ISREG(info.st_mode):
                size += info.st_size
                need(size <= max_bytes, 'dependency_size')
                entries.append([rel, stat.S_IMODE(info.st_mode), sha(p.read_bytes())])
            else:
                need(stat.S_ISDIR(info.st_mode), 'dependency_type')
            need(len(entries) <= max_files, 'dependency_count')
    need(entries, 'dependency_empty')
    return sha(packed(sorted(entries))), len(entries), size


def cpu_observation(physical_count, affinity, groups_text, mounts_text, read):
    """Record actual current/ancestor CPU settings; CPU is NOT an admission gate."""
    groups = [line.split(':', 2) for line in groups_text.splitlines() if line]
    limits = []
    for line in mounts_text.splitlines():
        f = line.split(); sep = f.index('-'); kind, options = f[sep + 1], f[sep + 3].split(',')
        if kind == 'cgroup2':
            paths = [g[2] for g in groups if g[:2] == ['0', '']]
        elif kind == 'cgroup' and 'cpu' in options:
            paths = [g[2] for g in groups if 'cpu' in g[1].split(',')]
        else:
            continue
        need(len(paths) == 1, 'cpu_cgroup_mapping')
        root, mount, group = map(Path, (f[3], f[4], paths[0]))
        need(all(p.is_absolute() and '..' not in p.parts for p in (root, mount, group))
             and '\\' not in str(mount) and group.is_relative_to(root), 'cpu_cgroup_mapping')
        current = mount / group.relative_to(root)
        while True:
            try:
                if kind == 'cgroup2':
                    quota, period = read(current / 'cpu.max').strip().split()
                else:
                    quota, period = read(current / 'cpu.cfs_quota_us').strip(), read(current / 'cpu.cfs_period_us').strip()
                    if quota == '-1': quota = 'max'
                need((quota == 'max' or quota.isdigit()) and period.isdigit(), 'cpu_cgroup_value')
                limits.append({'path': str(current), 'quota': quota if quota == 'max' else int(quota), 'period': int(period)})
            except FileNotFoundError:
                limits.append({'path': str(current), 'quota': 'unavailable', 'period': None})
            if current == mount: break
            current = current.parent
    return {'physicalCount': physical_count, 'affinity': sorted(affinity), 'affinityCount': len(affinity),
            'controller': 'observed' if limits else 'unavailable', 'limits': limits}


def host_observation(app, home_parent, driver):
    backend = load_module(app, 'prepared-backend')
    ram = backend.effective_ram(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES'), Path('/proc/self/cgroup').read_text(),
                               Path('/proc/self/mountinfo').read_text(), lambda p: p.read_text())
    disk = os.statvfs(home_parent); free = disk.f_bavail * disk.f_frsize
    need(ram >= 8 * 2 ** 30 and free >= (40 if driver == 'vfs' else 15) * 2 ** 30, 'host_capacity')
    return {'effectiveRamBytes': ram, 'freeBytesAtFutureDockerRootFilesystem': free,
            'cpu': cpu_observation(os.cpu_count(), os.sched_getaffinity(0), Path('/proc/self/cgroup').read_text(),
                                   Path('/proc/self/mountinfo').read_text(), lambda p: p.read_text())}


def qualify(bundle, authenticate_live=True):
    directory, g, a, raw = read_bundle(bundle)
    need(os.getuid() == 0 and g['schema'] == 'gridex-t5-native-producer-grant-v1'
         and g['state'] == 'GRANTED' and g['remainingRuns'] == 1 and type(g['remainingRuns']) is int, 'producer_grant')
    system = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    need(system['ID'].strip('"') == 'ubuntu' and system['VERSION_ID'].strip('"') == '24.04', 'host_os')
    effective = int(re.search(r'^CapEff:\s*([0-9a-f]+)$', Path('/proc/self/status').read_text(), re.M)[1], 16)
    need(effective & (1 << 21) and effective & (1 << 12), 'namespace_capabilities')
    need(set(g['allowedOperations']) == {'prepare', 'replay', 'build', 'scenario', 'cleanup'}, 'operations')
    need(time.time() < stamp(g['expiresAt']) < stamp(g['cleanupExpiresAt']), 'expiry')
    need(isinstance(g['inputEpoch'], str) and re.fullmatch(r'[A-Za-z0-9._-]{3,100}', g['inputEpoch'])
         and isinstance(g['producer'], str) and g['producer'] and os.environ.get('NODE_TLS_REJECT_UNAUTHORIZED') != '0', 'producer_identity')
    need(g['hostBootId'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip(), 'host_identity')
    need(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T5' and a['state'] == 'ACTIVE'
         and set(a['allowedOperations']) == {'up', 'run', 'down'} and g['assignmentSha256'] == sha(raw)
         and a['sourceCommit'] == g['source']['commit'] and stamp(a['expiresAt']) >= stamp(g['cleanupExpiresAt'])
         and a['ports']['SIM_DB_PORT'] == 54322, 'assignment')
    check_groups(g['groups'], g['scenarioIds'])
    need(g['dockerDriver'] in ('overlay2', 'overlayfs', 'vfs'), 'driver')
    app, home, evidence = Path(a['runDir']), Path(a['simHome']), Path(g['evidenceDir'])
    for p in (directory, app, home, evidence):
        need(p.is_absolute() and p.resolve() == p and p != Path('/')
             and not any(p == Path(v) or p.is_relative_to(v) for v in ('/run', '/tmp')), 'path')
    need(not home.exists() and not evidence.exists() and not app.is_relative_to(home)
         and not home.is_relative_to(app) and not directory.is_relative_to(home)
         and not evidence.is_relative_to(home) and not home.is_relative_to(evidence), 'exclusive_directories')
    for p in (directory, home.parent, evidence.parent):
        for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
            probe = subprocess.run(['git', '-C', str(p), 'rev-parse', flag], capture_output=True, text=True)
            need(not (probe.returncode == 0 and probe.stdout.strip() == 'true'), 'private_inside_git')
    clean_source(app, g)
    host_observation(app, home.parent, g['dockerDriver'])
    need(os.environ.get('GITHUB_REPOSITORY') == g['repository'] and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
         and os.environ.get('GITHUB_RUN_ID') == str(g['github']['runId']) and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
         and os.environ.get('GITHUB_SHA') == g['github']['sha'] == g['source']['commit']
         and os.environ.get('GITHUB_ACTOR') == g['actor'], 'workflow_identity')
    need(call(['node', '--version']) == 'v22.23.4' and call(['npm', '--version']) == '10.9.2'
         and call(['supabase', '--version']) == '2.101.0' and re.search(r'\b17\.', call(['psql', '--version']))
         and sys.version_info >= (3, 11), 'toolchain')
    need((app / 'node_modules/.bin/next').is_file() and (app / 'node_modules/.bin/vitest').is_file()
         and re.fullmatch('[a-f0-9]{64}', g['dependencyReceiptSha256']), 'prepared_dependencies')
    deps = private(directory / 'dependency-receipt.json')
    prepared = parse(deps)
    need(sha(deps) == g['dependencyReceiptSha256'] and prepared['schema'] == 'gridex-t5-prepared-dependencies-v1'
         and prepared['sourceCommit'] == a['sourceCommit']
         and prepared['packageLockSha256'] == sha((app / 'package-lock.json').read_bytes())
         and prepared['dependencyRoot'] == str((app / 'node_modules').resolve())
         and prepared['node'] == '22.23.4' and prepared['npm'] == '10.9.2'
         and prepared['command'] == ['npm', 'ci']
         and prepared['treeSha256'] == dependency_inventory(app / 'node_modules')[0], 'dependency_receipt')
    need(g['inventorySha256'] == sha(private(directory / 'inventory.json')), 'inventory_hash')
    archive = directory / 'images.tar'; info = archive.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600, 'archive')
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''): digest.update(chunk)
    need(digest.hexdigest() == g['archiveSha256'], 'archive_hash')
    binding = core_digest(g)
    if authenticate_live:
        authenticate(g, binding)
    return directory, g, a, binding


def realm_command(app, bundle):
    return ['unshare', '--mount', '--net', '--pid', '--fork', '--kill-child=KILL', '--mount-proc', '--propagation', 'private',
            'python3', '-B', '-I', str(Path(app) / 'scripts/simulation/track5/lib/native-supervisor.py'), '--realm', str(bundle)]


def process_birth(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()
    return fields[19]


def stop_owned(process):
    if process.poll() is not None:
        return
    identity = process_birth(process.pid); fd = os.pidfd_open(process.pid)
    try:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            need(process_birth(process.pid) == identity, 'process_identity')
            signal.pidfd_send_signal(fd, sig)
            try:
                process.wait(timeout=5); return
            except subprocess.TimeoutExpired:
                pass
        need(False, 'process_cleanup')
    finally:
        os.close(fd)


def child(argv, logfile, **kwargs):
    fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as log:
        parent = os.getpid()
        def parent_death():
            # Close the crash window even if the Python supervisor cannot unwind.
            if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL) != 0 or os.getppid() != parent:
                os.kill(os.getpid(), signal.SIGKILL)
        return subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, preexec_fn=parent_death, **kwargs)


def check_realm(bundle):
    directory, g, a, raw = read_bundle(bundle)
    admission = parse(private(directory / 'admission.private.json'))
    realm = parse(private(Path(a['simHome']) / 'realm.private.json'))
    need(admission['inputSha256'] == core_digest(g) and admission['assignmentSha256'] == sha(raw)
         and realm['namespaces'] == namespaces() and all(realm['namespaces'][k] != admission['hostNamespaces'][k] for k in namespaces())
         and os.getuid() == 0 and time.monotonic() < admission['expiresMonotonic'], 'realm_admission')
    clean_source(Path(a['runDir']), g)
    need(time.monotonic() < admission['expiresMonotonic'], 'realm_admission')
    return directory, g, a, admission


def execution_phase(bundle, action):
    check_realm(bundle)  # guard before every new mutating execution phase
    return action()


def daemon_info(a, g, backend):
    info = parse(call(['docker', 'info', '--format', '{{json .}}']))
    need(info['Driver'] == g['dockerDriver'] and info['DockerRootDir'] == str(Path(a['simHome']) / 'docker-root')
         and info['ID'], 'daemon_identity')
    backend.socket_identity(Path(a['simHome'])); backend.capacity(info)
    return info


def wait_command(argv, process):
    for _ in range(100):
        need(process.poll() is None, 'service_died')
        try:
            call(argv); return
        except subprocess.SubprocessError:
            time.sleep(.1)
    need(False, 'service_not_ready')


def validate_report(report, titles, source_commit):
    steps, runner, summary = report['steps'], report['vitest'], report['summary']
    need(titles and len(set(titles)) == len(titles) and len(steps) == len(titles)
         and all(step['status'] == 'passed' for step in steps)
         and all(sum(step['name'].endswith(title) for step in steps) == 1 for title in titles), 'test_cases')
    need(report['exitCode'] == 0 and report['runDirClean'] is True and report['executionScope'] == 'ISOLATED_NATIVE'
         and report['appCommit'] == report['builtCommit'] == report['replayCommit'] == source_commit
         and runner['success'] is True and runner['numTotalTests'] == runner['numPassedTests'] == len(titles)
         and runner['numFailedTests'] == runner['numPendingTests'] == runner['numTodoTests'] == runner['numFailedTestSuites'] == 0
         and runner['numTotalTestSuites'] >= 1
         and summary == {'passed': len(titles), 'failed': 0, 'skipped': 0, 'total': len(titles)}, 'report_counts')


def reports(home, app, g):
    for group in g['groups']:
        source = app / 'scripts/simulation/track5/scenarios' / (group + '.test.ts')
        # Current frozen T5 callbacks use literal it titles. Unknown dynamic test
        # registration is unsupported here; input reviewers must qualify a successor.
        titles = [m[1] for m in re.findall(r'\bit\(\s*([\'"])((?:\\.|(?!\1).)*?)\1\s*,', source.read_text())]
        need(set(CATALOG[group]) <= set(re.findall(r'(?:AUTH|API|EVENT)01\.[0-9]{2}', ' '.join(titles))), 'scenario_source_catalog')
        report = parse(private(home / 'reports' / (group + '-report.json'), 16 * 1024 * 1024))
        validate_report(report, titles, g['source']['commit'])
        log = Path(report['log'])
        need(log.parent == home / 'logs' and sha(private(log, 64 * 1024 * 1024)) == report['logSha256'], 'report_log')


def run_realm(bundle):
    directory, g, a, raw = read_bundle(bundle); app, home = Path(a['runDir']), Path(a['simHome'])
    admission = parse(private(directory / 'admission.private.json'))
    need(admission['inputSha256'] == core_digest(g) and os.getpid() == 1 and os.getuid() == 0
         and all(namespaces()[k] != admission['hostNamespaces'][k] for k in namespaces()), 'realm_creation')
    write_new(home / 'realm.private.json', {'namespaces': namespaces()})
    check_realm(bundle)
    call(['ip', 'link', 'set', 'lo', 'up'])
    network, backend = load_module(app, 'receiver-network'), load_module(app, 'prepared-backend')
    netgrant = {'schema': 'gridex-t5-receiver-network-grant-v1', 'worker': 'T5', 'state': 'GRANTED',
        'environmentId': a['environmentId'], 'assignmentSha256': sha(raw), 'sourceCommit': a['sourceCommit'],
        'transportSha256': sha((app / 'lib/integrations/publicWebhookTransport.ts').read_bytes()), 'producer': g['producer'],
        'allowedOperations': ['prepare', 'verify', 'cleanup'], 'expiresAt': g['cleanupExpiresAt'],
        'namespaces': namespaces(), 'hostNamespaces': admission['hostNamespaces']}
    netpath = home / 'network-grant.private.json'; write_new(netpath, netgrant)
    nargv = ['python3', '-B', '-I', str(app / 'scripts/simulation/track5/lib/receiver-network.py'), '--assignment', str(directory / 'assignment.json'), '--grant', str(netpath)]
    execution_phase(bundle, lambda: call([*nargv, '--prepare']))
    receiver = execution_phase(bundle, lambda: child(['node', str(app / 'scripts/simulation/track5/lib/webhook-receiver.mjs')], home / 'logs/qualification-receiver.log', env={**os.environ,
        'SIM_HOME': str(home), 'SIM_RECEIVER_TLS_PORT': str(a['ports']['SIM_RECEIVER_TLS_PORT']), 'SIM_RECEIVER_CTRL_PORT': str(a['ports']['SIM_RECEIVER_CTRL_PORT'])}))
    try:
        wait_command(['curl', '--fail', '--silent', 'http://127.0.0.1:' + str(a['ports']['SIM_RECEIVER_CTRL_PORT']) + '/__health'], receiver)
        execution_phase(bundle, lambda: call([*nargv, '--verify']))
    finally:
        stop_owned(receiver)
    check_realm(bundle)
    write_new(home / 'namespace-plan.private.json', {'schema': 'gridex-simulation-namespace-plan-v1', 'worker': 'T5', 'state': 'QUALIFIED',
        'mode': 'PREPARED_EXTERNALLY', 'environmentId': a['environmentId'], 'assignmentSha256': sha(raw), 'networkNamespace': namespaces()['net'],
        'expiresAt': g['cleanupExpiresAt'], 'receiver': {**a['receiver'], 'tlsPort': a['ports']['SIM_RECEIVER_TLS_PORT'], 'controlPort': a['ports']['SIM_RECEIVER_CTRL_PORT']}})
    # Runtime filesystem endpoints are private to this mount namespace, too.
    execution_phase(bundle, lambda: call(['mount', '-t', 'tmpfs', '-o', 'mode=755,nodev,nosuid', 'tmpfs', '/run']))
    daemon = execution_phase(bundle, lambda: child(['dockerd', '--host=unix://' + str(home / 'docker.sock'), '--data-root=' + str(home / 'docker-root'),
        '--exec-root=' + str(home / 'docker-exec'), '--pidfile=' + str(home / 'dockerd.pid'), '--storage-driver=' + g['dockerDriver'], '--bridge=none'], home / 'logs/docker.log'))
    succeeded, clean = False, False
    try:
        wait_command(['docker', 'info'], daemon)
        first = daemon_info(a, g, backend)
        need(not call(['docker', 'ps', '-aq']) and not call(['docker', 'volume', 'ls', '-q']), 'fresh_daemon')
        execution_phase(bundle, lambda: call(['docker', 'load', '-i', str(directory / 'images.tar')], timeout=admission['expiresMonotonic'] - time.monotonic()))
        inventory = parse(private(directory / 'inventory.json'))['images']
        expected = {item['id'] for item in inventory}
        actual = set(call(['docker', 'image', 'ls', '--no-trunc', '--quiet']).splitlines())
        need(expected and actual == expected and all(re.fullmatch(r'sha256:[a-f0-9]{64}', x) for x in expected), 'image_inventory')
        for item in inventory:
            image = parse(call(['docker', 'image', 'inspect', item['id']]))[0]
            need(item['tags'] and set(image['RepoTags'] or []) == set(item['tags'])
                 and all(tag.startswith('ghcr.io/supabase/') for tag in item['tags']), 'image_tags')
        need(daemon_info(a, g, backend)['ID'] == first['ID'], 'daemon_drift')
        write_new(home / 'daemon.private.json', {'id': first['ID'], 'socket': backend.socket_identity(home), 'images': sorted(expected)})
        check_realm(bundle)
        flow = execution_phase(bundle, lambda: child(['bash', str(app / 'scripts/simulation/track5/native-producer.sh'), '--inside-shell', str(directory)], home / 'logs/producer-shell.log'))
        try:
            code = flow.wait(timeout=max(.1, admission['expiresMonotonic'] - time.monotonic()))
        except subprocess.TimeoutExpired:
            stop_owned(flow); code = 124
        succeeded = code == 0
        if succeeded:
            reports(home, app, g)
        clean_source(app, g)
        staged = parse(private(home / 'replay-inputs.private.json', 16 * 1024 * 1024))
        for rel, digest in staged['files']:
            if rel != 'supabase/config.toml':
                need(sha((home / 'replay-root' / rel).read_bytes()) == digest, 'canonical_restore')
        need(not call(['docker', 'ps', '-aq']) and not call(['docker', 'volume', 'ls', '-q']), 'canonical_cleanup')
        networks = [parse(line) for line in call(['docker', 'network', 'ls', '--no-trunc', '--format', '{{json .}}']).splitlines()]
        for item in networks:
            if item['Name'] not in ('host', 'none', 'bridge'):
                call(['docker', 'network', 'rm', item['ID']])
        clean = True
    finally:
        stop_owned(daemon)
    # No broad link deletion: an unknown residual interface forces realm teardown.
    need(time.monotonic() < admission['cleanupExpiresMonotonic'], 'cleanup_expired')
    call([*nargv, '--cleanup'])
    write_new(home / 'execution.private.json', {'shellSucceeded': succeeded, 'canonicalCleanupObserved': clean, 'wholeScenarioPASS': 0})
    return 0 if succeeded and clean else 1


def supervise(bundle):
    directory, g, a, digest = qualify(bundle)
    home, evidence = Path(a['simHome']), Path(g['evidenceDir'])
    consume_budget(directory / ('consumed-' + digest + '.private.json'), digest)
    home.mkdir(mode=0o700); evidence.mkdir(mode=0o700); (home / 'logs').mkdir(mode=0o700); (home / 'reports').mkdir(mode=0o700)
    identity = home.stat()
    now = time.time()
    admission = {'inputSha256': digest, 'assignmentSha256': g['assignmentSha256'], 'hostNamespaces': namespaces(),
        'hostObservation': host_observation(Path(a['runDir']), home.parent, g['dockerDriver']),
        'expiresMonotonic': time.monotonic() + stamp(g['expiresAt']) - now,
        'cleanupExpiresMonotonic': time.monotonic() + stamp(g['cleanupExpiresAt']) - now}
    write_new(directory / 'admission.private.json', admission)
    write_new(evidence / 'host-observation.private.json', admission['hostObservation'])
    # No provider credentials or proxy bindings enter the sealed execution realm.
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
    env.update({'SIM_HOME': str(home), 'RUN_DIR': a['runDir'], 'SIM_RUNTIME_ASSIGNMENT_FILE': str(directory / 'assignment.json'),
        'SIM_NAMESPACE_PLAN_FILE': str(home / 'namespace-plan.private.json'), 'DOCKER_HOST': 'unix://' + str(home / 'docker.sock'),
        'T5_GROUPS': ' '.join(g['groups']), 'NODE_OPTIONS': '--max-old-space-size=6144', 'PYTHONDONTWRITEBYTECODE': '1'})
    process = child(realm_command(a['runDir'], directory), evidence / 'supervisor.private.log', env=env)
    realm_pid, realm_fd, realm_birth = None, None, None
    finished, teardown = False, False
    try:
        for _ in range(500):
            if process.poll() is not None: break
            kids = Path('/proc/' + str(process.pid) + '/task/' + str(process.pid) + '/children').read_text().split()
            if len(kids) == 1:
                realm_pid = int(kids[0]); realm_birth = process_birth(realm_pid); realm_fd = os.pidfd_open(realm_pid); break
            time.sleep(.01)
        need(realm_fd is not None, 'realm_pidfd')
        try:
            finished = process.wait(timeout=max(.1, admission['cleanupExpiresMonotonic'] - time.monotonic())) == 0
        except subprocess.TimeoutExpired:
            finished = False
    finally:
        if realm_fd is not None:
            # PID1 destruction contains setsid/reparented descendants by kernel ABI.
            if Path('/proc/' + str(realm_pid)).exists():
                need(process_birth(realm_pid) == realm_birth, 'realm_identity')
                signal.pidfd_send_signal(realm_fd, signal.SIGKILL)
            os.close(realm_fd)
        stop_owned(process)
        for _ in range(100):
            if realm_pid is None or not Path('/proc/' + str(realm_pid)).exists(): break
            time.sleep(.05)
        teardown = not Path('/proc/' + str(realm_pid)).exists() if realm_pid else False
        for name in ('logs', 'reports'):
            dest = evidence / name; dest.mkdir(mode=0o700)
            for path in (home / name).iterdir():
                need(path.is_file() and not path.is_symlink(), 'private_evidence_file')
                target = dest / path.name
                shutil.copyfile(path, target); target.chmod(0o600)
        current = home.stat()
        need(home.resolve() == home and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino) and teardown, 'private_cleanup_identity')
        shutil.rmtree(home)  # exact newly created owned directory, after PIDns death
    result = {'state': 'EXECUTION_FINISHED_REVIEW_REQUIRED' if finished and teardown else 'HOLD',
              'namespaceDestroyed': teardown, 'privateRuntimeRemoved': not home.exists(), 'wholeScenarioPASS': 0}
    write_new(evidence / 'summary.json', result)
    print(json.dumps(result))
    return 0 if finished and teardown else 1


def main():
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_mutually_exclusive_group(required=True)
    for name in ('supervise', 'realm', 'check-realm'): modes.add_argument('--' + name)
    args = p.parse_args()
    def interrupted(_sig, _frame):
        raise InterruptedError('owned producer interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if args.supervise: return supervise(args.supervise)
        if args.realm: return run_realm(args.realm)
        check_realm(args.check_realm); return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        print(json.dumps({'state': 'HOLD', 'error': 'native_producer_rejected', 'wholeScenarioPASS': 0}))
        return 1


if __name__ == '__main__': raise SystemExit(main())
