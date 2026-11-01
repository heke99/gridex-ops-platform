"""Finite-port runner tests: no Docker, database, build or native acceptance."""
import importlib.util
import unittest
import copy
import tempfile
import subprocess
import os
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


if __name__ == '__main__':
    unittest.main()
