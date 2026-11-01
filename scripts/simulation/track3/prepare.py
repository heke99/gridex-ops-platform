"""Source-only T3 producer contract. No default allocation, adapter or dispatch.

check validates inputs read-only; execute consumes one explicit private plan once.
Backend/replay adapters are separately reviewed tracked source, never shell data.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TRACK = Path(__file__).resolve().parent
HARNESS = TRACK.parents[2]
SCENARIO_IDS = tuple(f'EDIEL{group:02}.{case:02}' for group, count in [(1, 6), (2, 6), (3, 5)] for case in range(1, count + 1))
SCENARIO_FILES = tuple('scenarios/' + name + '.test.ts' for name in [
    'ediel01', 'ediel02-dup', 'ediel02-corr', 'ediel02-auth', 'ediel02-syntax',
    'ediel03-01', 'ediel03-02', 'ediel03-03', 'ediel03-04', 'ediel03-05'])


class Blocked(ValueError):
    def __init__(self, code, exit_code=None):
        super().__init__(code)
        self.exit_code = exit_code


def need(condition, code):
    if not condition:
        raise Blocked(code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    need(isinstance(value, str) and Path(value).is_absolute(), 'absolute_path_required')
    path = Path(value)
    need(str(path.resolve(strict=True)) == value, 'canonical_path_required')
    return path


def private(path, directory=False):
    path = canonical(str(path))
    meta = path.stat()
    need(meta.st_uid == os.getuid() and stat.S_IMODE(meta.st_mode) == (0o700 if directory else 0o600)
         and (path.is_dir() if directory else path.is_file()), 'private_path_required')
    return path


def read_json(path):
    return json.loads(private(path).read_bytes())


def save(path, value):
    with open(path, 'x', opener=lambda name, flags: os.open(name, flags | os.O_NOFOLLOW, 0o600)) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def capture(argv, cwd=None, env=None):
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=20, check=False)
    need(result.returncode == 0, 'identity_command_failed')
    return result.stdout.rstrip('\n')


def capacity(driver, effective_ram, free_bytes):
    need(driver in ('vfs', 'overlay2', 'overlayfs'), 'unknown_docker_driver')
    need(effective_ram >= 8 * 2**30, 'effective_ram_below_8gib')
    need(free_bytes >= (40 if driver == 'vfs' else 15) * 2**30, 'docker_root_free_space_below_floor')


def docker_socket(endpoint):
    need(endpoint.startswith('unix:///'), 'local_unix_docker_required')
    # /var/run commonly resolves to /run; bind the actual socket, not its alias.
    sock = Path(endpoint[7:]).resolve(strict=True)
    need(stat.S_ISSOCK(sock.stat().st_mode), 'docker_socket_required')
    return sock


def phase_environment(host, node):
    return {'PATH': str(Path(node).parent) + ':/usr/local/bin:/usr/bin:/bin',
            'PYTHONDONTWRITEBYTECODE': '1', 'DOCKER_HOST': 'unix://' + host['socket']}


def host_identity(enforce_capacity=True):
    # DockerRootDir must be stat-able on this host. A remote daemon is not a local runner.
    need(not os.environ.get('DOCKER_CONTEXT'), 'conflicting_docker_context_not_supported')
    endpoint = os.environ.get('DOCKER_HOST') or capture(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    sock = docker_socket(endpoint)
    meta = sock.stat()
    info = json.loads(capture(['docker', '--host', 'unix://' + str(sock), 'info', '--format', '{{json .}}'],
                              env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')}))
    root = canonical(info['DockerRootDir'])
    usage = os.statvfs(root)
    ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    for file in ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']:
        if Path(file).is_file():
            text = Path(file).read_text().strip()
            if text != 'max': ram = min(ram, int(text))
    free = usage.f_bavail * usage.f_frsize
    if enforce_capacity: capacity(info['Driver'], ram, free)
    need(isinstance(info.get('ID'), str) and info['ID'], 'daemon_identity_missing')
    cpu_file = Path('/sys/fs/cgroup/cpu.max')
    return {'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'daemonId': info['ID'], 'driver': info['Driver'], 'dockerRootDir': str(root),
            'socket': str(sock), 'socketDev': meta.st_dev, 'socketInode': meta.st_ino,
            'effectiveRamBytes': ram, 'freeBytes': free, 'cpuCount': os.cpu_count(),
            'cpuMax': cpu_file.read_text().strip() if cpu_file.is_file() else 'unavailable'}


def same_host(before, after):
    need(all(before[key] == after[key] for key in ['bootId', 'daemonId', 'driver', 'dockerRootDir', 'socket', 'socketDev', 'socketInode']), 'runner_or_daemon_changed')


def validate_environment(values, home, ports):
    from urllib.parse import urlsplit
    need(isinstance(values, dict) and all(isinstance(k, str) and isinstance(v, str) and '\0' not in v for k, v in values.items()), 'private_environment_invalid')
    # Same consumer whitelist, checked before any producer command. No shell env.
    allowed = set('T3_MODE T3_APP_PORT T3_APP_URL T3_SMTP_PORT T3_IMAP_TLS_PORT T3_IMAP_PLAIN_PORT T3_CONTROL_PORT T3_MAILBOX_ADDRESS T3_IMAP_USER T3_IMAP_PASS T3_SIM_HOME T3_DB_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NODE_EXTRA_CA_CERTS EDIEL_EMAIL_PROVIDER EDIEL_SMTP_HOST EDIEL_SMTP_PORT EDIEL_SMTP_SECURE EDIEL_SMTP_USER EDIEL_SMTP_PASS EDIEL_SMTP_FROM EDIEL_SHARED_MAILBOX_ADDRESS EDIEL_MESSAGE_ID_DOMAIN EDIEL_IMAP_HOST EDIEL_IMAP_PORT EDIEL_IMAP_USER EDIEL_IMAP_PASS EDIEL_CRON_SECRET EDIEL_INBOUND_CRON_SECRET EDIEL_AUTOMATION_ACTOR_USER_ID NEXT_TELEMETRY_DISABLED T3_E01_N T3_E01_OWN_ID T3_E02_OWN_ID T3_E03_OWN_ID T3_APP_AUTOMATION_ACTOR_USER_ID'.split())
    need(set(values) <= allowed, 'unknown_environment_key')
    for key in ['EDIEL_CRON_SECRET', 'EDIEL_INBOUND_CRON_SECRET', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'EDIEL_SMTP_PASS', 'T3_IMAP_PASS']:
        need(values.get(key), 'required_local_credential_missing')
    need(values.get('T3_E01_N', '28') == '28', 'full_ediel_cohort_28_required')
    db = urlsplit(values.get('T3_DB_URL', ''))
    need(db.scheme in ['postgres', 'postgresql'] and db.hostname == '127.0.0.1' and db.port == ports['db']
         and db.path == '/postgres' and not db.query and not db.fragment, 'assigned_database_required')
    need(values.get('T3_MODE') in ['test', 'production'] and values.get('T3_SIM_HOME') == str(home)
         and values.get('NEXT_PUBLIC_SUPABASE_URL') == f"http://127.0.0.1:{ports['api']}"
         and values.get('SUPABASE_URL', values['NEXT_PUBLIC_SUPABASE_URL']) == values['NEXT_PUBLIC_SUPABASE_URL']
         and values.get('T3_APP_URL') == f"http://127.0.0.1:{ports['app']}", 'assigned_endpoints_required')
    for port, key in {'app': 'T3_APP_PORT', 'smtp': 'T3_SMTP_PORT', 'imapTls': 'T3_IMAP_TLS_PORT', 'imapPlain': 'T3_IMAP_PLAIN_PORT', 'control': 'T3_CONTROL_PORT'}.items():
        need(values.get(key) == str(ports[port]), 'assigned_mail_port_required')
    need(values.get('EDIEL_SMTP_HOST') == values.get('EDIEL_IMAP_HOST') == '127.0.0.1'
         and values.get('EDIEL_SMTP_PORT') == str(ports['smtp']) and values.get('EDIEL_IMAP_PORT') == str(ports['imapTls'])
         and values.get('EDIEL_SMTP_SECURE') == 'true' and values.get('EDIEL_EMAIL_PROVIDER') == 'strato'
         and values.get('EDIEL_IMAP_PASS') == values['T3_IMAP_PASS']
         and values.get('T3_MAILBOX_ADDRESS') == values.get('EDIEL_SMTP_USER') == 'ediel@t3.sim.invalid'
         and values.get('EDIEL_IMAP_USER') == values.get('T3_IMAP_USER') and values.get('T3_IMAP_USER')
         and values.get('NODE_EXTRA_CA_CERTS') == str(home / 'ca/ca.pem'), 'assigned_mail_chain_required')


def validate_replay(receipt, plan_hash, app_commit, app_tree, log_hash):
    need(receipt.get('planSha256') == plan_hash and receipt.get('appCommit') == app_commit
         and receipt.get('appTree') == app_tree and receipt.get('schema') == 'track3-canonical-replay-v1'
         and receipt.get('kind') == 'canonical_supabase_cli' and receipt.get('officialLedgerVerified') is True
         and type(receipt.get('postReplayAppliedMigrations')) is int and receipt['postReplayAppliedMigrations'] == 0
         and receipt.get('replayCommit') == app_commit and receipt.get('logSha256') == log_hash, 'canonical_replay_provenance_required')


def source(path, commit, tree):
    need(re.fullmatch('[a-f0-9]{40}', commit or '') and re.fullmatch('[a-f0-9]{40}', tree or ''), 'full_source_identity_required')
    need(capture(['git', '-C', str(path), 'rev-parse', 'HEAD']) == commit
         and capture(['git', '-C', str(path), 'rev-parse', 'HEAD^{tree}']) == tree
         and not capture(['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=normal']), 'source_not_exact_clean_commit')


def dependencies(app, plan):
    need(sha((app / 'package-lock.json').read_bytes()) == plan['dependencyLockSha256']
         and sha((app / 'node_modules/.package-lock.json').read_bytes()) == plan['nodeModulesLockSha256'], 'qualified_dependency_locks_differ')
    lock = json.loads((app / 'package-lock.json').read_text())
    next_package = json.loads((app / 'node_modules/next/package.json').read_text())
    need(next_package['version'] == lock['packages']['node_modules/next']['version'], 'installed_next_differs_from_lock')


def validate_report(report, assignment_hash):
    need(report.get('exit') == 0 and report.get('scenarios'), 'scenario_report_missing_or_failed')
    observed = set()
    for item in report['scenarios']:
        v = item.get('vitest') or {}
        need(item.get('exit') == 0 and item.get('harnessError') is None and v.get('success') is True
             and isinstance(v.get('numTotalTests'), int) and v['numTotalTests'] > 0
             and v.get('numPassedTests') == v['numTotalTests']
             and all(v.get(key) == 0 for key in ['numFailedTests', 'numPendingTests', 'numTodoTests'])
             and item.get('identity', {}).get('assignmentSha256') == assignment_hash
             and item.get('evidenceManifest') and item.get('steps'), 'scenario_evidence_incomplete')
        for step in item['steps']:
            need(step.get('status') == 'passed', 'scenario_step_not_passed')
            if step.get('scenarioId'): observed.add(step['scenarioId'])
    need(observed == set(SCENARIO_IDS), 'all_seventeen_scenario_ids_required')


def verify_manifest(manifest, evidence_root):
    manifest = private(manifest)
    need(manifest.is_relative_to(evidence_root.resolve()), 'evidence_outside_assigned_home')
    entries = private(manifest).read_text().splitlines()
    need(entries, 'empty_evidence_manifest')
    seen = set()
    for line in entries:
        match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
        need(match, 'invalid_evidence_manifest')
        rel = Path(match[2])
        need(not rel.is_absolute() and '..' not in rel.parts and str(rel) not in seen, 'ambiguous_evidence_path')
        seen.add(str(rel))
        file = private(manifest.parent / rel)
        need(file.is_relative_to(manifest.parent) and sha(file.read_bytes()) == match[1], 'evidence_bytes_changed')


def sequence(phase):
    failure = None
    up_attempted = False
    cleanup = 'NOT_ATTEMPTED'
    cleanup_errors = []
    name = 'backend'
    def detail(error, current):
        code = str(error) if isinstance(error, Blocked) and re.fullmatch('[a-z_]+', str(error)) else 'private_phase_exception'
        return {'phase': current, 'code': code, 'exceptionType': type(error).__name__,
                'exitCode': getattr(error, 'exit_code', None)}
    try:
        for name in ['backend', 'replay', 'build', 'seal', 'up', 'run']:
            if name == 'up': up_attempted = True
            phase(name)
    except Exception as error:
        failure = detail(error, name)
    finally:
        safe = True
        if up_attempted:
            try: phase('down')
            except Exception as error:
                safe = False
                cleanup = 'HOLD_UNKNOWN_APP_MAIL'
                cleanup_errors.append(detail(error, 'down'))
        if safe:
            try:
                phase('cleanup')
                cleanup = 'COMPLETED'
            except Exception as error:
                cleanup = 'BACKEND_CLEANUP_FAILED'
                cleanup_errors.append(detail(error, 'cleanup'))
    return {'ok': failure is None and cleanup == 'COMPLETED', 'failure': failure, 'cleanup': cleanup, 'cleanupErrors': cleanup_errors}


class Packet:
    def __init__(self, plan_file):
        self.file = private(plan_file)
        self.original = self.file.read_bytes()
        self.plan = p = json.loads(self.original)
        need(p.get('schema') == 'track3-runner-plan-v1' and p.get('workerId') == 'codex-track3'
             and p.get('exclusiveHost') is True and type(p.get('attemptBudget')) is int and p['attemptBudget'] == 1, 'explicit_single_use_producer_plan_required')
        need(set(p.get('allowedActions', [])) == {'backend', 'replay', 'build', 'up', 'run', 'down', 'cleanup'}, 'exact_actions_required')
        for key in ['producerReservation', 'backendReservation', 'inputEpoch', 'model']:
            need(isinstance(p.get(key), str) and p[key].strip(), 'reservation_epoch_model_required')
        refs = p.get('reservationRefs')
        need(isinstance(refs, list) and len(refs) >= 2, 'verified_producer_and_backend_reservations_required')
        for item in refs:
            need(re.fullmatch(r'refs/tags/agent-claims/[A-Za-z0-9_./-]+', item.get('ref', ''))
                 and re.fullmatch('[a-f0-9]{40}', item.get('sha', '')), 'exact_reservation_ref_required')
            observed = capture(['git', '-C', str(HARNESS), 'ls-remote', 'origin', item['ref']]).split()
            need(observed == [item['sha'], item['ref']], 'live_reservation_differs')
        self.expires = datetime.fromisoformat(p['expiresAtUtc'].replace('Z', '+00:00'))
        need(self.expires.utcoffset().total_seconds() == 0 and self.expires > datetime.now(timezone.utc), 'future_utc_expiry_required')
        self.home = private(p['simHome'], True)
        self.app = canonical(p['appDir'])
        for directory in [self.home, self.file.parent]:
            for flag in ['--is-inside-work-tree', '--is-inside-git-dir']:
                result = subprocess.run(['git', '-C', str(directory), 'rev-parse', flag], capture_output=True, text=True, timeout=20)
                need(not (result.returncode == 0 and result.stdout.strip() == 'true'), 'private_inputs_outside_git_required')
        need(not self.home.is_relative_to(self.app) and not self.home.is_relative_to(HARNESS), 'private_home_outside_checkouts_required')
        source(self.app, p['appCommit'], p['appTree'])
        source(HARNESS, p['harnessCommit'], p['harnessTree'])
        need(re.fullmatch('t3-[A-Za-z0-9-]{5,77}', p.get('environmentId', '')), 'environment_id_invalid')
        need(re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', p.get('projectId', '')) and p['projectId'] != 'gridex-ops-platform', 'dedicated_project_required')
        ports = p['ports']
        need(set(ports) == {'api', 'app', 'control', 'db', 'imapPlain', 'imapTls', 'smtp'}
             and all(type(v) is int and 0 < v < 65536 for v in ports.values()) and len(set(ports.values())) == 7, 'seven_unique_ports_required')
        need(isinstance(p.get('overlayRefs'), list) and all(re.fullmatch('[a-f0-9]{40}', x) for x in p['overlayRefs']), 'exact_overlay_commits_required')
        for commit in p['overlayRefs']:
            need(subprocess.run(['git', '-C', str(self.app), 'merge-base', '--is-ancestor', commit, p['appCommit']], capture_output=True).returncode == 0, 'overlay_not_in_app_ancestry')
        need(re.fullmatch('greenmail/standalone@sha256:[a-f0-9]{64}', p.get('greenmailImage', '')), 'pinned_mail_image_required')
        self.node = str(canonical(p['nodeBin']))
        self.versions = {'node': capture([self.node, '--version']), 'python': sys.version.split()[0],
                         'psql': capture(['psql', '--version']), 'supabase': capture(['supabase', '--version']),
                         'docker': capture(['docker', '--version']), 'git': capture(['git', '--version'])}
        need(self.versions['node'].startswith('v22.'), 'node22_required')
        need(self.versions['psql'].split()[2].startswith('17.'), 'psql17_required')
        need(self.versions['supabase'] == '2.101.0', 'supabase_pin_required')
        self.env = read_json(self.home / 'env/track3.json')
        validate_environment(self.env, self.home, ports)
        for file in ['ca/ca.pem', 'ca/server.pem', 'ca/server.key', 'secrets/smtp-pass']:
            private(self.home / file)
        need((self.home / 'secrets/smtp-pass').read_text().strip() == self.env['EDIEL_SMTP_PASS'], 'mail_password_file_differs')
        need(all(not (self.app / f).exists() for f in ['.env', '.env.local', '.env.production', '.env.production.local']), 'unassigned_dotenv_file')
        need((self.app / 'node_modules/next/dist/bin/next').is_file() and not (self.app / '.next/BUILD_ID').exists(), 'locked_dependencies_and_fresh_build_required')
        dependencies(self.app, p)
        workflow = p['workflow']
        workflow_file = canonical(str(HARNESS / workflow['path']))
        need(workflow_file.is_relative_to(HARNESS / '.github/workflows')
             and sha(workflow_file.read_bytes()) == workflow['sha256']
             and capture(['git', '-C', str(HARNESS), 'ls-files', '--error-unmatch', '--', workflow['path']]) == workflow['path'], 'reviewed_workflow_source_required')
        # The current consumer expects a committed config overlay. No dirty rewrite/shim.
        import tomllib
        config = tomllib.loads((self.app / 'supabase/config.toml').read_text())
        need(config['project_id'] == p['projectId'] and config['db']['port'] == ports['db'] and config['api']['port'] == ports['api'], 'committed_backend_config_overlay_required')
        self.adapters = {}
        for name in ['backend', 'replay', 'cleanup']:
            entry = p['adapters'][name]
            file = canonical(str(self.app / entry['path']))
            need(file.is_relative_to(self.app) and file.suffix == '.py'
                 and sha(file.read_bytes()) == entry['sha256']
                 and capture(['git', '-C', str(self.app), 'ls-files', '--error-unmatch', '--', entry['path']]) == entry['path'], 'tracked_reviewed_python_adapter_required')
            self.adapters[name] = file
        self.lifecycle_hashes = {file: sha(file.read_bytes()) for file in [TRACK / 'down.sh', TRACK / 'lib/common.sh']}
        need(all(0 < p['timeouts'][key] <= 7200 and type(p['timeouts'][key]) is int for key in p['allowedActions']), 'bounded_phase_timeouts_required')
        self.host = host_identity()
        capture(['docker', '--host', 'unix://' + self.host['socket'], 'image', 'inspect', '--format', '{{.Id}}', p['greenmailImage']],
                env=phase_environment(self.host, self.node))
        self.env_hash = sha((self.home / 'env/track3.json').read_bytes())
        self.events = []

    def fresh(self, cleanup=False):
        need(self.file.read_bytes() == self.original, 'plan_changed')
        private(self.home, True)
        if cleanup:
            need(all(sha(file.read_bytes()) == expected for file, expected in self.lifecycle_hashes.items()), 'cleanup_source_changed')
        if not cleanup:
            need(datetime.now(timezone.utc) < self.expires, 'plan_expired')
            source(self.app, self.plan['appCommit'], self.plan['appTree'])
            source(HARNESS, self.plan['harnessCommit'], self.plan['harnessTree'])
            dependencies(self.app, self.plan)
            need(sha((self.home / 'env/track3.json').read_bytes()) == self.env_hash, 'private_environment_changed_before_fixture')
            for item in self.plan['reservationRefs']:
                need(capture(['git', '-C', str(HARNESS), 'ls-remote', 'origin', item['ref']]).split() == [item['sha'], item['ref']], 'live_reservation_changed')
        same_host(self.host, host_identity(enforce_capacity=not cleanup))

    def execute_command(self, name, argv, env):
        # Private logs only. No shell, retries, borrowed environment or swallowed exit.
        log = self.home / ('runner-' + name + '.log')
        with open(log, 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as output:
            child = subprocess.Popen(argv, cwd=self.app, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = child.wait(timeout=self.plan['timeouts'].get(name, 120))
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                os.killpg(child.pid, signal.SIGTERM)
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                raise Blocked('phase_timed_out_or_interrupted')
        if code != 0: raise Blocked('phase_failed', exit_code=code)

    def phase(self, name):
        self.fresh(cleanup=name in ['down', 'cleanup'])
        p = self.plan
        env = phase_environment(self.host, self.node)
        self.events.append({'phase': name, 'state': 'INTENT', 'at': time.time()})
        save(self.home / ('intent-' + name + '.json'), self.events[-1])
        if name in self.adapters:
            need(sha(self.adapters[name].read_bytes()) == p['adapters'][name]['sha256'], 'adapter_source_changed')
            self.execute_command(name, [sys.executable, str(self.adapters[name]), name, str(self.file)], env)
            if name == 'replay':
                validate_replay(read_json(self.home / 'producer-replay.json'), sha(self.original), p['appCommit'], p['appTree'],
                                sha(private(self.home / 'producer-replay.log').read_bytes()))
            if name == 'cleanup':
                receipt = read_json(self.home / 'producer-cleanup.json')
                need(receipt.get('planSha256') == sha(self.original) and receipt.get('clean') is True
                     and receipt.get('unknownResources') == [], 'backend_cleanup_not_verified')
        elif name == 'build':
            need(not (self.app / '.next/BUILD_ID').exists(), 'stale_build_not_reusable')
            self.execute_command(name, [self.node, '--max-old-space-size=6144', 'node_modules/next/dist/bin/next', 'build', '--webpack'],
                                 {**env, **self.env, 'NEXT_TELEMETRY_DISABLED': '1'})
            need((self.app / '.next/BUILD_ID').read_text().strip(), 'fresh_build_id_missing')
        elif name == 'seal': self.seal()
        else:
            env.update({'SIM_HOME': str(self.home), 'SIM_RUN_DIR': str(self.app), 'T3_APP_COMMIT': p['appCommit'],
                        'T3_DB_URL': self.env['T3_DB_URL'], 'T3_RUNTIME_ASSIGNMENT_FILE': str(self.home / 'runtime-assignment.json'),
                        'T3_BACKEND_ASSIGNMENT_FILE': str(self.home / 'backend-assignment.json'),
                        'T3_CLEANUP_ASSIGNMENT_FILE': str(self.home / 'cleanup-assignment.json'), 'SIM_REPORT': str(self.home / 'report.json')})
            if name == 'down':
                need((self.home / 'cleanup-assignment.json').is_file(), 'partial_startup_requires_exact_recovery')
            self.execute_command(name, ['bash', str(TRACK / (name + '.sh'))] + (list(SCENARIO_FILES) if name == 'run' else []), env)
            if name == 'up': self.env_hash = sha((self.home / 'env/track3.json').read_bytes())
            if name == 'run':
                report = read_json(self.home / 'report.json')
                validate_report(report, sha((self.home / 'runtime-assignment.json').read_bytes()))
                for item in report['scenarios']: verify_manifest(Path(item['evidenceManifest']), self.home / 'evidence')
        self.events.append({'phase': name, 'state': 'COMPLETED', 'at': time.time()})

    def seal(self):
        p = self.plan
        backend = read_json(self.home / 'producer-backend.json')
        replay = read_json(self.home / 'producer-replay.json')
        for receipt in [backend, replay]:
            need(receipt.get('planSha256') == sha(self.original) and receipt.get('appCommit') == p['appCommit']
                 and receipt.get('appTree') == p['appTree'], 'producer_receipt_source_mismatch')
        validate_replay(replay, sha(self.original), p['appCommit'], p['appTree'], sha(private(self.home / 'producer-replay.log').read_bytes()))
        b = backend['backendAssignment']
        need(b.get('version') == 1 and b.get('workerId') == 'T3' and b.get('environmentId') == p['environmentId']
             and b.get('projectId') == p['projectId'] and b.get('host') == '127.0.0.1'
             and b.get('port') == p['ports']['db'] and b.get('database') == 'postgres', 'backend_assignment_mismatch')
        save(self.home / 'backend-assignment.json', b)
        dbargs = ['psql', self.env['T3_DB_URL'], '-XAtq', '-v', 'ON_ERROR_STOP=1']
        ledger = capture(dbargs + ['-F', '\t', '-c', "SET default_transaction_read_only=on; SELECT version,coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version"])
        official = json.loads((self.app / 'scripts/gridex-aud-003-main-ledger.json').read_text())['entries']
        need(ledger.splitlines() == sorted(str(x['version']) + '\t' + x['name'] for x in official), 'official_ledger_differs')
        fingerprint = capture(dbargs + ['-f', str(self.app / 'scripts/gridex-aud-003-schema-fingerprint.sql')])
        need(re.fullmatch('[a-f0-9]{64}', fingerprint), 'partial_schema_fingerprint_invalid')
        # Before any fixture the newly allocated backend must be quiescent.
        # Later E02/E03 admission still checks exact receipt-owned rows per drain.
        active = capture(dbargs + ['-c', "SET default_transaction_read_only=on; SELECT count(*) FROM public.ediel_outbox WHERE status IN ('prepared','queued','sending')"])
        need(active == '0', 'unassigned_active_outbox_before_fixture')
        run = {'schema': 'track3-preparation-run-v1', 'planSha256': sha(self.original), 'host': self.host,
               'appCommit': p['appCommit'], 'harnessCommit': p['harnessCommit'], 'events': self.events,
               'versions': self.versions, 'workflow': p['workflow'],
               'buildLogSha256': sha(private(self.home / 'runner-build.log').read_bytes()),
               'replayReceiptSha256': sha((self.home / 'producer-replay.json').read_bytes())}
        save(self.home / 'preparation-run.json', run)
        prepared = {'schema': 'track3-prepared-runtime-v1', 'producerReservation': p['producerReservation'],
                    'appCommit': p['appCommit'], 'appTree': p['appTree'], 'harnessCommit': p['harnessCommit'],
                    'replayCommit': p['appCommit'], 'nextBuildId': (self.app / '.next/BUILD_ID').read_text().strip(),
                    'sourceSchemaSha256': sha((self.app / 'supabase/schema.sql').read_bytes()), 'schemaFingerprint': fingerprint,
                    'ledgerMigrationsSha256': sha((ledger + '\n').encode()), 'overlayRefs': p['overlayRefs'],
                    'postReplayAppliedMigrations': 0, 'preparationRunSha256': sha((self.home / 'preparation-run.json').read_bytes()),
                    'publicBuildEnvSha256': sha(json.dumps([self.env['NEXT_PUBLIC_SUPABASE_URL'], self.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']], ensure_ascii=False, separators=(',', ':')).encode())}
        save(self.home / 'prepared-runtime.json', prepared)
        assignment = {key: p[key] for key in ['environmentId', 'exclusiveHost', 'backendReservation', 'expiresAtUtc', 'appDir',
                     'appCommit', 'simHome', 'harnessCommit', 'harnessTree', 'overlayRefs', 'model', 'ports', 'projectId', 'greenmailImage']}
        assignment.update(schema='track3-runtime-assignment-v1', workerId='codex-track3', allowedActions=['up', 'run', 'down'],
                          greenmailName=p['environmentId'] + '-greenmail', apiContainerId=backend['apiContainerId'], storageContainerId=backend['storageContainerId'],
                          backendAssignmentSha256=sha((self.home / 'backend-assignment.json').read_bytes()), preparedReceiptSha256=sha((self.home / 'prepared-runtime.json').read_bytes()))
        save(self.home / 'runtime-assignment.json', assignment)
        # Reuse the actual legacy consumer before any fixture. It independently
        # inspects DB/API/Storage identities, all ports, PostgreSQL17 and build.
        capture([self.node, str(TRACK / 'lib/seed-cli.mjs'), '--admit', 'up'], env={**phase_environment(self.host, self.node),
            'SIM_HOME': str(self.home), 'SIM_RUN_DIR': str(self.app), 'T3_APP_COMMIT': p['appCommit'],
            'T3_DB_URL': self.env['T3_DB_URL'], 'T3_RUNTIME_ASSIGNMENT_FILE': str(self.home / 'runtime-assignment.json'),
            'T3_BACKEND_ASSIGNMENT_FILE': str(self.home / 'backend-assignment.json')})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'execute', 'host-check'])
    parser.add_argument('--plan')
    args = parser.parse_args()
    if args.mode == 'host-check':
        print(json.dumps(host_identity()))
        return 0
    packet = Packet(args.plan)
    if args.mode == 'check':
        print('T3_SOURCE_INPUTS_CHECKED_NOT_PROVISIONED')
        return 0
    # A new journal is the attempt budget. Existing or ambiguous attempts are never retried.
    with open(packet.home / 'producer.lock', 'a', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        save(packet.home / 'execution-intent.json', {'planSha256': sha(packet.original), 'host': packet.host})
        result = sequence(packet.phase)
        save(packet.home / 'execution-result.json', {**result, 'events': packet.events, 'wholeScenarioAcceptance': 'REQUIRES_INDEPENDENT_REVIEW'})
    print('T3_RUNNER_COMPLETED' if result['ok'] else 'T3_RUNNER_HOLD_SEE_PRIVATE_RESULT')
    code = (result['failure'] or {}).get('exitCode')
    return 0 if result['ok'] else code if isinstance(code, int) and 1 <= code <= 255 else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # No plan, credentials, subprocess output, paths or DB URLs in public errors.
        print('BLOCKED: T3 runner input, identity or lifecycle check failed', file=sys.stderr)
        sys.exit(1)
