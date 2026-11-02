"""Finite-port runner tests: no Docker, database, build or native acceptance."""
import importlib.util
import unittest
import copy
import tempfile
import subprocess
import os
import stat
import json
from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('t3_prepare', Path(__file__).with_name('prepare.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ContractTests(unittest.TestCase):
    def test_actual_private_phase_log_and_failure_exit_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = runner.Packet.__new__(runner.Packet)
            packet.home = packet.app = root
            packet.plan = {'timeouts': {'synthetic': 2}}
            import sys
            with self.assertRaises(runner.Blocked) as failure:
                packet.execute_command('synthetic', [sys.executable, '-c', 'print("synthetic private log"); raise SystemExit(23)'], {'PATH': '/usr/bin:/bin'})
            self.assertEqual(failure.exception.exit_code, 23)
            self.assertEqual((root / 'runner-synthetic.log').stat().st_mode & 0o777, 0o600)
            self.assertIn('synthetic private log', (root / 'runner-synthetic.log').read_text())
            with self.assertRaises(FileExistsError):
                packet.execute_command('synthetic', [sys.executable, '-c', 'raise SystemExit(0)'], {})

    def test_cleanup_does_not_execute_changed_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = root / 'cleanup.py'
            adapter.write_text('# reviewed\n')
            packet = runner.Packet.__new__(runner.Packet)
            packet.home = root
            packet.host = {'socket': '/synthetic/docker.sock'}
            packet.node = '/synthetic/node'
            packet.plan = {'adapters': {'cleanup': {'sha256': runner.sha(adapter.read_bytes())}}}
            packet.adapters = {'cleanup': adapter}
            packet.events = []
            adapter.write_text('# changed\n')
            with patch.object(packet, 'fresh'), patch.object(packet, 'execute_command', side_effect=AssertionError('must not execute')):
                with self.assertRaisesRegex(runner.Blocked, 'adapter_source_changed'): packet.phase('cleanup')

    def test_original_failure_and_cleanup_failure_remain_separate(self):
        def phase(name):
            if name == 'replay': raise runner.Blocked('canonical_replay_failed')
            if name == 'cleanup': raise runner.Blocked('cleanup_identity_changed')
        result = runner.sequence(phase)
        self.assertEqual(result['failure']['phase'], 'replay')
        self.assertEqual(result['failure']['code'], 'canonical_replay_failed')
        self.assertEqual(result['cleanupErrors'][0]['code'], 'cleanup_identity_changed')

    def test_socket_parent_symlink_resolves_to_actual_local_socket(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'actual').mkdir()
            (root / 'alias').symlink_to(root / 'actual', target_is_directory=True)
            (root / 'actual/docker.sock').touch()
            # Finite socket-type port; no socket/daemon is opened by this test.
            with patch.object(runner.stat, 'S_ISSOCK', return_value=True):
                self.assertEqual(runner.docker_socket('unix://' + str(root / 'alias/docker.sock')), root / 'actual/docker.sock')
        with self.assertRaises(runner.Blocked): runner.docker_socket('tcp://synthetic.invalid:2375')

    def test_conflicting_context_is_rejected_before_docker_command(self):
        with patch.dict(os.environ, {'DOCKER_CONTEXT': 'foreign'}), patch.object(runner, 'capture', side_effect=AssertionError('unexpected docker command')):
            with self.assertRaises(runner.Blocked): runner.host_identity()
        self.assertEqual(runner.phase_environment({'socket': '/assigned/docker.sock'}, '/node/bin/node')['DOCKER_HOST'], 'unix:///assigned/docker.sock')

    def test_pinned_docker_selector_survives_nested_consumer_environment(self):
        common = Path(__file__).parent / 'lib/common.sh'
        with tempfile.TemporaryDirectory() as directory:
            script = r'''
                set -eu
                . "$1"
                mkdir -p "$SIM_HOME/env"
                node() { if [[ "$*" == *--env-values* ]]; then printf 'T3_MODE=test\0'; else printf '/usr/bin/node'; fi; }
                t3_load_env
                "${T3_EXEC_ENV[@]}" sh -c 'test "$DOCKER_HOST" = unix:///synthetic/docker.sock'
            '''
            result = subprocess.run(['bash', '-c', script, 'test', str(common.resolve())],
                                    env={**os.environ, 'SIM_HOME': directory, 'DOCKER_HOST': 'unix:///synthetic/docker.sock'},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_changed_ignored_dependency_input_is_rejected_at_recheck(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'node_modules/next').mkdir(parents=True)
            (root / 'package-lock.json').write_text('{"packages":{"node_modules/next":{"version":"synthetic"}}}')
            (root / 'node_modules/.package-lock.json').write_text('{}')
            (root / 'node_modules/next/package.json').write_text('{"version":"synthetic"}')
            plan = {'dependencyLockSha256': runner.sha((root / 'package-lock.json').read_bytes()),
                    'nodeModulesLockSha256': runner.sha((root / 'node_modules/.package-lock.json').read_bytes())}
            runner.dependencies(root, plan)
            (root / 'node_modules/.package-lock.json').write_text('changed')
            with self.assertRaises(runner.Blocked): runner.dependencies(root, plan)

    def test_missing_plan_cannot_reach_command_or_producer(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'plan.json'
            file.write_text('{}')
            file.chmod(0o600)
            with patch.object(runner, 'capture', side_effect=AssertionError('unexpected command')):
                with self.assertRaises(runner.Blocked): runner.Packet(str(file))

    def test_consumer_rejects_changed_host_receipt_replay_or_duplicate_phase(self):
        node = os.environ.get('T3_TEST_NODE', 'node')
        module = Path(__file__).parent / 'lib/seed-cli.mjs'
        code = r'''
          import {createHash} from 'node:crypto';
          const {verifyPreparation: verify} = await import(process.argv[1]);
          const hash = x => createHash('sha256').update(x).digest('hex');
          const host = {bootId:'boot',daemonId:'daemon',driver:'overlay2',dockerRootDir:'/docker',socket:'/socket',socketDev:1,socketInode:2};
          const replay = Buffer.from('synthetic-replay');
          const good = {schema:'track3-preparation-run-v1',planSha256:'a'.repeat(64),appCommit:'app',harnessCommit:'harness',host,
            events:['backend','replay','build'].map(phase=>({phase,state:'COMPLETED'})),replayReceiptSha256:hash(replay)};
          const check = (receipt, actualHost=host, replayBytes=replay, tamperHash=false) => {
            const bytes=Buffer.from(JSON.stringify(receipt));
            verify({harnessCommit:'harness',preparationRunSha256:tamperHash?'0'.repeat(64):hash(bytes)},bytes,actualHost,'app',{harnessCommit:'harness'},replayBytes);
          };
          check(good);
          for(const mode of ['host','missing','duplicate','app','replay','hash']) {
            const r=structuredClone(good);let blocked=false;
            if(mode==='missing')r.events.pop();
            if(mode==='duplicate')r.events.push(r.events[0]);
            if(mode==='app')r.appCommit='foreign';
            try {check(r,mode==='host'?{...host,socketInode:3}:host,mode==='replay'?Buffer.from('changed'):replay,mode==='hash');}
            catch {blocked=true;}
            if(!blocked)throw Error('not rejected: '+mode);
          }
        '''
        result = subprocess.run([node, '--input-type=module', '-e', code, module.resolve().as_uri()], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_replay_rejects_external_mode_changed_source_or_unbound_log(self):
        good = {'schema': 'track3-canonical-replay-v1', 'kind': 'canonical_supabase_cli',
                'officialLedgerVerified': True, 'postReplayAppliedMigrations': 0,
                'planSha256': 'p', 'appCommit': 'a', 'appTree': 't', 'replayCommit': 'a', 'logSha256': 'l'}
        runner.validate_replay(good, 'p', 'a', 't', 'l')
        for key, value in [('kind', 'external_db_no_ledger'), ('appCommit', 'foreign'),
                           ('planSha256', 'foreign'), ('logSha256', 'changed'), ('officialLedgerVerified', False),
                           ('postReplayAppliedMigrations', 1), ('postReplayAppliedMigrations', False)]:
            with self.subTest(key=key, value=value), self.assertRaises(runner.Blocked):
                runner.validate_replay({**good, key: value}, 'p', 'a', 't', 'l')

    def test_environment_stops_missing_secrets_foreign_ports_or_unsafe_keys(self):
        ports = {'app': 3103, 'api': 54321, 'db': 54322, 'smtp': 3125, 'imapTls': 3993, 'imapPlain': 3143, 'control': 3199}
        home = Path('/synthetic-private')
        good = {key: 'synthetic' for key in ['EDIEL_CRON_SECRET', 'EDIEL_INBOUND_CRON_SECRET',
                'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'EDIEL_SMTP_PASS', 'T3_IMAP_PASS', 'T3_IMAP_USER']}
        good.update(T3_MODE='test', T3_SIM_HOME=str(home), T3_DB_URL='postgresql://synthetic@127.0.0.1:54322/postgres',
                    NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321', T3_APP_URL='http://127.0.0.1:3103',
                    EDIEL_SMTP_HOST='127.0.0.1', EDIEL_IMAP_HOST='127.0.0.1', EDIEL_SMTP_PORT='3125', EDIEL_IMAP_PORT='3993',
                    EDIEL_SMTP_SECURE='true', EDIEL_EMAIL_PROVIDER='strato', EDIEL_IMAP_PASS='synthetic',
                    T3_MAILBOX_ADDRESS='ediel@t3.sim.invalid', EDIEL_SMTP_USER='ediel@t3.sim.invalid', EDIEL_IMAP_USER='synthetic',
                    NODE_EXTRA_CA_CERTS=str(home / 'ca/ca.pem'))
        for port, key in {'app': 'T3_APP_PORT', 'smtp': 'T3_SMTP_PORT', 'imapTls': 'T3_IMAP_TLS_PORT', 'imapPlain': 'T3_IMAP_PLAIN_PORT', 'control': 'T3_CONTROL_PORT'}.items():
            good[key] = str(ports[port])
        runner.validate_environment(good, home, ports)
        for key, value in [('EDIEL_CRON_SECRET', ''), ('EDIEL_INBOUND_CRON_SECRET', ''), ('T3_E01_N', '27'),
                           ('T3_DB_URL', 'postgresql://synthetic@127.0.0.1:54323/postgres'), ('NODE_OPTIONS', '--synthetic'),
                           ('EDIEL_SMTP_SECURE', 'false'), ('T3_IMAP_PLAIN_PORT', '9999')]:
            with self.subTest(key=key), self.assertRaises(runner.Blocked):
                runner.validate_environment({**good, key: value}, home, ports)

    def test_evidence_manifest_rejects_modified_bytes_and_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'observations.json'
            file.write_bytes(b'{}')
            file.chmod(0o600)
            manifest = root / 'MANIFEST.sha256'
            manifest.write_text(runner.sha(b'{}') + '  observations.json\n')
            manifest.chmod(0o600)
            runner.verify_manifest(manifest, root)
            file.write_bytes(b'changed')
            with self.assertRaises(runner.Blocked): runner.verify_manifest(manifest, root)
            manifest.write_text(runner.sha(b'{}') + '  ../escape\n')
            with self.assertRaises(runner.Blocked): runner.verify_manifest(manifest, root)

    def test_capacity_uses_actual_driver_specific_floor(self):
        for driver, floor in [('vfs', 40), ('overlay2', 15), ('overlayfs', 15)]:
            with self.subTest(driver=driver):
                runner.capacity(driver, 8 * 2**30, floor * 2**30)
                with self.assertRaises(runner.Blocked):
                    runner.capacity(driver, 8 * 2**30, floor * 2**30 - 1)

    def test_unknown_driver_and_low_effective_ram_are_held(self):
        for driver, ram in [('unknown', 99 * 2**30), ('overlay2', 8 * 2**30 - 1)]:
            with self.assertRaises(runner.Blocked):
                runner.capacity(driver, ram, 99 * 2**30)

    def test_report_requires_all_seventeen_observed_scenarios(self):
        report = {'exit': 0, 'scenarios': [{'exit': 0, 'harnessError': None,
            'vitest': {'success': True, 'numTotalTests': 17, 'numPassedTests': 17, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0},
            'identity': {'assignmentSha256': 'a' * 64}, 'evidenceManifest': '/private/manifest',
            'steps': [{'scenarioId': value, 'status': 'passed'} for value in runner.SCENARIO_IDS]}]}
        runner.validate_report(report, 'a' * 64)
        for change in ['missing', 'skipped', 'harness', 'empty', 'foreign']:
            bad = copy.deepcopy(report)
            item = bad['scenarios'][0]
            if change == 'missing': item['steps'].pop()
            if change == 'skipped': item['steps'][0]['status'] = 'skipped'
            if change == 'harness': item['harnessError'] = 'missing Vitest JSON'
            if change == 'empty': item['vitest']['numTotalTests'] = 0
            if change == 'foreign': item['identity']['assignmentSha256'] = 'b' * 64
            with self.subTest(change=change), self.assertRaises(runner.Blocked):
                runner.validate_report(bad, 'a' * 64)

    def test_phase_order_cleanup_and_no_retry(self):
        for failure in [None, 'backend', 'replay', 'build', 'up', 'run', 'down', 'cleanup']:
            calls = []
            def phase(name):
                calls.append(name)
                if name == failure: raise runner.Blocked('synthetic_failure')
            result = runner.sequence(phase)
            self.assertEqual(calls.count('backend'), 1)
            self.assertEqual(calls.count('cleanup'), 0 if failure == 'down' else 1)
            self.assertEqual(result['ok'], failure is None)
            if failure in ['up', 'run', 'down']:
                self.assertIn('down', calls)
            if failure in ['backend', 'replay', 'build']:
                self.assertNotIn('up', calls)
            if failure == 'up': self.assertNotIn('run', calls)
            if failure is None:
                self.assertEqual(calls, ['backend', 'replay', 'build', 'seal', 'up', 'run', 'down', 'cleanup'])

    def test_failed_app_cleanup_preserves_backend(self):
        calls = []
        def phase(name):
            calls.append(name)
            if name == 'down': raise runner.Blocked('unknown_app_birth')
        result = runner.sequence(phase)
        self.assertFalse(result['ok'])
        self.assertNotIn('cleanup', calls)
        self.assertEqual(result['cleanup'], 'HOLD_UNKNOWN_APP_MAIL')


class CgroupCapacityTests(unittest.TestCase):
    """Actual host_identity, finite kernel/Docker ports; no daemon/socket use."""
    def fixture(self):
        root = '/sys/fs/cgroup'
        files = {'/proc/self/cgroup': '0::/jobs/build\n',
            '/proc/self/mountinfo': '22 1 0:4 / /proc rw - proc proc rw\n29 1 0:29 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
            '/proc/sys/kernel/random/boot_id': 'synthetic-boot'}
        for node in ['', '/jobs', '/jobs/build']:
            files[root + node + '/cgroup.controllers'] = 'cpu memory'
            files[root + node + '/cgroup.subtree_control'] = 'cpu memory' if node != '/jobs/build' else ''
            files[root + node + '/cgroup.type'] = 'domain'
            if node:
                files[root + node + '/memory.max'] = str((4 if node == '/jobs' else 16) * 2**30)
                files[root + node + '/cpu.max'] = '100000 100000' if node == '/jobs' else 'max 100000'
        return files

    def host(self, files, initial=True, enforce=False, anchor_port=None, backend=None, cleanup=False):
        with tempfile.TemporaryDirectory() as directory:
            socket = Path(directory) / 'socket'; socket.touch()
            def read(path, *_args, **_kwargs):
                if str(path) not in files: raise FileNotFoundError(str(path))
                value = files[str(path)]
                if isinstance(value, BaseException): raise value
                if callable(value): return value()
                return value
            def directory_port(path, *_args):
                if not any(key.startswith(str(path).rstrip('/') + '/') for key in files): raise FileNotFoundError(str(path))
            def backend_port(sock, meta, info, include_capacity):
                shared = 8 * 2**30 if backend is None else backend
                identity = {'state': 'VERIFIED', 'binding': {'socket': {'path': str(sock), 'filesystem': {'device': meta.st_dev, 'inode': meta.st_ino}},
                    'process': {'pid':100,'startTicks':123,'namespaces':{'mnt':'finite-mnt','pid':'finite-pid','net':'finite-net'}},
                    'docker':{'id':info['ID'],'rootDir':info['DockerRootDir'],'driver':info['Driver'],'serverVersion':'28.5.2','cgroupDriver':'cgroupfs'},
                    'configuration':{'parentSetting':'/backend','cgroupDriver':'cgroupfs'}}}
                capacity = {'schema':'gridex-t2-shared-backend-capacity-v1','state':'VERIFIED' if shared is not None and shared>=8*2**30 else 'UNKNOWN_HOLD',
                    'backend':{'globalParent':'/backend','effectiveRAMBytes':shared},'errors':[] if shared is not None and shared>=8*2**30 else ['shared-backend-ram-below-minimum']}
                return {'identity':identity,'capacity':capacity if include_capacity else None}
            @contextmanager
            def namespace_port():
                if not initial: raise runner.Blocked('initial_cgroup_namespace_unproven')
                yield {'kernelRelease': '6.11.0-synthetic', 'inode': 4026531835, 'namespaceType': 0x02000000, 'namespaceFsMagic': 0x6e736673}
            with patch.dict(os.environ, {'DOCKER_HOST': 'unix://' + str(socket)}, clear=True), \
                 patch.object(runner, 'docker_socket', return_value=socket), patch.object(runner, 'canonical', side_effect=lambda x: Path(x)), \
                 patch.object(runner, 'capture', return_value=json.dumps({'DockerRootDir': '/synthetic/docker', 'Driver': 'overlay2', 'ID': 'synthetic-daemon'})), \
                 patch.object(runner.os, 'statvfs', return_value=SimpleNamespace(f_bavail=100 * 2**30, f_frsize=1)), \
                 patch.object(runner.os, 'sysconf', side_effect=lambda key: 4096 if key == 'SC_PAGE_SIZE' else 8 * 2**20), \
                 patch.object(Path, 'read_text', read), patch.object(Path, 'is_file', side_effect=lambda: False), \
                 patch.object(runner, '_kernel_text', side_effect=read, create=True), \
                 patch.object(runner, '_kernel_directory', side_effect=directory_port, create=True), \
                 patch.object(runner, 'cgroup_namespace_anchor', side_effect=namespace_port if anchor_port is None else anchor_port, create=True), \
                 patch.object(runner, 'backend_observation', side_effect=backend_port, create=True):
                return runner.host_identity(enforce_capacity=enforce, observe_backend=not cleanup)

    def test_actual_host_identity_must_include_lower_parent_not_only_visible_root(self):
        host = self.host(self.fixture())
        self.assertEqual(host['effectiveRamBytes'], 4 * 2**30)

    def test_actual_lower_ancestor_stops_admission(self):
        with self.assertRaises(runner.Blocked): self.host(self.fixture(), enforce=True)

    def test_known_zero_memory_limit_is_underfloor_not_fabricated_unlimited(self):
        files = self.fixture(); files['/sys/fs/cgroup/jobs/memory.max'] = '0'
        host = self.host(files)
        self.assertEqual(host['effectiveRamBytes'], 0)
        self.assertEqual(host['capacityStatus'], 'QUALIFIED')
        with self.assertRaises(runner.Blocked): self.host(files, enforce=True)

    def test_noninitial_namespace_unknown_still_allows_cleanup_identity_observation(self):
        host = self.host(self.fixture(), initial=False)
        self.assertIsNone(host['effectiveRamBytes'])
        self.assertEqual(host['daemonId'], 'synthetic-daemon')
        with self.assertRaises(runner.Blocked): self.host(self.fixture(), initial=False, enforce=True)

    def test_initial_global_vm_positive_uses_full_ancestor_minimum_and_cpu_quota(self):
        files = self.fixture()
        files['/sys/fs/cgroup/jobs/memory.max'] = str(12 * 2**30)
        files['/sys/fs/cgroup/jobs/build/memory.max'] = str(16 * 2**30)
        files['/sys/fs/cgroup/jobs/cpu.max'] = '50000 100000'
        host = self.host(files, enforce=True)
        self.assertEqual(host['capacityStatus'], 'QUALIFIED')
        self.assertEqual(host['effectiveRamBytes'], 12 * 2**30)
        self.assertEqual(host['capacityObservation']['cpuQuotaCores'], .5)
        self.assertEqual(len(host['capacityObservation']['memoryLimits']), 2)

    def test_proven_global_root_exemption_is_not_missing_hidden_ancestor(self):
        files = self.fixture(); files['/proc/self/cgroup'] = '0::/\n'
        host = self.host(files, enforce=True)
        self.assertEqual(host['effectiveRamBytes'], 32 * 2**30)
        self.assertEqual(host['capacityObservation']['memoryLimits'], [])
        self.assertIsNone(host['capacityObservation']['cpuQuotaCores'])

    def test_documented_disabled_child_controllers_need_actual_parent_inventory(self):
        files = self.fixture()
        files['/sys/fs/cgroup/jobs/cgroup.subtree_control'] = ''
        files['/sys/fs/cgroup/jobs/build/cgroup.controllers'] = ''
        del files['/sys/fs/cgroup/jobs/build/memory.max']; del files['/sys/fs/cgroup/jobs/build/cpu.max']
        host = self.host(files)
        self.assertEqual(host['effectiveRamBytes'], 4 * 2**30)
        files['/sys/fs/cgroup/jobs/cgroup.subtree_control'] = 'memory cpu'
        self.assertIsNone(self.host(files)['effectiveRamBytes'])

    def test_subroot_overmount_unreadable_or_missing_ancestor_never_qualifies(self):
        variants = []
        files = self.fixture(); files['/proc/self/mountinfo'] = files['/proc/self/mountinfo'].replace('0:29 / /sys/fs/cgroup', '0:29 /hidden /sys/fs/cgroup'); variants.append(files)
        files = self.fixture(); files['/proc/self/mountinfo'] += '30 29 0:30 / /sys/fs/cgroup/jobs rw - cgroup2 cgroup rw\n'; variants.append(files)
        files = self.fixture(); del files['/sys/fs/cgroup/jobs/build/memory.max']; variants.append(files)
        files = self.fixture(); files['/sys/fs/cgroup/jobs/memory.max'] = PermissionError('finite unreadable ancestor'); variants.append(files)
        files = self.fixture(); files = {k: v for k, v in files.items() if not k.startswith('/sys/fs/cgroup/jobs/build/')}; variants.append(files)
        for files in variants:
            with self.subTest(files=files):
                host = self.host(files)
                self.assertEqual(host['capacityStatus'], 'UNKNOWN')
                self.assertIsNone(host['effectiveRamBytes'])
                with self.assertRaises(runner.Blocked): self.host(files, enforce=True)

    def test_membership_or_constraint_changes_cannot_splice_a_qualified_snapshot(self):
        for which in ['membership', 'limit']:
            files, count = self.fixture(), [0]
            def changing():
                count[0] += 1
                if which == 'membership': return '0::/jobs/build\n' if count[0] == 1 else '0::/other\n'
                return str((16 if count[0] == 1 else 4) * 2**30)
            files['/proc/self/cgroup' if which == 'membership' else '/sys/fs/cgroup/jobs/memory.max'] = changing
            with self.subTest(which=which): self.assertIsNone(self.host(files)['effectiveRamBytes'])

    def test_v1_global_memory_and_cpu_hierarchies_include_every_parent(self):
        files = {'/proc/self/cgroup': '3:memory:/tenant/worker\n4:cpu,cpuacct:/tenant/worker\n',
            '/proc/self/mountinfo': '22 1 0:4 / /proc rw - proc proc rw\n31 1 0:31 / /sys/fs/cgroup/memory rw - cgroup memory rw,memory\n32 1 0:32 / /sys/fs/cgroup/cpu rw - cgroup cpu rw,cpu,cpuacct\n',
            '/proc/sys/kernel/random/boot_id': 'synthetic-boot'}
        for node in ['', '/tenant', '/tenant/worker']:
            memory = '/sys/fs/cgroup/memory' + node
            files[memory + '/memory.use_hierarchy'] = '1'
            files[memory + '/memory.limit_in_bytes'] = str((32 if not node else 12 if node == '/tenant' else 16) * 2**30)
            cpu = '/sys/fs/cgroup/cpu' + node
            files[cpu + '/cpu.cfs_quota_us'] = '-1' if not node else '50000'
            files[cpu + '/cpu.cfs_period_us'] = '100000'
        host = self.host(files, enforce=True)
        self.assertEqual(host['effectiveRamBytes'], 12 * 2**30)
        self.assertEqual(host['capacityObservation']['cpuQuotaCores'], .5)
        del files['/sys/fs/cgroup/memory/tenant/memory.limit_in_bytes']
        self.assertIsNone(self.host(files)['effectiveRamBytes'])


class NamespaceKernelFDTests(unittest.TestCase):
    def test_initial_namespace_needs_nsfs_ioctl_reserved_inode_and_pinned_handle(self):
        for mode in ['ok', 'other-inode', 'wrong-fs', 'wrong-type', 'not-proc', 'not-link', 'wrong-self', 'unknown-kernel']:
            closed = []
            inode = 4026531835 if mode != 'other-inode' else 4026533000
            def readlink(path):
                if path == '/proc/self': return str(os.getpid()) if mode != 'wrong-self' else '1'
                return 'cgroup:[' + str(inode) + ']'
            def magic(fd):
                if fd == 11: return runner.PROCFS_MAGIC if mode != 'not-proc' else 123
                return runner.NSFS_MAGIC if mode != 'wrong-fs' else runner.PROCFS_MAGIC
            with self.subTest(mode=mode), patch.object(runner.os, 'uname', return_value=SimpleNamespace(release='6.11.0-synthetic' if mode != 'unknown-kernel' else '99.0.0-synthetic')), \
                 patch.object(runner.os, 'readlink', side_effect=readlink), patch.object(runner.os, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFLNK if mode != 'not-link' else stat.S_IFREG)), \
                 patch.object(runner.os, 'open', side_effect=[11, 22]), patch.object(runner.os, 'close', side_effect=closed.append), \
                 patch.object(runner.os, 'fstat', return_value=SimpleNamespace(st_ino=inode)), patch.object(runner, '_fd_fs_magic', side_effect=magic), \
                 patch.object(runner.fcntl, 'ioctl', return_value=runner.CLONE_NEWCGROUP if mode != 'wrong-type' else 0):
                if mode == 'ok':
                    with runner.cgroup_namespace_anchor() as proof:
                        self.assertEqual(proof['inode'], 4026531835)
                        self.assertIn(11, closed); self.assertNotIn(22, closed)
                    self.assertEqual(closed, [11, 22])
                else:
                    with self.assertRaises(runner.Blocked):
                        with runner.cgroup_namespace_anchor(): self.fail('must never qualify')

    def test_regular_file_with_limit_shaped_bytes_is_not_kernel_capacity_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'memory.max'; file.write_text('34359738368')
            with self.assertRaises(runner.Blocked): runner._kernel_text(str(file), runner.CGROUP2_MAGIC)

    def test_kernel_short_reads_are_joined_until_eof_on_the_same_checked_fd(self):
        chunks = [b'first complete record\n', b'second record\n', b'']
        closed, reads = [], []
        def read(fd, size):
            reads.append((fd, size)); return chunks.pop(0)
        with patch.object(runner.os, 'open', return_value=22), patch.object(runner.os, 'close', side_effect=closed.append), \
             patch.object(runner.os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG)), \
             patch.object(runner, '_fd_fs_magic', return_value=runner.PROCFS_MAGIC), patch.object(runner.os, 'read', side_effect=read):
            self.assertEqual(runner._kernel_text('/proc/synthetic', runner.PROCFS_MAGIC), 'first complete record\nsecond record\n')
        self.assertEqual(len(reads), 3)
        self.assertTrue(all(fd == 22 for fd, _ in reads))
        self.assertEqual(closed, [22])

    def test_kernel_aggregate_overflow_is_rejected_instead_of_using_valid_prefix(self):
        closed = []
        with patch.object(runner.os, 'open', return_value=22), patch.object(runner.os, 'close', side_effect=closed.append), \
             patch.object(runner.os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG)), \
             patch.object(runner, '_fd_fs_magic', return_value=runner.PROCFS_MAGIC), \
             patch.object(runner.os, 'read', side_effect=[b'x' * 65536] * 16 + [b'x']):
            with self.assertRaisesRegex(runner.Blocked, 'kernel_interface_too_large'):
                runner._kernel_text('/proc/synthetic', runner.PROCFS_MAGIC)
        self.assertEqual(closed, [22])

    def test_short_mount_prefix_cannot_hide_a_later_complete_overmount_record(self):
        initial = '22 1 0:4 / /proc rw - proc proc rw\n29 1 0:29 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n'
        suffix = '30 29 0:30 / /sys/fs/cgroup/jobs rw - cgroup2 cgroup rw\n'
        chunks = [initial.encode(), suffix.encode(), b'']
        with patch.object(runner.os, 'open', return_value=22), patch.object(runner.os, 'close'), \
             patch.object(runner.os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG)), \
             patch.object(runner, '_fd_fs_magic', return_value=runner.PROCFS_MAGIC), patch.object(runner.os, 'read', side_effect=chunks):
            complete = runner._kernel_text('/proc/self/mountinfo', runner.PROCFS_MAGIC)
        files = CgroupCapacityTests().fixture(); files['/proc/self/mountinfo'] = complete
        self.assertIsNone(CgroupCapacityTests().host(files)['effectiveRamBytes'])


class QualifiedKernelFamilyTests(unittest.TestCase):
    release = '6.18.57'  # Finite qualified-source fixture, never actual host proof.

    def host(self, files, mode='ok'):
        original_anchor = runner.cgroup_namespace_anchor
        @contextmanager
        def actual_fd_anchor():
            inode = runner.PROC_CGROUP_INIT_INO if mode != 'other-inode' else runner.PROC_CGROUP_INIT_INO + 1
            def readlink(path):
                if path == '/proc/self':return str(os.getpid()) if mode != 'wrong-self' else '1'
                return 'cgroup:[' + str(inode) + ']'
            def magic(fd):
                if fd == 11:return runner.PROCFS_MAGIC if mode != 'not-proc' else 123
                return runner.NSFS_MAGIC if mode != 'wrong-fs' else runner.PROCFS_MAGIC
            with patch.object(runner.os,'readlink',side_effect=readlink),\
                 patch.object(runner.os,'lstat',return_value=SimpleNamespace(st_mode=stat.S_IFLNK if mode!='not-link' else stat.S_IFREG)),\
                 patch.object(runner.os,'open',side_effect=lambda path,*_:11 if str(path)=='/proc/self/ns' else 22),\
                 patch.object(runner.os,'close'),patch.object(runner.os,'fstat',return_value=SimpleNamespace(st_ino=inode)),\
                 patch.object(runner,'_fd_fs_magic',side_effect=magic),\
                 patch.object(runner.fcntl,'ioctl',return_value=runner.CLONE_NEWCGROUP if mode!='wrong-type' else 0):
                with original_anchor() as proof:yield proof
        with patch.object(runner.os,'uname',return_value=SimpleNamespace(release=self.release)):
            return CgroupCapacityTests().host(files,anchor_port=actual_fd_anchor)

    def positive_files(self):
        files=CgroupCapacityTests().fixture()
        files['/sys/fs/cgroup/jobs/memory.max']=str(12*2**30)
        return files

    def test_qualified_61857_with_actual_fd_contract_and_complete_hierarchy_qualifies(self):
        host=self.host(self.positive_files())
        self.assertEqual(host['capacityStatus'],'QUALIFIED')
        self.assertEqual(host['effectiveRamBytes'],12*2**30)
        self.assertEqual(host['capacityObservation']['kernelRelease'],self.release)
        self.assertEqual(host['capacityObservation']['namespace']['inode'],runner.PROC_CGROUP_INIT_INO)
        self.assertEqual(host['capacityObservation']['namespace']['kernelRelease'],self.release)

    def test_qualified_61857_wrong_fd_contract_remains_unknown(self):
        for mode in ['other-inode','wrong-fs','wrong-type','not-proc','not-link','wrong-self']:
            with self.subTest(mode=mode):
                host=self.host(self.positive_files(),mode)
                self.assertEqual(host['capacityStatus'],'UNKNOWN')
                self.assertIsNone(host['effectiveRamBytes'])
                self.assertEqual(host['capacityObservation']['kernelRelease'],self.release)

    def test_qualified_61857_hidden_mount_missing_ancestor_and_race_remain_unknown(self):
        variants=[]
        files=self.positive_files();files['/proc/self/mountinfo']+='30 29 0:30 / /sys/fs/cgroup/jobs rw - cgroup2 cgroup rw\n';variants.append(files)
        files=self.positive_files();del files['/sys/fs/cgroup/jobs/memory.max'];variants.append(files)
        files=self.positive_files();count=[0]
        def changing():
            count[0]+=1
            return '0::/jobs/build\n' if count[0]==1 else '0::/different\n'
        files['/proc/self/cgroup']=changing;variants.append(files)
        for number,files in enumerate(variants):
            with self.subTest(variant=number):
                host=self.host(files)
                self.assertEqual(host['capacityStatus'],'UNKNOWN')
                self.assertIsNone(host['effectiveRamBytes'])
                self.assertEqual(host['capacityObservation']['kernelRelease'],self.release)

    def test_linux64_fd_abi_guard_is_still_mandatory(self):
        with patch.object(runner.sys,'platform','not-linux'),self.assertRaises(runner.Blocked):runner._fd_fs_magic(123)
        with patch.object(runner.ctypes,'sizeof',return_value=4),self.assertRaises(runner.Blocked):runner._fd_fs_magic(123)



    def test_outside_qualified_families_or_malformed_release_remains_unknown(self):
        for release in ['7.1.0', '7.99.0', '8.0.0', '7.0', '7.0.garbage', '07.0.0', '99.0.0', '6.19.0', '6.7.0', '6.18', '6.18.garbage', '06.18.57', '6.018.57', '6.18.57trailing', 'not-a-kernel-release']:
            with self.subTest(release=release):
                self.release=release
                host=self.host(self.positive_files())
                self.assertEqual(host['capacityStatus'],'UNKNOWN')
                self.assertIsNone(host['effectiveRamBytes'])
                self.assertEqual(host['capacityObservation']['kernelRelease'],release)
                self.assertEqual(host['capacityObservation']['reason'],'unqualified_kernel_namespace_contract')

    def test_only_eleven_source_qualified_families_have_positive_fd_contract_path(self):
        for minor in range(8,19):
            with self.subTest(minor=minor):
                self.release=f'6.{minor}.0-source-qualified-finite-fixture'
                host=self.host(self.positive_files())
                self.assertEqual(host['capacityStatus'],'QUALIFIED')
                self.assertEqual(host['effectiveRamBytes'],12*2**30)
                self.assertEqual(host['capacityObservation']['kernelRelease'],self.release)


    def test_actual_observed_700_azure_label_has_positive_real_fd_contract_path(self):
        # Exact observed family/label is a finite test input, not host/RAM proof.
        self.release='7.0.0-1017-azure'
        self.test_qualified_61857_with_actual_fd_contract_and_complete_hierarchy_qualifies()

    def test_same_700_azure_label_wrong_fd_and_ancestry_still_hold(self):
        self.release='7.0.0-1017-azure'
        self.test_qualified_61857_wrong_fd_contract_remains_unknown()
        self.test_qualified_61857_hidden_mount_missing_ancestor_and_race_remain_unknown()


class SharedBackendIntegrationTests(unittest.TestCase):
    def files(self):
        files=CgroupCapacityTests().fixture()
        files['/sys/fs/cgroup/jobs/memory.max']=str(16*2**30)
        return files

    def test_actual_worker16_shared2_must_not_admit(self):
        with self.assertRaises(runner.Blocked):
            CgroupCapacityTests().host(self.files(),enforce=True,backend=2*2**30)

    def test_cleanup_low_or_unknown_worker_and_parent_ram_keeps_same_identity(self):
        for status in ['low','unknown']:
            before=CgroupCapacityTests().host(self.files(),enforce=True)
            files=self.files();files['/sys/fs/cgroup/jobs/memory.max']='1' if status=='low' else 'unreadable'
            after=CgroupCapacityTests().host(files,enforce=False,backend=1,cleanup=True)
            for key in ['bootId','daemonId','driver','dockerRootDir','socket','socketDev','socketInode']:
                after[key]=before[key]
            if 'backendIdentity' in before:
                after['backendIdentity']=copy.deepcopy(before['backendIdentity'])
            runner.same_host(before,after)

    def test_cleanup_changed_real_dockerd_birth_cannot_use_old_socket_identity(self):
        before=CgroupCapacityTests().host(self.files(),enforce=True)
        after=copy.deepcopy(before)
        # Old efac ignores this actual dockerd identity entirely.
        before['backendIdentity']={'state':'VERIFIED','binding':{'process':{'pid':100,'startTicks':123}}}
        after['backendIdentity']={'state':'VERIFIED','binding':{'process':{'pid':100,'startTicks':124}}}
        with self.assertRaises(runner.Blocked):runner.same_host(before,after)


class PrivilegedBackendRecipeTests(unittest.TestCase):
    def setUp(self):
        import builtins
        self.original_exec=builtins.exec
        spec=importlib.util.spec_from_file_location('exact_donor_tests',Path(__file__).with_name('host-capacity.test.py'))
        self.donor_tests=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.donor_tests)
        self.k=self.donor_tests.Kernel()
        helper=Path(__file__).with_name('host-capacity.py')
        self.k.files[str(helper)]=helper.read_text()
        self.k.install(self)

    def recipe(self, mode, request=None):
        import contextlib,io,sys
        def exact_source_with_finite_ports(code, namespace):
            self.original_exec(code,namespace)
            namespace.update(text=self.k.read,binary=self.k.bytes,metadata=self.k.meta,names=self.k.names,link=self.k.link,
                socket_info=lambda:(copy.deepcopy(self.k.info),dict(self.k.peer)),
                container_inspect=lambda cid:copy.deepcopy(self.k.inspects[cid]))
        stdout=io.StringIO()
        with patch.object(sys,'argv',['-c',str(Path(__file__).with_name('host-capacity.py')),mode,runner.BACKEND_HELPER_SHA256]),\
             patch.object(sys,'stdin',SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode()))),contextlib.redirect_stdout(stdout):
            self.original_exec(runner.BACKEND_OBSERVER,{'exec':exact_source_with_finite_ports})
        return json.loads(stdout.getvalue())

    def test_actual_cleanup_recipe_ignores_unknown_and_low_ram_without_reading_it(self):
        for value in ['unreadable',str(2*2**30)]:
            self.k.files[self.donor_tests.c.ROOT+'/backend/memory.max']=value
            self.k.reads.clear()
            result=self.recipe('identity')
            self.assertEqual(result['identity']['state'],'VERIFIED',result)
            self.assertIsNone(result['capacity'])
            self.assertFalse(any(path.endswith(('/memory.max','/cpu.max')) for path in self.k.reads))
            binding=runner.backend_binding(result['identity'])
            self.assertEqual(binding['process']['pid'],100)
            self.assertNotIn('memTotalBytes',binding['docker'])
            self.assertNotIn('effectiveRAMBytes',binding['process'])

    def test_actual_full_recipe_worker_unrelated_shared2_is_unknown_with_identity_retained(self):
        self.k.files[self.donor_tests.c.ROOT+'/backend/memory.max']=str(2*2**30)
        result=self.recipe('observe')
        self.assertEqual(result['identity']['state'],'VERIFIED')
        self.assertEqual(result['capacity']['state'],'UNKNOWN_HOLD')
        self.assertEqual(result['capacity']['backend']['effectiveRAMBytes'],2*2**30)
        self.assertIn('shared-backend-ram-below-minimum',result['capacity']['errors'])

    def test_actual_full_recipe_shared8_daemon_leaf2_is_positive_and_same_binding(self):
        self.k.files[self.donor_tests.c.ROOT+'/backend/docker.service/memory.max']=str(2*2**30)
        result=self.recipe('observe')
        self.assertEqual(result['capacity']['state'],'VERIFIED',result)
        self.assertEqual(result['capacity']['process']['effectiveRAMBytes'],2*2**30)
        self.assertEqual(runner.backend_binding(result['identity']),runner.backend_binding(result['capacity']))

    def test_actual_sudo_boundary_is_source_pinned_isolated_and_has_no_fallback(self):
        calls=[]
        def finite(argv,**kwargs):
            calls.append((argv,kwargs));return SimpleNamespace(returncode=0,stdout=json.dumps(self.recipe('identity')).encode())
        with patch.object(runner.subprocess,'run',side_effect=finite):
            result=runner.backend_call('identity')
        self.assertEqual(result['identity']['state'],'VERIFIED')
        argv,kwargs=calls[0]
        self.assertEqual(argv[:6],['sudo','-n','python3','-I','-B','-c'])
        self.assertEqual(kwargs['env'],{'PATH':'/usr/local/bin:/usr/bin:/bin'})
        self.assertEqual(argv[-2],'identity')
        self.assertEqual(argv[-1],runner.BACKEND_HELPER_SHA256)
        with patch.object(runner.subprocess,'run',side_effect=PermissionError('FINITE_PRIVATE_DETAIL')):
            result=runner.backend_call('observe')
        self.assertEqual(result['state'],'UNKNOWN_HOLD')
        self.assertNotIn('FINITE_PRIVATE_DETAIL',json.dumps(result))

    def test_actual_selected_socket_and_info_must_match_privileged_listener(self):
        observed=self.recipe('observe');meta=self.k.meta('/run/docker.sock')
        info={'ID':self.k.info['ID'],'Driver':self.k.info['Driver'],'DockerRootDir':self.k.info['DockerRootDir']}
        with patch.object(runner,'backend_call',return_value=observed),patch.object(runner.os,'readlink',side_effect=self.k.link):
            good=runner.backend_observation(Path('/run/docker.sock'),SimpleNamespace(st_dev=meta['device'],st_ino=meta['inode']),info,True)
            wrong=runner.backend_observation(Path('/run/docker.sock'),SimpleNamespace(st_dev=meta['device'],st_ino=meta['inode']+1),info,True)
            other=runner.backend_observation(Path('/run/other.sock'),SimpleNamespace(st_dev=meta['device'],st_ino=meta['inode']),info,True)
        self.assertEqual(good['identity']['state'],'VERIFIED')
        self.assertEqual(wrong['identity']['state'],'UNKNOWN_HOLD')
        self.assertEqual(other['identity']['state'],'UNKNOWN_HOLD')
        with patch.object(runner,'backend_call',return_value=observed),patch.object(runner.os,'readlink',
             side_effect=lambda path:'mnt:[999]' if path.endswith('/mnt') else self.k.link(path)):
            mismatch=runner.backend_observation(Path('/run/docker.sock'),SimpleNamespace(st_dev=meta['device'],st_ino=meta['inode']),info,True)
        self.assertEqual(mismatch['identity']['state'],'UNKNOWN_HOLD')

    def test_actual_container_collector_binds_birth_project_parent_and_keeps_leaf2(self):
        observed=self.recipe('observe');cid='a'*64;project='sim-t2-unit';path='/backend/docker/'+cid
        self.k.process(500,'java',path,1001);self.k.directories.add(self.donor_tests.c.ROOT+path)
        self.k.files[self.donor_tests.c.ROOT+path+'/memory.max']=str(2*2**30)
        self.k.files[self.donor_tests.c.ROOT+path+'/cpu.max']='max 100000'
        self.k.inspects[cid]={'Id':cid,'Name':'/owned','Created':'finite-birth','Config':{'Labels':{'com.supabase.cli.project':project}},
            'State':{'Running':True,'Pid':500,'StartedAt':'finite-start'},'HostConfig':{'CgroupParent':''}}
        host={'capacityObservation':{'status':'QUALIFIED'},'driver':'overlay2','effectiveRamBytes':16*2**30,'freeBytes':50*2**30,
              'backendIdentity':{'state':'VERIFIED','binding':runner.backend_binding(observed['identity'])},'backendCapacity':observed['capacity']}
        births=[{'id':cid,'name':'/owned','created':'finite-birth'}]
        with patch.object(runner,'backend_call',side_effect=lambda mode,request=None:self.recipe(mode,request)):
            result=runner.owned_backend_capacity(host,project,births)
            self.assertEqual(result['state'],'VERIFIED')
            self.assertEqual(result['containers'][0]['individualEffectiveRAMBytes'],2*2**30)
            for change in ['birth','parent','membership']:
                if change=='birth':self.k.inspects[cid]['Created']='changed'
                if change=='parent':self.k.inspects[cid]['Created']='finite-birth';self.k.inspects[cid]['HostConfig']['CgroupParent']='/foreign'
                if change=='membership':self.k.inspects[cid]['HostConfig']['CgroupParent']='';self.k.files['/proc/500/cgroup']='0::/foreign/'+cid
                with self.subTest(change=change),self.assertRaises(runner.Blocked):runner.owned_backend_capacity(host,project,births)



