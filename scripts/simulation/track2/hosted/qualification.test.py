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


if __name__ == '__main__':
    unittest.main(verbosity=2)
