#!/usr/bin/env python3
"""Offline contracts. No sockets, Docker, network, fixtures, replay or build."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
import os
import tempfile
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("qualify", HERE / "qualify-runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.observation = {"driver": "overlay2", "effectiveRAMBytes": 8 * module.GIB,
                            "dockerRootFreeBytes": 15 * module.GIB, "dockerRootDir": "/owned/docker",
                            "rootNamespaceVerified": True, "daemonId": "synthetic-test-daemon",
                            "socketIdentity": {"device": 1, "inode": 2}, "cpuQuota": "400000 100000"}

    def test_exact_capacity_boundaries(self):
        for driver, minimum in module.DRIVERS.items():
            with self.subTest(driver=driver):
                self.observation.update(driver=driver, dockerRootFreeBytes=minimum)
                self.assertEqual(module.capacity_errors(self.observation), [])
                self.observation['dockerRootFreeBytes'] -= 1
                self.assertIn('insufficient-or-unknown-docker-root-free', module.capacity_errors(self.observation))

    def test_unknown_driver_is_hold(self):
        self.observation['driver'] = 'overlay'
        self.assertIn('unknown-driver', module.capacity_errors(self.observation))

    def test_ram_is_effective_and_strict(self):
        for value in [True, None, '8589934592', 8 * module.GIB - 1, float('inf')]:
            with self.subTest(value=value):
                self.observation['effectiveRAMBytes'] = value
                self.assertIn('insufficient-or-unknown-ram', module.capacity_errors(self.observation))

    def test_free_space_is_strict(self):
        for value in [True, None, '20000000000', -1, float('nan')]:
            self.observation['dockerRootFreeBytes'] = value
            self.assertIn('insufficient-or-unknown-docker-root-free', module.capacity_errors(self.observation))

    def test_host_filesystem_is_not_docker_namespace(self):
        self.observation['rootNamespaceVerified'] = False
        self.assertIn('docker-root-namespace-unverified', module.capacity_errors(self.observation))

    def test_required_identity_and_cpu(self):
        for key in ['socketIdentity', 'daemonId', 'cpuQuota']:
            observation = copy.deepcopy(self.observation)
            observation.pop(key)
            self.assertTrue(module.capacity_errors(observation))

    def test_no_argument_admission_is_hold(self):
        result = subprocess.run(['python3', '-B', str(HERE / 'qualify-runtime.py')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(json.loads(result.stdout)['state'], 'HOLD')

class OperationalContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'private'
        self.home.mkdir(mode=0o700)
        self.assignment = self.root / 'admission.json'
        module.save_private(self.assignment, {'synthetic': 'SECRET-MUST-NOT-ESCAPE'})
        self.environment = mock.patch.dict(os.environ, {'SIM_RUNTIME_ASSIGNMENT_FILE': str(self.assignment),
                                                        'SIM_HOME': str(self.home)}, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_private_assignment_rejects_group_access_and_symlink(self):
        self.assignment.chmod(0o640)
        with self.assertRaisesRegex(ValueError, 'private-file-required'):
            module.private_file(self.assignment)
        self.assignment.chmod(0o600)
        link = self.root / 'link'
        link.symlink_to(self.assignment)
        with self.assertRaises(ValueError):
            module.private_file(link)

    def test_exclusive_receipt_never_overwritten(self):
        path = self.home / 'budget.json'
        module.save_private(path, {'startup': 1})
        with self.assertRaises(FileExistsError):
            module.save_private(path, {'startup': 2})
        self.assertEqual(module.load_private(path), {'startup': 1})

    def test_changed_authenticated_ref_stops_before_capsule(self):
        binding = {'ref': 'refs/tags/agent-claims/masterplan/producer-t2-fixture', 'receipt': '1' * 40}
        with mock.patch.object(module, 'command', return_value=json.dumps({'object': {'type': 'commit', 'sha': '2' * 40}})) as command:
            with self.assertRaisesRegex(ValueError, 'reservation-ref-changed'):
                module.verify_binding(binding)
        self.assertEqual(command.call_count, 1)

    def test_full_capsule_and_all_grouped_refs_checked(self):
        binding = {'refs': ['refs/tags/agent-claims/masterplan/file-one', 'refs/tags/agent-claims/masterplan/slot-one'],
                   'receipt': '1' * 40, 'tree': '2' * 40, 'base': '3' * 40, 'body': {'base': '3' * 40, 'files': ['synthetic'], 'operation': 'Synthetic neutral proof'}}
        ref = json.dumps({'object': {'type': 'commit', 'sha': '1' * 40}})
        capsule = json.dumps({'tree': {'sha': '2' * 40}, 'parents': [{'sha': '3' * 40}],
                              'message': json.dumps(binding['body'])})
        with mock.patch.object(module, 'command', side_effect=[ref, ref, capsule, json.dumps({'tree': {'sha': '2' * 40}})]) as command:
            module.verify_binding(binding)
        self.assertEqual(command.call_count, 4)
        changed = json.loads(capsule)
        changed['parents'] = []
        with mock.patch.object(module, 'command', side_effect=[ref, ref, json.dumps(changed), json.dumps({'tree': {'sha': '2' * 40}})]):
            with self.assertRaisesRegex(ValueError, 'reservation-capsule-mismatch'):
                module.verify_binding(binding)

    def test_invalid_signature_fails_before_api_or_resources(self):
        module.save_private(str(self.assignment) + '.sig', {})
        with mock.patch.object(module, 'command', side_effect=subprocess.CalledProcessError(1, ['openssl'])) as command:
            with self.assertRaises(subprocess.CalledProcessError):
                module.authenticate('up')
        self.assertEqual(command.call_count, 1)
        self.assertEqual(command.call_args.args[0][0], 'openssl')

    def test_reused_run_id_refused_before_resource_claims(self):
        module.save_private(str(self.assignment) + '.sig', {})
        a = {'schema': 'gridex-simulation-runtime-assignment-v1', 'worker': 'T2', 'state': 'ACTIVE',
             'allowedOperations': ['up','run','down'], 'expiresAt': '2099-01-01T00:00:00Z', 'cleanupExpiresAt':'2099-01-02T00:00:00Z',
             'scenario': 'scenarios/term01.test.ts', 'github': {'runId': 100, 'runAttempt': 1}, 'sourceCommit': 'a' * 40}
        self.assignment.write_text(json.dumps(a))
        with mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': 'heke99/gridex-ops-platform',
                                          'GITHUB_RUN_ID': '101', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': 'a' * 40}), \
                mock.patch.object(module, 'command', return_value='') as command:
            with self.assertRaisesRegex(ValueError, 'github-invocation-mismatch'):
                module.authenticate('up')
        self.assertEqual(command.call_count, 1)

    def test_up_budget_consumed_only_once(self):
        a = {}
        module.save_private(self.home / 'cgroup.json', {'path': '/sys/fs/cgroup/synthetic'})
        with mock.patch.object(module, 'authenticate', return_value=(a, self.home, self.root)), \
                mock.patch.object(module, 'validate_attempt'), mock.patch.object(module, 'owned_cgroup', return_value=Path('/sys/fs/cgroup/synthetic')), mock.patch.object(module, 'read_text', return_value='0::/synthetic'):
            module.authorize('up')
            with self.assertRaises(FileExistsError):
                module.authorize('up')

    def test_runtime_process_outside_group_never_consumes_budget(self):
        module.save_private(self.home / 'cgroup.json', {'path': '/sys/fs/cgroup/synthetic'})
        with mock.patch.object(module, 'authenticate', return_value=({}, self.home, self.root)), \
                mock.patch.object(module, 'validate_attempt'), mock.patch.object(module, 'owned_cgroup', return_value=Path('/sys/fs/cgroup/synthetic')), mock.patch.object(module, 'read_text', return_value='0::/foreign'):
            with self.assertRaisesRegex(ValueError, 'runtime-process-outside-owned-cgroup'):
                module.authorize('up')
        self.assertFalse((self.home / 'up-consumed.json').exists())

    def test_installed_ledger_observed_and_mismatch_refused(self):
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/gridex-aud-003-main-ledger.json').write_text(json.dumps({'entries': [{'version': '20260101000000', 'name': 'expected'}]}))
        a = {'ports': {'SIM_DB_PORT': 12345}, 'runDir': str(self.root), 'schemaFingerprint': 'expected-fingerprint'}
        with mock.patch.object(module, 'command', side_effect=['20260101000000\texpected', '123', '170006', 'expected-fingerprint']):
            result = module.database_evidence(a, self.home)
        self.assertEqual(result['systemIdentifier'], '123')
        with mock.patch.object(module, 'command', return_value='20260101000000\twrong'):
            with self.assertRaisesRegex(ValueError, 'installed-ledger-mismatch'):
                module.database_evidence(a, self.home)
        self.assertNotEqual(os.environ.get('PGPASSWORD'), 'postgres')

    def test_unrecorded_backend_never_adopted_for_cleanup(self):
        resource = {'kind': 'container', 'id': 'foreign'}
        with mock.patch.object(module, 'authenticate', return_value=({'projectId': 'synthetic'}, self.home, self.root)), \
                mock.patch.object(module, 'validate_attempt'), mock.patch.object(module, 'docker_resources', return_value=[resource]), \
                mock.patch.object(module, 'command') as command:
            with self.assertRaisesRegex(ValueError, 'unrecorded-resource-refuse-cleanup'):
                module.cleanup()
        command.assert_not_called()

    def test_exact_recorded_backend_cleanup_and_done_receipt(self):
        resources = [{'kind': kind, 'id': kind + '-exact-id', 'name': kind, 'created': 'synthetic-birth', 'project': 'synthetic'}
                     for kind in ('container', 'network', 'volume')]
        module.save_private(self.home / 'resources-synthetic.json', {'assignment': module.digest(self.assignment), 'resources': resources})
        remaining = resources.copy()
        commands = []
        def command(argv, **kwargs):
            commands.append(argv)
            target = argv[-1]
            remaining[:] = [x for x in remaining if x['id'] != target]
            return ''
        with mock.patch.object(module, 'authenticate', return_value=({'projectId': 'synthetic'}, self.home, self.root)), \
                mock.patch.object(module, 'validate_attempt'), mock.patch.object(module, 'docker_resources', side_effect=lambda _: remaining.copy()), \
                mock.patch.object(module, 'command', side_effect=command):
            module.cleanup()
        self.assertEqual([c[1] for c in commands], ['container', 'network', 'volume'])
        self.assertEqual(len(list(self.home.glob('cleanup-done-*.json'))), 1)
        self.assertEqual(remaining, [])

    def test_cleanup_identity_change_stops_before_mutation(self):
        resource = {'kind': 'volume', 'id': 'same-name', 'created': 'original'}
        module.save_private(self.home / 'resources-synthetic.json', {'assignment': module.digest(self.assignment), 'resources': [resource]})
        with mock.patch.object(module, 'authenticate', return_value=({'projectId': 'synthetic'}, self.home, self.root)), \
                mock.patch.object(module, 'validate_attempt'), \
                mock.patch.object(module, 'docker_resources', side_effect=[[resource], [{'kind': 'volume', 'id': 'same-name', 'created': 'changed'}]]), \
                mock.patch.object(module, 'command') as command:
            with self.assertRaisesRegex(ValueError, 'resource-set-changed-before-cleanup'):
                module.cleanup()
        command.assert_not_called()
        self.assertEqual(len(list(self.home.glob('cleanup-*.json'))), 1)

    def test_safe_summary_never_exports_private_steps_or_keys(self):
        reports = self.home / 'reports'
        reports.mkdir()
        (reports / 'synthetic.json').write_text(json.dumps({'scenario': 'term01', 'exitCode': 0,
            'summary': {'passed': 1, 'failed': 0, 'skipped': 0, 'total': 1},
            'steps': [{'secret': 'SECRET-MUST-NOT-ESCAPE'}], 'env': {'SERVICE_KEY': 'SECRET-MUST-NOT-ESCAPE'}}))
        with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.root), 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': 'a' * 40}):
            module.safe_summary()
        text = (self.root / 't2-safe-receipt.json').read_text()
        self.assertNotIn('SECRET-MUST-NOT-ESCAPE', text)
        safe = json.loads(text)
        self.assertEqual(safe['assertions']['total'], 1)
        self.assertEqual(safe['wholeScenarioAcceptance'], 'HOLD_INDEPENDENT_EFFECT_REVIEW_REQUIRED')

    def runner_copy(self):
        harness = self.root / 'harness'
        (harness / 'lib').mkdir(parents=True)
        (harness / 'scenarios').mkdir()
        (harness / 'run.sh').write_text((HERE.parent / 'run.sh').read_text())
        (harness / 'lib/common.sh').write_text('HARNESS_DIR="' + str(harness) + '"\ndie() { echo "$*" >&2; exit 1; }\nlog() { :; }\nensure_node_modules() { :; }\n')
        return harness

    def test_real_shell_scenario_rejection_before_vitest(self):
        harness = self.runner_copy()
        self.assignment.write_text(json.dumps({'scenario': 'scenarios/term01.test.ts'}))
        (harness / 'scenarios/term02.test.ts').write_text('// rejected scenario')
        (self.home / 'app.env').write_text('')
        app = self.root / 'app'
        binary = app / 'node_modules/.bin/vitest'
        binary.parent.mkdir(parents=True)
        marker = self.root / 'vitest-calls'
        binary.write_text('#!/bin/sh\necho invoked >> "' + str(marker) + '"\nexit 99\n')
        binary.chmod(0o700)
        with mock.patch.dict(os.environ, {'RUN_DIR': str(app)}):
            result = subprocess.run(['bash', str(harness / 'run.sh'), 'scenarios/term02.test.ts'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('scenario not admitted', result.stderr)
        self.assertFalse((self.home / 'run.lock').exists())
        self.assertFalse(marker.exists(), 'rejected scenario must make zero Vitest calls')

    def test_real_shell_unknown_lock_is_preserved(self):
        harness = self.runner_copy()
        self.assignment.write_text(json.dumps({'scenario': 'scenarios/term01.test.ts'}))
        (harness / 'scenarios/term01.test.ts').write_text('// offline fixture')
        (self.home / 'app.env').write_text('')
        lock = self.home / 'run.lock'
        lock.mkdir()
        (lock / 'pid').write_text('99999999')
        app = self.root / 'app'
        binary = app / 'node_modules/.bin/vitest'
        binary.parent.mkdir(parents=True)
        binary.write_text('#!/bin/sh\nexit 99\n')
        binary.chmod(0o700)
        with mock.patch.dict(os.environ, {'RUN_DIR': str(app)}):
            result = subprocess.run(['bash', str(harness / 'run.sh'), 'scenarios/term01.test.ts'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unknown or active run.lock', result.stderr)
        self.assertEqual((lock / 'pid').read_text(), '99999999')

    def test_receipt_tree_must_equal_actual_base_tree(self):
        binding = {'ref': 'refs/tags/agent-claims/masterplan/producer-fixture', 'receipt': '1' * 40,
                   'base': '3' * 40, 'tree': '2' * 40,
                   'body': {'base': '3' * 40, 'files': [], 'operation': 'synthetic'}}
        responses = [json.dumps({'object': {'type': 'commit', 'sha': '1' * 40}}),
                     json.dumps({'tree': {'sha': '2' * 40}, 'parents': [{'sha': '3' * 40}], 'message': json.dumps(binding['body'])}),
                     json.dumps({'tree': {'sha': '4' * 40}})]
        with mock.patch.object(module, 'command', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'receipt-not-neutral-to-actual-base'):
                module.verify_binding(binding)

    def native_binding(self):
        import uuid
        a = {'runtimeOwner': 'T2-synthetic-test-owner', 'sourceCommit': '1' * 40, 'sourceTree': '2' * 40,
             'sourceFiles': {'.github/workflows/t2-term-disposable.yml': '3' * 64},
             'inputEpoch': '4' * 64, 'budget': {'startup': 1, 'scenario': 1},
             'expiresAt': '2099-01-01T00:00:00Z', 'cleanupExpiresAt': '2099-01-02T00:00:00Z',
             'environmentId': 'synthetic-t2', 'github': {'runId': 1, 'runAttempt': 1}}
        packet = str(uuid.uuid4())
        proof = {'protocol': 'masterplan-reservation-v1', 'worker': 'T2', 'resourceKind': 'producer',
                 'epoch': 'gridex-five-agent-20261012', 'packet': packet, 'slot': 'session-' + packet,
                 'agent': a['runtimeOwner'], 'branch': 'synthetic', 'checkpoint': '/private/synthetic',
                 'nextAction': 'synthetic', 'createdAt': '2026-11-01T00:00:00Z', 'ids': [], 'base': '5' * 40,
                 'source': a['sourceCommit'], 'sourceTree': a['sourceTree'],
                 'workflowSHA256': a['sourceFiles']['.github/workflows/t2-term-disposable.yml'],
                 'files': sorted(a['sourceFiles'])}
        proof.update({k: a[k] for k in ['inputEpoch','budget','expiresAt','cleanupExpiresAt','environmentId','github']})
        ref = 'refs/tags/agent-claims/masterplan/producer-t2-term-disposable'
        binding = {'ref': ref, 'refs': sorted([ref, 'refs/tags/agent-claims/masterplan/slot-session-' + packet]),
                   'base': proof['base'], 'privateProof': proof,
                   'body': {'base': proof['base'], 'files': proof['files'],
                            'operation': 'Produce qualified T2 TERM native proof; private-proof-sha256=' + module.canonical_sha256(proof)}}
        return a, binding

    def test_full_private_native_proof_matches_all_applicability(self):
        a, binding = self.native_binding()
        with mock.patch.object(module, 'verify_binding') as verify:
            module.verify_native_binding(binding, a, 'producer')
        verify.assert_called_once_with(binding)
        a['inputEpoch'] = 'changed'
        with mock.patch.object(module, 'verify_binding') as verify:
            with self.assertRaisesRegex(ValueError, 'native-private-source-input-budget-mismatch'):
                module.verify_native_binding(binding, a, 'producer')
        verify.assert_not_called()

    def test_legacy_producer_and_partial_native_refs_rejected(self):
        a, binding = self.native_binding()
        binding['ref'] = 'refs/tags/agent-claims/masterplan/producer-db05'
        with self.assertRaisesRegex(ValueError, 'native-exact-own-resource-set-required'):
            module.verify_native_binding(binding, a, 'producer')
        a, binding = self.native_binding()
        binding['refs'] = [binding['ref']]
        with self.assertRaisesRegex(ValueError, 'native-exact-own-resource-set-required'):
            module.verify_native_binding(binding, a, 'producer')

    def test_scenario_wrapper_enters_recorded_group_before_real_runner_exec(self):
        import sys
        a = {'scenario': 'scenarios/term01.test.ts'}
        path = Path('/sys/fs/cgroup/synthetic-group')
        calls = []
        def command(argv, **kwargs):
            calls.append(('kernel-port', argv, kwargs))
            return ''
        def execute(program, argv):
            calls.append(('exec-port', program, argv))
        with mock.patch.object(sys, 'argv', ['qualify-runtime.py', '--operation', 'scenario']), \
                mock.patch.object(module, 'authenticate', return_value=(a, self.home, self.root)), \
                mock.patch.object(module, 'owned_cgroup', return_value=path), \
                mock.patch.object(module, 'command', side_effect=command), mock.patch.object(os, 'execv', side_effect=execute):
            module.main()
        self.assertEqual(calls[0][0], 'kernel-port')
        self.assertEqual(calls[0][1], ['sudo','-n','tee', str(path / 'cgroup.procs')])
        self.assertEqual(calls[0][2]['stdin'], str(os.getpid()))
        self.assertEqual(calls[1][0], 'exec-port')
        self.assertEqual(calls[1][2][-1], 'scenarios/term01.test.ts')
        self.assertTrue(calls[1][2][-2].endswith('/run.sh'))

    def test_partial_start_cleanup_stops_owned_child_and_recorded_backend(self):
        import sys
        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'])
        self.addCleanup(lambda: child.poll() is None and child.kill())
        group = self.root / 'confined-cgroup-port'
        group.mkdir()
        (group / 'cgroup.procs').write_text(str(child.pid))
        module.save_private(self.home / 'cgroup.json', {'path': str(group), 'device': 1, 'inode': 1})
        resource = {'kind':'container', 'id':'partial-start-container', 'created':'synthetic-birth'}
        module.save_private(self.home / 'resources-partial.json', {'assignment': module.digest(self.assignment), 'resources': [resource]})
        remaining = [resource]
        calls = []
        def command(argv, **kwargs):
            calls.append(argv)
            if 'cgroup.kill' in ' '.join(argv):
                child.terminate()
                child.wait(timeout=3)
                (group / 'cgroup.procs').write_text('')
            elif 'rmdir' in argv:
                (group / 'cgroup.procs').unlink()
                group.rmdir()
            elif argv[:3] == ['docker','container','rm']:
                remaining.clear()
            return ''
        a = {'projectId':'synthetic', 'github':{'runId':1}}
        with mock.patch.object(module, 'authenticate', return_value=(a,self.home,self.root)), \
                mock.patch.object(module, 'validate_attempt'), mock.patch.object(module, 'owned_cgroup', return_value=group), \
                mock.patch.object(module, 'docker_resources', side_effect=lambda _: remaining.copy()), \
                mock.patch.object(module, 'command', side_effect=command):
            module.cleanup()
        self.assertIsNotNone(child.returncode)
        self.assertFalse(group.exists())
        self.assertEqual(remaining, [])
        self.assertEqual(len(list(self.home.glob('cleanup-done-*.json'))), 1)
        self.assertTrue((self.home / 'cgroup-stopped.json').exists())

    def test_allowlisted_summary_rejects_raw_private_hash_field(self):
        proof = {'database': {'ledger': ''}, 'buildManifest': 'SECRET-MUST-NOT-ESCAPE',
                 'replayLog': 'a'*64, 'buildLog':'a'*64, 'resources':[]}
        module.save_private(self.home / 'qualified.json', proof)
        with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.root), 'GITHUB_RUN_ID':'1','GITHUB_RUN_ATTEMPT':'1','GITHUB_SHA':'a'*40}):
            with self.assertRaisesRegex(ValueError, 'unsafe-summary-hash-field'):
                module.safe_summary()
        self.assertFalse((self.root / 't2-safe-receipt.json').exists())

    def test_actual_actor_receipts_bound_and_negative_intent_not_authorized(self):
        import uuid
        import datetime
        directory = self.home / 'actor-receipts'
        directory.mkdir(mode=0o700)
        module.save_private(self.home / 'scenario-consumed.json', {})
        module.save_private(self.home / 'attempt.json', {'host': {'observedAt': '2000-01-01T00:00:00+00:00'}})
        company = str(uuid.uuid4())
        a = {'sourceCommit':'a'*40, 'environmentId':'synthetic'}
        receipt = {'schema':'gridex-t2-observed-actor-v1', 'assignmentSha256':module.digest(self.assignment),
                   'sourceCommit':'a'*40, 'environmentId':'synthetic', 'userId':str(uuid.uuid4()),
                   'companyId':company, 'requestedCompanyId':company,
                   'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'intent':'authorized', 'authVerified':True, 'selectedCompanyVerified':True,
                   'tenantRoleVerified':True, 'licenseVerified':False,
                   'licensePolicy':'NO_APPLICATION_LICENSE_GATE_IDENTIFIED', 'contextEvidenceSHA256':'b'*64}
        path = directory / 'ordinary.json'
        module.save_private(path, receipt)
        negative = dict(receipt, intent='expected_denial', selectedCompanyVerified=False,
                        requestedCompanyId=str(uuid.uuid4()), requestedCompanyDenied=True)
        module.save_private(directory / 'denial.json', negative)
        with mock.patch.object(module, 'authenticate', return_value=(a,self.home,self.root)), mock.patch.object(module, 'validate_attempt'):
            module.qualify_actors()
        result = module.load_private(self.home / 'actors-qualified.json')
        self.assertEqual(result['intents'], {'authorized':1,'expected_denial':1})
        receipt['licenseVerified'] = True
        path.write_text(json.dumps(receipt))
        with mock.patch.object(module, 'authenticate', return_value=(a,self.home,self.root)), mock.patch.object(module, 'validate_attempt'):
            with self.assertRaisesRegex(ValueError, 'license-observation-policy-mismatch'):
                module.qualify_actors()

    def test_missing_actor_observation_is_not_prestart_admission(self):
        module.save_private(self.home / 'scenario-consumed.json', {})
        (self.home / 'actor-receipts').mkdir(mode=0o700)
        with mock.patch.object(module, 'authenticate', return_value=({},self.home,self.root)), mock.patch.object(module, 'validate_attempt'):
            with self.assertRaisesRegex(ValueError, 'observed-actor-receipts-missing'):
                module.qualify_actors()

    def test_scenario_budget_cannot_be_reused(self):
        app = self.root / 'app'
        (app / '.next').mkdir(parents=True)
        (app / '.next/BUILD_ID').write_text('synthetic-build')
        (app / '.next/build-manifest.json').write_text('{}')
        (self.home / 'logs').mkdir()
        for name in ('build.log','replay.log'):
            (self.home / 'logs' / name).write_text('synthetic successful process log')
        proof = {'assignment':module.digest(self.assignment), 'buildId':'synthetic-build',
                 'buildManifest':module.digest(app / '.next/build-manifest.json'),
                 'buildLog':module.digest(self.home / 'logs/build.log'),
                 'replayLog':module.digest(self.home / 'logs/replay.log'), 'resources':[], 'database':{}}
        module.save_private(self.home / 'qualified.json', proof)
        with mock.patch.object(module, 'authenticate', return_value=({'scenario':'scenarios/term01.test.ts'},self.home,app)), \
                mock.patch.object(module,'validate_attempt'), mock.patch.object(module,'owned_cgroup', return_value=Path('/sys/fs/cgroup/synthetic')), \
                mock.patch.object(module,'read_text',return_value='0::/synthetic'), \
                mock.patch.object(module,'inventory',return_value=[]), mock.patch.object(module,'database_evidence',return_value={}):
            module.authorize('run')
            with self.assertRaises(FileExistsError):
                module.authorize('run')

    def owned_scope_fixture(self):
        paths = sorted(['.github/workflows/t2-term-disposable.yml',
                        'scripts/simulation/track2/up.sh', 'scripts/simulation/track2/lib/fixture.ts',
                        'scripts/simulation/track2/hosted/qualify-runtime.py'])
        assignment = {'ownedSourceFiles': paths, 'sourceFiles': {p: 'a' * 64 for p in paths},
                      'sourceCustody': [{'body': {'files': paths[:2]}}, {'body': {'files': paths[2:]}}]}
        # These inputs are readonly source identities, not T2 source-writer claims.
        assignment['sourceFiles'].update({'package-lock.json':'b'*64, 'supabase/schema.sql':'c'*64})
        return paths, assignment

    def test_authentic_unrelated_ordinary_receipt_cannot_cover_runtime(self):
        paths, assignment = self.owned_scope_fixture()
        import hashlib
        ref = 'refs/tags/agent-claims/masterplan/file-' + hashlib.sha256(b'unrelated.ts').hexdigest()
        refs = sorted([ref, 'refs/tags/agent-claims/masterplan/slot-session-synthetic'])
        operation = 'Reserve source files and rule IDs; resources-sha256=' + hashlib.sha256('\n'.join(refs).encode()).hexdigest()
        body = {'base':'3'*40, 'files':['unrelated.ts'], 'operation':operation}
        binding = {'refs':refs, 'receipt':'1'*40, 'base':'3'*40, 'tree':'2'*40, 'body':body}
        actual_ref = json.dumps({'object':{'type':'commit','sha':'1'*40}})
        commit = json.dumps({'tree':{'sha':'2'*40}, 'parents':[{'sha':'3'*40}], 'message':json.dumps(body)})
        with mock.patch.object(module, 'command', side_effect=[actual_ref, actual_ref, commit, json.dumps({'tree':{'sha':'2'*40}})]):
            module.verify_binding(binding)  # genuinely valid ordinary capsule/readbacks through the API port
        assignment['sourceCustody'] = [binding]
        with mock.patch.object(module,'git',return_value='\n'.join(paths)):
            with self.assertRaisesRegex(ValueError, 'ordinary-custody-does-not-cover-runtime-scope'):
                module.verify_owned_source_scope(assignment,self.root)

    def test_signed_scope_cannot_omit_an_actual_adopted_path(self):
        paths, assignment = self.owned_scope_fixture()
        assignment['ownedSourceFiles'] = paths[:-1]
        with mock.patch.object(module,'git',return_value='\n'.join(paths)):
            with self.assertRaisesRegex(ValueError, 'signed-owned-source-scope-mismatch'):
                module.verify_owned_source_scope(assignment,self.root)

    def test_complete_adopted_custody_does_not_require_readonly_input_claims(self):
        paths, assignment = self.owned_scope_fixture()
        # Extra paths in old capsules do not enlarge the explicitly assigned runtime scope.
        assignment['sourceCustody'][0]['body']['files'].append('unrelated-old-capsule.ts')
        with mock.patch.object(module,'git',return_value='\n'.join(paths)):
            module.verify_owned_source_scope(assignment,self.root)
        self.assertNotIn('unrelated-old-capsule.ts',assignment['ownedSourceFiles'])
        self.assertNotIn('package-lock.json',assignment['ownedSourceFiles'])

    def test_missing_required_owned_byte_pin_is_hold(self):
        paths, assignment = self.owned_scope_fixture()
        assignment['sourceFiles'].pop(paths[-1])
        with mock.patch.object(module,'git',return_value='\n'.join(paths)):
            with self.assertRaisesRegex(ValueError, 'owned-source-bytes-not-pinned'):
                module.verify_owned_source_scope(assignment,self.root)


class RendezvousContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import base64
        cls.shared = tempfile.TemporaryDirectory()
        root = Path(cls.shared.name)
        cls.context = {'runId':777,'runAttempt':1,'sourceCommit':'a'*40,'jobId':888,
                       'checkId':'888','annotationsCount':1}
        recipient = root / 'recipient'
        recipient.mkdir(mode=0o700)
        cls.public = module.generate_recipient(recipient,cls.context)
        cls.key = (recipient / 'recipient.key').read_bytes()
        cls.cert = (recipient / 'recipient.crt').read_bytes()
        cls.der = base64.b64decode(cls.public['certificateDERBase64'])
        wrong = root / 'wrong-recipient.key'
        module.command(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:4096','-out',str(wrong)])
        cls.wrong_key = wrong.read_bytes()
        cls.edkey = root / 'signing.pem'
        cls.edpub = root / 'signing.pub'
        module.command(['openssl','genpkey','-algorithm','Ed25519','-out',str(cls.edkey)])
        cls.edkey.chmod(0o600)
        module.command(['openssl','pkey','-in',str(cls.edkey),'-pubout','-out',str(cls.edpub)])

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.receiver = self.root / 'receiver'
        self.receiver.mkdir(mode=0o700)
        module.private_bytes(self.receiver / 'recipient.key',self.key)
        module.private_bytes(self.receiver / 'recipient.crt',self.cert)
        self.assignment = self.root / 'signed-input.json'
        self.value = {'github':{'runId':777,'runAttempt':1},'sourceCommit':'a'*40,
                      'worker':'T2','state':'ACTIVE','sourceTree':'b'*40,
                      'expiresAt':'2099-01-01T00:00:00Z','sourceCustody':[],
                      'startupAttempt':{'backendReservation':{},'producerReservation':{}},
                      'syntheticSecret':'SYNTHETIC-PRIVATE-SENTINEL-MUST-NEVER-BE-PUBLISHED'}
        self.write_signed(self.value)
        self.output = self.root / 'received.json'
        self.pinned = mock.patch.object(module,'admission_public_key',return_value=self.edpub.read_text())
        self.pinned.start()
        self.addCleanup(self.pinned.stop)

    def write_signed(self,value):
        if self.assignment.exists():
            self.assignment.write_text(json.dumps(value))
        else:
            module.save_private(self.assignment,value)
        module.command(['openssl','pkeyutl','-sign','-rawin','-inkey',str(self.edkey),
                        '-in',str(self.assignment),'-out',str(self.assignment)+'.sig'])
        Path(str(self.assignment)+'.sig').chmod(0o600)

    def encrypt(self):
        folder = self.root / 'encryption'
        folder.mkdir(mode=0o700)
        return module.cms_encrypt(self.assignment,self.der,folder)

    def commit(self,ciphertext,context=None,public=None):
        context = context or self.context
        body = module.carrier_body(context,public or self.public,ciphertext)
        return {'sha':'c'*40,'tree':{'sha':'b'*40},'parents':[{'sha':'a'*40}],
                'message':json.dumps(body)}

    def consume(self,commit):
        return module.consume_carrier(self.receiver,commit,self.context,self.public,'b'*40,self.output)

    def test_real_cms_signed_roundtrip_exports_only_ciphertext(self):
        encrypted = self.encrypt()
        commit = self.commit(encrypted)
        self.assertNotIn(self.value['syntheticSecret'],json.dumps(commit))
        self.assertNotIn('PRIVATE KEY',json.dumps(self.public))
        self.assertEqual((self.receiver / 'recipient.key').stat().st_mode & 0o777,0o600)
        self.consume(commit)
        self.assertEqual(self.output.read_bytes(),self.assignment.read_bytes())
        self.assertEqual(Path(str(self.output)+'.sig').read_bytes(),Path(str(self.assignment)+'.sig').read_bytes())
        self.assertEqual(module.verified_assignment(self.output),self.value)
        self.assertEqual(module.load_private(self.receiver / 'delivery-received.json')['state'],
                         'SIGNED_INPUT_RECEIVED_NOT_RUNTIME_ADMITTED')

    def test_successful_appointment_cannot_be_replayed(self):
        commit = self.commit(self.encrypt())
        self.consume(commit)
        with self.assertRaises(FileExistsError):
            self.consume(commit)

    def test_carrier_other_run_or_recipient_refused(self):
        encrypted = self.encrypt()
        other = dict(self.context,runId=778)
        with self.assertRaisesRegex(ValueError,'carrier-run-or-recipient-mismatch'):
            self.consume(self.commit(encrypted,other))
        with self.assertRaisesRegex(ValueError,'carrier-run-or-recipient-mismatch'):
            self.consume(self.commit(encrypted,public=dict(self.public,certificateSHA256='f'*64)))
        self.assertFalse(self.output.exists())

    def test_carrier_must_have_actual_source_tree_and_sole_parent(self):
        commit = self.commit(b'synthetic-not-decrypted')
        commit['parents'].append({'sha':'d'*40})
        with self.assertRaisesRegex(ValueError,'carrier-not-neutral-to-source'):
            self.consume(commit)

    def test_gcm_tamper_consumes_appointment_without_plaintext_install(self):
        encrypted = bytearray(self.encrypt())
        encrypted[-1] ^= 1
        with self.assertRaises(subprocess.CalledProcessError):
            self.consume(self.commit(bytes(encrypted)))
        self.assertFalse(self.output.exists())
        self.assertTrue((self.receiver / 'delivery-consumed.json').exists())

    def test_bad_root_signature_fails_after_decryption_before_install(self):
        signature = Path(str(self.assignment)+'.sig')
        value = bytearray(signature.read_bytes())
        value[-1] ^= 1
        signature.write_bytes(value)
        with self.assertRaises(subprocess.CalledProcessError):
            self.consume(self.commit(self.encrypt()))
        self.assertFalse(self.output.exists())

    def test_valid_signature_for_other_run_not_rebound_by_carrier(self):
        value = dict(self.value,github={'runId':778,'runAttempt':1})
        self.write_signed(value)
        with self.assertRaisesRegex(ValueError,'decrypted-admission-run-mismatch'):
            self.consume(self.commit(self.encrypt()))
        self.assertFalse(self.output.exists())

    def test_cbc_algorithm_rejected_before_private_key_decrypt(self):
        packet = self.root / 'cbc-input'
        module.private_bytes(packet,b'synthetic')
        output = self.root / 'cbc.cms'
        module.command(['openssl','cms','-encrypt','-binary','-aes-256-cbc','-in',str(packet),'-outform','DER',
                        '-out',str(output),'-recip',str(self.receiver / 'recipient.crt'),
                        '-keyopt','rsa_padding_mode:oaep','-keyopt','rsa_oaep_md:sha256','-keyopt','rsa_mgf1_md:sha256'])
        with mock.patch.object(module,'command',wraps=module.command) as command:
            with self.assertRaisesRegex(ValueError,'cms-algorithms-not-approved'):
                self.consume(self.commit(output.read_bytes()))
        self.assertFalse(any('-decrypt' in call.args[0] for call in command.call_args_list))

    def test_duplicate_or_wrong_run_public_notice_refused(self):
        notice = {'title':module.RECIPIENT_TITLE,'annotation_level':'notice','message':json.dumps(self.public)}
        with mock.patch.object(module,'delivery_get',return_value=[notice,notice]):
            with self.assertRaisesRegex(ValueError,'recipient-notice-not-unique'):
                module.discover_recipient(dict(self.context,annotationsCount=2))
        changed = dict(notice,message=json.dumps(dict(self.public,runId=778)))
        with mock.patch.object(module,'delivery_get',return_value=[changed]):
            with self.assertRaisesRegex(ValueError,'recipient-notice-binding-mismatch'):
                module.discover_recipient(self.context)

    def test_job_check_must_be_owned_by_actions_for_exact_invocation(self):
        run = {'head_sha':'a'*40,'run_attempt':1,'event':'workflow_dispatch',
               'path':'.github/workflows/t2-term-disposable.yml','status':'in_progress'}
        job = {'id':888,'name':'term','status':'in_progress','run_id':777,'run_attempt':1,'head_sha':'a'*40,
               'check_run_url':'https://api.github.com/repos/heke99/gridex-ops-platform/check-runs/888'}
        check = {'app':{'slug':'unrelated-app'},'head_sha':'a'*40,
                 'details_url':'https://github.com/heke99/gridex-ops-platform/actions/runs/777/job/888',
                 'output':{'annotations_count':1}}
        with mock.patch.object(module,'delivery_get',side_effect=[run,{'total_count':1,'jobs':[job]},check]):
            with self.assertRaisesRegex(ValueError,'delivery-check-provenance-mismatch'):
                module.delivery_context(777,'a'*40)

    def test_wait_is_bounded_and_timeout_never_starts_backend(self):
        import io,time
        clock = [0]
        def wait(seconds):
            clock[0] += seconds
        env = {'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':module.REPOSITORY,'GITHUB_JOB':'term',
               'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'777','GITHUB_SHA':'a'*40}
        with mock.patch.dict(os.environ,env), mock.patch.object(module,'delivery_context',return_value=self.context), \
                mock.patch.object(module,'recipient_directory',return_value=self.receiver), \
                mock.patch.object(module,'generate_recipient',return_value=self.public), \
                mock.patch.object(module,'delivery_get',return_value={'tree':{'sha':'b'*40}}), \
                mock.patch.object(module,'delivery_api',return_value=(404,{})) as api, \
                mock.patch.object(time,'monotonic',side_effect=lambda:clock[0]), mock.patch.object(time,'sleep',side_effect=wait), \
                mock.patch('sys.stdout',new_callable=io.StringIO) as output:
            with self.assertRaisesRegex(ValueError,'private-admission-rendezvous-timeout'):
                module.receive_admission()
        self.assertEqual(clock[0],600)
        self.assertEqual(api.call_count,20)
        self.assertNotIn(self.value['syntheticSecret'],output.getvalue())
        self.assertFalse(self.output.exists())

    def publisher_ports(self,fail_commit=False):
        state = {'posts':[],'commit':None,'ref':None}
        def api(method,route,body=None,**kwargs):
            if method == 'GET':
                if state['ref'] is None:
                    return 404,{}
                return 200,state['ref']
            state['posts'].append((route,body))
            if route == 'git/commits':
                if fail_commit:
                    raise subprocess.TimeoutExpired('synthetic-api-port',1)
                state['commit'] = {'sha':'c'*40,'tree':{'sha':body['tree']},
                                   'parents':[{'sha':x} for x in body['parents']],'message':body['message']}
                return 201,{'sha':'c'*40}
            state['ref'] = {'ref':body['ref'],'object':{'type':'commit','sha':body['sha']}}
            return 201,state['ref']
        def get(route,**kwargs):
            if route.startswith('git/ref/'):
                return state['ref']
            if route.endswith('a'*40):
                return {'tree':{'sha':'b'*40}}
            return state['commit']
        return state,api,get

    def test_create_only_publisher_exact_readback_and_private_journal(self):
        state,api,get = self.publisher_ports()
        journal = self.root / 'delivery.json'
        with mock.patch.object(module,'delivery_context',return_value=self.context), \
                mock.patch.object(module,'discover_recipient',return_value=self.public), \
                mock.patch.object(module,'verify_native_binding'), mock.patch.object(module,'delivery_api',side_effect=api), \
                mock.patch.object(module,'delivery_get',side_effect=get):
            module.publish_delivery(self.assignment,journal)
        self.assertEqual([route for route,_ in state['posts']],['git/commits','git/refs'])
        self.assertEqual(state['ref']['ref'],'refs/tags/t2-private-admission/777-attempt-1')
        self.assertNotIn(self.value['syntheticSecret'],json.dumps(state['posts']))
        self.assertEqual(module.load_private(journal)['state'],'PUBLISHED_EXACT_READBACK')
        self.assertEqual(journal.stat().st_mode & 0o777,0o600)

    def test_ambiguous_publication_is_recorded_and_never_retried(self):
        state,api,get = self.publisher_ports(fail_commit=True)
        journal = self.root / 'delivery.json'
        with mock.patch.object(module,'delivery_context',return_value=self.context), \
                mock.patch.object(module,'discover_recipient',return_value=self.public), \
                mock.patch.object(module,'verify_native_binding'), mock.patch.object(module,'delivery_api',side_effect=api), \
                mock.patch.object(module,'delivery_get',side_effect=get):
            with self.assertRaises(subprocess.TimeoutExpired):
                module.publish_delivery(self.assignment,journal)
            with self.assertRaises(FileExistsError):
                module.publish_delivery(self.assignment,journal)
        self.assertEqual(len(state['posts']),1)
        self.assertEqual(module.load_private(journal)['operations'][0]['state'],'FAILED_OR_AMBIGUOUS_RECONCILE_NO_RETRY')

    def test_journal_cannot_write_source_ref_or_unrelated_commit(self):
        journal = module.DeliveryJournal(self.root / 'delivery.json',self.context,self.public)
        self.addCleanup(journal.stream.close)
        journal.data['carrier'] = 'c'*40
        with mock.patch.object(module,'delivery_api') as api:
            with self.assertRaisesRegex(ValueError,'delivery-ref-body-out-of-scope'):
                journal.post('git/refs',{'ref':'refs/heads/main','sha':'c'*40})
        api.assert_not_called()

    def test_actual_other_private_key_cannot_decrypt_this_recipient(self):
        encrypted = self.encrypt()
        (self.receiver / 'recipient.key').write_bytes(self.wrong_key)
        with self.assertRaises(subprocess.CalledProcessError):
            self.consume(self.commit(encrypted))
        self.assertFalse(self.output.exists())
        self.assertTrue((self.receiver / 'delivery-consumed.json').exists())

    def test_default_oaep_sha1_refused_even_with_aes_gcm(self):
        packet = self.root / 'sha1-input'
        module.private_bytes(packet,b'synthetic')
        output = self.root / 'sha1.cms'
        module.command(['openssl','cms','-encrypt','-binary','-aes-256-gcm','-in',str(packet),'-outform','DER',
                        '-out',str(output),'-recip',str(self.receiver / 'recipient.crt'),'-keyopt','rsa_padding_mode:oaep'])
        with self.assertRaisesRegex(ValueError,'cms-algorithms-not-approved'):
            self.consume(self.commit(output.read_bytes()))
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