class OwnedBackendFreshTests(unittest.TestCase):
    def packet(self, root):
        home=root/'private';home.mkdir(mode=0o700);(home/'env').mkdir(mode=0o700)
        env=b'{"T3_DB_URL":"FINITE_TEST_ONLY"}'
        (home/'env/track3.json').write_bytes(env);(home/'env/track3.json').chmod(0o600)
        plan={'appCommit':'a'*40,'appTree':'b'*40,'harnessCommit':'a'*40,'harnessTree':'b'*40,
              'reservationRefs':[],'projectId':'t3-finite-only','timeouts':{}}
        original=json.dumps(plan).encode();file=home/'plan.json';file.write_bytes(original);file.chmod(0o600)
        packet=runner.Packet.__new__(runner.Packet)
        packet.file=file;packet.original=original;packet.plan=plan;packet.home=home;packet.app=root;packet.node='/finite/node'
        packet.env={'T3_DB_URL':'FINITE_TEST_ONLY'};packet.env_hash=runner.sha(env);packet.events=[];packet.adapters={};packet.lifecycle_hashes={}
        from datetime import datetime,timedelta,timezone
        packet.expires=datetime.now(timezone.utc)+timedelta(minutes=5)
        packet.host={'bootId':'finite','daemonId':'finite','driver':'overlay2','dockerRootDir':'/finite',
                     'socket':'/run/docker.sock','socketDev':1,'socketInode':2,
                     'backendIdentity':{'state':'VERIFIED','binding':{'finiteActualIdentityPort':True}}}
        packet.backend_containers=[{'id':'a'*64,'name':'/owned','created':'FINITE_ORIGINAL_BIRTH'}]
        return packet

    def test_actual_build_phase_rechecks_original_owned_birth_before_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            packet=self.packet(Path(directory));effects=[];checks=[];packet.execute_command=lambda *args:effects.append(args)
            def held(host,project,births):
                checks.append((project,copy.deepcopy(births)));raise runner.Blocked('owned_backend_parent_unqualified')
            with patch.object(runner,'source'),patch.object(runner,'dependencies'),\
                 patch.object(runner,'host_identity',return_value=packet.host),patch.object(runner,'owned_backend_capacity',side_effect=held):
                with self.assertRaises(runner.Blocked):packet.phase('build')
            self.assertEqual(checks,[('t3-finite-only',packet.backend_containers)])
            self.assertEqual(effects,[])
            self.assertFalse((packet.home/'intent-build.json').exists())

    def test_actual_down_phase_uses_identity_only_not_owned_health(self):
        with tempfile.TemporaryDirectory() as directory:
            packet=self.packet(Path(directory));effects=[];packet.execute_command=lambda *args:effects.append(args)
            (packet.home/'cleanup-assignment.json').write_text('{}')
            after=copy.deepcopy(packet.host);after.update(effectiveRamBytes=None,capacityStatus='UNKNOWN',backendCapacity=None)
            with patch.object(runner,'host_identity',return_value=after) as observer,\
                 patch.object(runner,'owned_backend_capacity',side_effect=AssertionError('cleanup must not require capacity')):
                packet.phase('down')
            observer.assert_called_once_with(enforce_capacity=False)
            self.assertEqual(len(effects),1)
            self.assertEqual(effects[0][0],'down')



if __name__ == '__main__':
    unittest.main()
