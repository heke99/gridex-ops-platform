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
QUALIFIED_CGROUP = {'state':'VERIFIED_INITIAL_GLOBAL_V2','namespace':{'inode':0xEFFFFFFB,'type':0x02000000},
                    'mountRoot':'/','membership':'0::/','ancestors':[{'path':'/sys/fs/cgroup','limits':{'memory.max':'GLOBAL_ROOT_UNLIMITED','cpu.max':'GLOBAL_ROOT_UNLIMITED'}}]}
QUALIFIED_TEST_CAPACITY = {'driver':'overlay2','effectiveRAMBytes':8*module.GIB,'dockerRootFreeBytes':50*module.GIB,
                           'dockerRootDir':'/unit/docker','rootNamespaceVerified':True,'daemonId':'unit',
                           'socketIdentity':{'device':1,'inode':2},'cpuQuota':'max 100000','cgroupCapacity':QUALIFIED_CGROUP}


MODEL_BACKEND = {'schema':'gridex-t2-shared-backend-capacity-v1','state':'VERIFIED','errors':[],
                 'backend':{'effectiveRAMBytes':8*module.GIB}}
QUALIFIED_TEST_CAPACITY['backendCapacity'] = copy.deepcopy(MODEL_BACKEND)
# Pure boundary fixtures; actual kernel/socket/parent acquisition is tested separately.

class Contracts(unittest.TestCase):
    def setUp(self):
        self.observation = {"driver": "overlay2", "effectiveRAMBytes": 8 * module.GIB,
                            "dockerRootFreeBytes": 15 * module.GIB, "dockerRootDir": "/owned/docker",
                            "rootNamespaceVerified": True, "daemonId": "synthetic-test-daemon",
                            "socketIdentity": {"device": 1, "inode": 2}, "cpuQuota": "400000 100000",'cgroupCapacity':copy.deepcopy(QUALIFIED_CGROUP),'backendCapacity':copy.deepcopy(MODEL_BACKEND)}

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

class CgroupCapacityContracts(unittest.TestCase):
    def observe(self, *, inode=4026531835, namespace_type=0x02000000, mount_root='/', membership='/parent/job', changes=None):
        import fcntl,types
        files={'/proc/self/cgroup':'0::'+membership,
               '/proc/self/mountinfo':f'31 22 0:28 {mount_root} /sys/fs/cgroup rw - cgroup2 cgroup rw',
               '/sys/fs/cgroup/parent/job/memory.max':'max','/sys/fs/cgroup/parent/job/cpu.max':'max 100000',
               '/sys/fs/cgroup/parent/memory.max':str(2*module.GIB),'/sys/fs/cgroup/parent/cpu.max':'200000 100000'}
        files.update(changes or {})
        def read(path,*args,**kwargs):
            value=files.get(str(path))
            if value is None:raise FileNotFoundError(str(path))
            if isinstance(value,Exception):raise value
            return value
        def sysconf(name):return 16*module.GIB//4096 if name=='SC_PHYS_PAGES' else 4096
        docker=types.SimpleNamespace(stdout=json.dumps({'Driver':'overlay2','ID':'unit','DockerRootDir':'/owned/docker','MemTotal':16*module.GIB}))
        with mock.patch.object(Path,'read_text',read),mock.patch.object(Path,'read_bytes',lambda path:read(path).encode()),mock.patch.object(module.os,'sysconf',side_effect=sysconf), \
             mock.patch.object(module.subprocess,'run',return_value=docker),mock.patch.object(module.os,'open',return_value=555), \
             mock.patch.object(module.os,'close'),mock.patch.object(module.os,'fstat',return_value=types.SimpleNamespace(st_ino=inode,st_dev=4)), \
             mock.patch.object(fcntl,'ioctl',return_value=namespace_type), \
             mock.patch.object(Path,'stat',return_value=types.SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o40755)):
            observation=module.observe_host()
        observation.update(dockerRootFreeBytes=50*module.GIB,rootNamespaceVerified=True,backendCapacity=copy.deepcopy(MODEL_BACKEND))
        return observation

    def test_hidden_namespace_never_reports_physical_ram_as_effective(self):
        observation=self.observe(inode=4026532205,membership='/',changes={'/sys/fs/cgroup/memory.max':'max','/sys/fs/cgroup/cpu.max':'max 100000'})
        self.assertIsNone(observation['effectiveRAMBytes'])
        self.assertIn('cgroup-capacity-unverified',module.capacity_errors(observation))

    def test_complete_parent_hierarchy_preserves_lower_ram(self):
        observation=self.observe()
        self.assertEqual(observation['effectiveRAMBytes'],2*module.GIB)
        self.assertIn('insufficient-or-unknown-ram',module.capacity_errors(observation))

    def test_initial_namespace_global_mount_and_valid_limits_can_qualify(self):
        observation=self.observe(changes={'/sys/fs/cgroup/parent/memory.max':str(10*module.GIB)})
        self.assertEqual(observation['effectiveRAMBytes'],10*module.GIB)
        self.assertEqual(module.capacity_errors(observation),[])
        self.assertEqual(observation['cgroupCapacity']['state'],'VERIFIED_INITIAL_GLOBAL_V2')

    def test_wrong_namespace_type_mount_subtree_or_masked_mount_is_unknown(self):
        cases=[{'namespace_type':0x00020000},{'mount_root':'/hidden'},
               {'changes':{'/proc/self/mountinfo':'31 22 0:28 / /sys/fs/cgroup rw - tmpfs tmpfs rw'}},
               {'changes':{'/proc/self/mountinfo':'31 22 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n32 31 0:29 / /sys/fs/cgroup/parent rw - tmpfs tmpfs rw'}},
               {'membership':'/parent/../escape'}]
        for case in cases:
            with self.subTest(case=case):
                observation=self.observe(**case)
                self.assertIsNone(observation['effectiveRAMBytes'])
                self.assertIn('cgroup-capacity-unverified',module.capacity_errors(observation))

    def test_missing_unreadable_or_malformed_nonroot_limit_is_unknown(self):
        for file,value in [('memory.max',None),('cpu.max',None),('memory.max','bad'),('cpu.max','max bad'),
                           ('memory.max',PermissionError('unit denied')),('memory.max','GLOBAL_ROOT_UNLIMITED')]:
            with self.subTest(file=file,value=value):
                observation=self.observe(changes={'/sys/fs/cgroup/parent/'+file:value})
                self.assertIsNone(observation['effectiveRAMBytes'])
                self.assertEqual(observation['cgroupCapacity']['state'],'UNKNOWN_HOLD')

    def test_verified_global_root_controller_absence_is_explicit_unlimited(self):
        observation=self.observe(membership='/')
        self.assertEqual(module.capacity_errors(observation),[])
        self.assertEqual(observation['cgroupCapacity']['ancestors'][0]['limits'],
                         {'memory.max':'GLOBAL_ROOT_UNLIMITED','cpu.max':'GLOBAL_ROOT_UNLIMITED'})

    def test_legacy_or_malformed_attestation_is_clean_capacity_hold(self):
        for hierarchy in [None,'bad',{}, {'state':'VERIFIED_INITIAL_GLOBAL_V2'},
                          dict(QUALIFIED_CGROUP,ancestors=[None]),dict(QUALIFIED_CGROUP,ancestors={'bad':'shape'})]:
            with self.subTest(hierarchy=hierarchy):
                observation=dict(QUALIFIED_TEST_CAPACITY,cgroupCapacity=hierarchy)
                self.assertIn('cgroup-capacity-unverified',module.capacity_errors(observation))

class OperationalContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'private'
        self.home.mkdir(mode=0o700)
        # Budget/lifecycle tests use declared ports; acquisition has its own suite.
        for name in ('current_backend_capacity','container_capacity'):
            port = mock.patch.object(module,name,return_value={'finiteBudgetControl':True})
            port.start(); self.addCleanup(port.stop)
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
             'environmentId': 'synthetic-t2', 'github': {'runId': 1, 'runAttempt': 1},
             'bootstrapProofSHA256':'a'*64,'installationPolicy':{'synthetic':'exact-policy'}}
        packet = str(uuid.uuid4())
        proof = {'protocol': 'masterplan-reservation-v1', 'worker': 'T2', 'resourceKind': 'producer',
                 'epoch': 'gridex-five-agent-20261012', 'packet': packet, 'slot': 'session-' + packet,
                 'agent': a['runtimeOwner'], 'branch': 'synthetic', 'checkpoint': '/private/synthetic',
                 'nextAction': 'synthetic', 'createdAt': '2026-11-01T00:00:00Z', 'ids': [], 'base': '5' * 40,
                 'source': a['sourceCommit'], 'sourceTree': a['sourceTree'],
                 'workflowSHA256': a['sourceFiles']['.github/workflows/t2-term-disposable.yml'],
                 'files': sorted(a['sourceFiles'])}
        proof.update({k: a[k] for k in ['inputEpoch','budget','expiresAt','cleanupExpiresAt','environmentId','github','bootstrapProofSHA256','installationPolicy']})
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
                 'replayLog':module.digest(self.home / 'logs/replay.log'), 'resources':[], 'containerCapacity':{'finiteBudgetControl':True}, 'database':{}}
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
        for function, value in [('validate_bootstrap',{}),('verify_published_bootstrap',None),
                                ('bootstrap_observed',{'capacityErrors':[],'capacity':copy.deepcopy(QUALIFIED_TEST_CAPACITY)})]:
            patch = mock.patch.object(module,function,return_value=value)
            patch.start()
            self.addCleanup(patch.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.receiver = self.root / 't2-admission-rendezvous'
        self.receiver.mkdir(mode=0o700)
        module.private_bytes(self.receiver / 'recipient.key',self.key)
        module.private_bytes(self.receiver / 'recipient.crt',self.cert)
        self.assignment = self.root / 'signed-input.json'
        self.materials = self.root / 'producer-materials.json'
        self.specification = {
            'declaration':'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE','billingMonth':'2026-01',
            'signedDate':'2025-12-31','offerValidFrom':'2025-12-01','startsAt':'2026-01-01','startAt':'2025-12-31T23:00:00Z',
            'signedPdfBase64':'U1lOVEhFVElD','groundPdfBase64':'U1lOVEhFVElD',
            'authority':{'declaration':'TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE','authoritySourceSha256':'d'*64,
              'validFrom':'2025-01-01','validTo':'2099-01-01','regulatedIssuerCode':'SYNTHETIC',
              'regulatedReference':'synthetic-regulated','regulatedKeyHex':'a'*64,'networkRegistryVersion':'v1',
              'networkReference':'synthetic-network','networkKeyHex':'b'*64},
            'groundVersion':'v1','groundDecisionReference':'synthetic-decision',
            'network':{'pdfBase64':'U1lOVEhFVElD','reference':'synthetic-network','version':'v1','validFrom':'2025-01-01','validUntil':'2099-01-01',
                       'clause':{'locator':'synthetic','quote':'Syntetisk åäö clause'}},
            'z04':'UNB+SYNTHETIC','e66':['UNB+SYNTHETIC-E66']}
        self.value = {'github':{'runId':777,'runAttempt':1},'sourceCommit':'a'*40,
                      'worker':'T2','state':'ACTIVE','sourceTree':'b'*40,'environmentId':'synthetic-environment',
                      'scenario':'scenarios/pilot-term0203.test.ts',
                      'expiresAt':'2099-01-01T00:00:00Z','sourceCustody':[],
                      'startupAttempt':{'backendReservation':{},'producerReservation':{}},
                      'syntheticSecret':'SYNTHETIC-PRIVATE-SENTINEL-MUST-NEVER-BE-PUBLISHED'}
        self.write_signed(self.value)
        self.output = self.root / 'received.json'
        self.pinned = mock.patch.object(module,'admission_public_key',return_value=self.edpub.read_text())
        self.pinned.start()
        self.addCleanup(self.pinned.stop)

    def write_signed(self,value):
        value['pilotTerm0203']={'materialSpecificationSha256':module.typed_material_specification(self.specification)}
        if self.assignment.exists():
            self.assignment.write_text(json.dumps(value))
        else:
            module.save_private(self.assignment,value)
        module.command(['openssl','pkeyutl','-sign','-rawin','-inkey',str(self.edkey),
                        '-in',str(self.assignment),'-out',str(self.assignment)+'.sig'])
        Path(str(self.assignment)+'.sig').chmod(0o600)
        packet={'schema':'gridex-t2-term0203-materials-v1','assignmentSha256':module.digest(self.assignment),
                'sourceCommit':value['sourceCommit'],'environmentId':value['environmentId'],'specification':self.specification}
        if self.materials.exists():self.materials.write_bytes(json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode())
        else:module.private_bytes(self.materials,json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode())

    def encrypt(self):
        folder = self.root / 'encryption'
        folder.mkdir(mode=0o700)
        return module.cms_encrypt(self.assignment,self.der,folder,self.materials)

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

    def test_old_capacity_proof_cannot_reach_recipient_generation(self):
        legacy=copy.deepcopy(QUALIFIED_TEST_CAPACITY);legacy.pop('cgroupCapacity')
        env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':module.REPOSITORY,'GITHUB_JOB':'term',
             'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'777','GITHUB_SHA':'a'*40}
        with mock.patch.dict(os.environ,env),mock.patch.object(module,'delivery_context',return_value=self.context), \
             mock.patch.object(module,'bootstrap_observed',return_value={'capacityErrors':[],'capacity':legacy}), \
             mock.patch.object(module,'generate_recipient') as recipient:
            with self.assertRaisesRegex(ValueError,'bootstrap-capacity-unqualified'):module.receive_admission()
        recipient.assert_not_called()

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
            import sys
            with mock.patch.object(sys,'argv',['qualify-runtime.py','--operation','publish-delivery','--assignment-file',str(self.assignment),'--journal-file',str(journal),'--materials-file',str(self.materials)]):
                self.assertEqual(module.main(),0)
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
                module.publish_delivery(self.assignment,journal,self.materials)
            with self.assertRaises(FileExistsError):
                module.publish_delivery(self.assignment,journal,self.materials)
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

    def test_packet_specification_hash_matches_actual_javascript_serializer(self):
        packet=json.loads(self.materials.read_text())
        observed=subprocess.check_output(['node','-e',
            "const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(c.createHash('sha256').update(JSON.stringify(p.specification)).digest('hex'))",
            str(self.materials)],text=True)
        self.assertEqual(observed,self.value['pilotTerm0203']['materialSpecificationSha256'])
        packet['specification']['unexpectedFloat']=1.5
        with self.assertRaisesRegex(ValueError,'material-specification-schema-invalid'):
            module.typed_material_specification(packet['specification'])

    def test_publisher_rejects_missing_materials_before_any_api(self):
        self.materials.unlink()
        with mock.patch.object(module,'delivery_api') as api, mock.patch.object(module,'delivery_context') as context:
            with self.assertRaises(FileNotFoundError):
                module.publish_delivery(self.assignment,self.root/'journal.json',self.materials)
        api.assert_not_called();context.assert_not_called()

    def test_material_private_path_size_and_appointment_expiry_rejected(self):
        for key,value in [('assignmentSha256','0'*64),('sourceCommit','f'*40),('environmentId','other-environment')]:
            packet=json.loads(self.materials.read_text());packet[key]=value
            wrong=self.root/('wrong-'+key+'.json');module.private_bytes(wrong,json.dumps(packet).encode())
            with self.assertRaisesRegex(ValueError,'material-packet-assignment-mismatch'):
                module.validate_material_packet(self.assignment,wrong)
        link=self.root/'unsafe-link.json';link.symlink_to(self.materials)
        with self.assertRaisesRegex(ValueError,'material-path-not-canonical'):
            module.validate_material_packet(self.assignment,link)
        self.materials.chmod(0o640)
        with self.assertRaisesRegex(ValueError,'private-file-required'):
            module.validate_material_packet(self.assignment,self.materials)
        self.materials.chmod(0o600)
        self.materials.write_bytes(b'x'*(module.MAX_MATERIAL_PACKET_BYTES+1))
        with self.assertRaisesRegex(ValueError,'material-packet-size-invalid'):
            module.validate_material_packet(self.assignment,self.materials)
        expired=dict(self.value,expiresAt='2000-01-01T00:00:00Z');self.write_signed(expired)
        with self.assertRaisesRegex(ValueError,'material-appointment-expired'):
            module.validate_material_packet(self.assignment,self.materials)

    def test_receiver_refuses_tampered_or_wrong_spec_before_install(self):
        packet=json.loads(self.materials.read_text());packet['specification']['z04']='tampered-private-wire'
        self.materials.write_text(json.dumps(packet))
        # Simulate a hostile carrier bypassing sender validation; receiver stays real.
        with mock.patch.object(module,'validate_material_packet',return_value={}):
            ciphertext=self.encrypt()
        with self.assertRaisesRegex(ValueError,'material-specification-hash-mismatch'):
            self.consume(self.commit(ciphertext))
        self.assertFalse(self.output.exists())
        self.assertFalse((self.receiver/'materials.json').exists())

    def install_for_handoff(self):
        import io
        commit=self.commit(self.encrypt())
        envfile=self.root/'github-env';module.private_bytes(envfile,b'')
        env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':module.REPOSITORY,'GITHUB_JOB':'term','GITHUB_RUN_ATTEMPT':'1',
             'GITHUB_RUN_ID':'777','GITHUB_SHA':'a'*40,'RUNNER_TEMP':str(self.root),
             'GITHUB_ENV':str(envfile),'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.output)}
        with mock.patch.dict(os.environ,env), mock.patch.object(module,'delivery_context',return_value=self.context), \
             mock.patch.object(module,'recipient_directory',return_value=self.receiver), \
             mock.patch.object(module,'generate_recipient',return_value=self.public), \
             mock.patch.object(module,'delivery_api',return_value=(200,{'ref':module.delivery_ref(self.context),'object':{'type':'commit','sha':'c'*40}})), \
             mock.patch.object(module,'delivery_get',side_effect=[{'tree':{'sha':'b'*40}},commit]),mock.patch('sys.stdout',new_callable=io.StringIO) as output:
            module.receive_admission()
        text=envfile.read_text()
        self.assertEqual(text,'SIM_TERM0203_MATERIALS_FILE='+str(self.receiver/'materials.json')+'\n')
        self.assertNotIn(self.specification['authority']['regulatedKeyHex'],text)
        self.assertNotIn(self.value['syntheticSecret'],output.getvalue())
        self.assertEqual((self.receiver/'materials.json').read_bytes(),self.materials.read_bytes())
        return envfile

    def test_real_receiver_env_then_actual_run_shell_passes_material_to_finite_scenario(self):
        envfile=self.install_for_handoff()
        material_path=envfile.read_text().strip().split('=',1)[1]
        home=self.root/'run-home';home.mkdir(mode=0o700)
        for name in ('logs','reports'):(home/name).mkdir(mode=0o700)
        (home/'app.env').write_text('')
        harness=self.root/'scenario-harness';(harness/'lib').mkdir(parents=True);(harness/'scenarios').mkdir()
        (harness/'run.sh').write_text((HERE.parent/'run.sh').read_text())
        (harness/'lib/make-report.mjs').write_text((HERE.parent/'lib/make-report.mjs').read_text())
        (harness/'lib/common.sh').write_text('HARNESS_DIR="'+str(harness)+'"\ndie() { echo "$*" >&2; exit 1; }\nlog() { :; }\nensure_node_modules() { :; }\n')
        (harness/'scenarios/pilot-term0203.test.ts').write_text((HERE.parent/'scenarios/pilot-term0203.test.ts').read_text())
        app=self.root/'scenario-app';binary=app/'node_modules/.bin/vitest';binary.parent.mkdir(parents=True)
        binary.write_text("""#!/usr/bin/env node
const fs=require('fs'),c=require('crypto'),assert=require('assert');
const sha=b=>c.createHash('sha256').update(b).digest('hex');
const raw=fs.readFileSync(process.env.SIM_RUNTIME_ASSIGNMENT_FILE),a=JSON.parse(raw);
const p=JSON.parse(fs.readFileSync(process.env.SIM_TERM0203_MATERIALS_FILE));
assert.equal(process.argv.at(-1),'scenarios/pilot-term0203.test.ts');
assert.equal(p.schema,'gridex-t2-term0203-materials-v1');assert.equal(p.assignmentSha256,sha(raw));
assert.equal(p.sourceCommit,a.sourceCommit);assert.equal(p.environmentId,a.environmentId);
assert.equal(sha(JSON.stringify(p.specification)),a.pilotTerm0203.materialSpecificationSha256);
const out=process.argv.find(x=>x.startsWith('--outputFile.json=')).split('=')[1];
fs.writeFileSync(out,JSON.stringify({success:true,numTotalTestSuites:1,numFailedTestSuites:0,numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,
 testResults:[{assertionResults:[{fullName:'finite private material ABI port',status:'passed'}]}]}));
""")
        binary.chmod(0o700)
        env={'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.output),'SIM_TERM0203_MATERIALS_FILE':material_path,
             'RUNNER_TEMP':str(self.root),'RUN_DIR':str(app),'SIM_HOME':str(home)}
        with mock.patch.dict(os.environ,env):
            self.assertEqual(module.main.__name__,'main')
            module.validate_installed_materials(self.value,self.output)
            result=subprocess.run(['bash',str(harness/'run.sh'),'scenarios/pilot-term0203.test.ts'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        reports=list((home/'reports').glob('*.json'))
        self.assertEqual(len(reports),1)
        self.assertEqual(json.loads(reports[0].read_text())['summary']['passed'],1)

    def test_actual_prepare_cli_rechecks_received_packet_before_daemon_or_backend(self):
        import sys
        envfile=self.install_for_handoff();path=self.receiver/'materials.json'
        env={'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.output),'SIM_TERM0203_MATERIALS_FILE':str(path),'RUNNER_TEMP':str(self.root)}
        path.write_text(path.read_text()+' ') # even semantically identical bytes must match received raw digest
        with mock.patch.dict(os.environ,env),mock.patch.object(sys,'argv',['qualify-runtime.py','--operation','prepare']), \
             mock.patch.object(module,'authenticate',return_value=(self.value,self.root/'fresh-home',self.root)), \
             mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaisesRegex(ValueError,'installed-material-packet-drift'):
                module.main()
        daemon.assert_not_called()
        self.assertFalse((self.root/'fresh-home').exists())
        path.unlink()
        with mock.patch.dict(os.environ,env),mock.patch.object(module,'authenticate',return_value=(self.value,self.root/'fresh-home',self.root)), \
             mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaises(FileNotFoundError):module.prepare_attempt()
        daemon.assert_not_called()

    def test_env_export_refuses_unsafe_target_without_writing_material_data(self):
        self.consume(self.commit(self.encrypt()))
        outside=self.root.parent/('unsafe-env-'+self.root.name)
        with mock.patch.dict(os.environ,{'RUNNER_TEMP':str(self.root),'GITHUB_ENV':str(outside)}):
            with self.assertRaisesRegex(ValueError,'github-env-path-not-owned-runner-output'):
                module.export_material_path(self.receiver)
        self.assertFalse(outside.exists())

    def test_missing_decrypted_packet_field_and_expired_packet_never_install(self):
        import base64
        folder=self.root/'missing-packet';folder.mkdir(mode=0o700)
        wrapper=folder/'packet.json'
        module.save_private(wrapper,{'assignment':base64.b64encode(self.assignment.read_bytes()).decode(),
                                     'signature':base64.b64encode(Path(str(self.assignment)+'.sig').read_bytes()).decode()})
        output=folder/'envelope.cms'
        module.command(['openssl','cms','-encrypt','-binary','-aes-256-gcm','-in',str(wrapper),'-outform','DER','-out',str(output),
                        '-recip',str(self.receiver/'recipient.crt'),'-keyopt','rsa_padding_mode:oaep','-keyopt','rsa_oaep_md:sha256','-keyopt','rsa_mgf1_md:sha256'])
        with self.assertRaisesRegex(ValueError,'decrypted-packet-shape-invalid'):
            self.consume(self.commit(output.read_bytes()))
        self.assertFalse(self.output.exists())
        (self.receiver/'delivery-consumed.json').unlink() # new synthetic appointment in this confined fixture only
        expired=dict(self.value,expiresAt='2000-01-01T00:00:00Z');self.write_signed(expired)
        with mock.patch.object(module,'validate_material_packet',return_value={}):
            ciphertext=self.encrypt()
        with self.assertRaisesRegex(ValueError,'material-appointment-expired'):
            self.consume(self.commit(ciphertext))
        self.assertFalse(self.output.exists())
        self.assertFalse((self.receiver/'materials.json').exists())

    def test_manual_prepare_missing_environment_and_unsafe_directory_allocate_nothing(self):
        import sys
        self.install_for_handoff()
        env={'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.output),'SIM_TERM0203_MATERIALS_FILE':'', 'RUNNER_TEMP':str(self.root)}
        with mock.patch.dict(os.environ,env),mock.patch.object(sys,'argv',['qualify-runtime.py','--operation','prepare']), \
             mock.patch.object(module,'authenticate',return_value=(self.value,self.root/'fresh-home',self.root)),mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaisesRegex(ValueError,'material-private-environment-handoff-missing'):module.main()
        daemon.assert_not_called()
        self.receiver.chmod(0o755)
        env['SIM_TERM0203_MATERIALS_FILE']=str(self.receiver/'materials.json')
        with mock.patch.dict(os.environ,env),mock.patch.object(module,'authenticate',return_value=(self.value,self.root/'fresh-home',self.root)), \
             mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaisesRegex(ValueError,'material-directory-not-private'):module.prepare_attempt()
        daemon.assert_not_called();self.assertFalse((self.root/'fresh-home').exists())

    def test_publisher_cli_missing_material_argument_fails_before_api(self):
        import sys
        with mock.patch.object(sys,'argv',['qualify-runtime.py','--operation','publish-delivery','--assignment-file',str(self.assignment),'--journal-file',str(self.root/'journal')]), \
             mock.patch.object(module,'delivery_api') as api:
            with self.assertRaisesRegex(ValueError,'delivery-private-input-materials-and-journal-required'):module.main()
        api.assert_not_called()


class CanonicalLifetimeContracts(unittest.TestCase):
    def setUp(self):
        import hashlib
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.app = self.root / 'app'
        self.harness = self.app / 'scripts/simulation/track2'
        for relative in ('lib','hosted'):
            (self.harness / relative).mkdir(parents=True,exist_ok=True)
        self.home = self.root / 'private'
        self.home.mkdir(mode=0o700)
        for name in ('logs','pids','reports'):
            (self.home / name).mkdir(mode=0o700)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.backend = self.root / 'backend-live'
        self.trace = self.root / 'trace'
        self.index = self.root / 'index-changed'
        self.up = self.harness / 'up.sh'
        self.up.write_text((HERE.parent / 'up.sh').read_text())
        (self.harness / 'lib/common.sh').write_text(
            'umask 077\nHARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"\n'
            'REPLAY_ROOT="$SIM_HOME/replay-root"\n'
            'die() { echo "$*" >&2; exit 1; }\nlog() { :; }\n'
            'sb() { (cd "$REPLAY_ROOT" && supabase "$@"); }\n'
            't2_process_custody() { :; }\napp_pid_alive() { return 0; }\n')
        patcher = (HERE.parent / 'lib/prepare-supabase.py').read_text()
        patcher += "\nimport os\nif os.environ.get('TEST_COPY_MUTATION') == '1':\n p=path.parents[1]/'scripts/gridex-aud-003-clean-replay.sh'\n p.write_text(p.read_text()+'\\ncleanup() { :; }\\n')\n"
        (self.harness / 'lib/prepare-supabase.py').write_text(patcher)
        (self.app / 'supabase').mkdir()
        (self.app / 'supabase/config.toml').write_text('project_id="original"\n[api]\nport=54321\n[db]\nport=54322\nshadow_port=54320\nmajor_version=17\n[db.pooler]\nport=54329\n[studio]\nport=54323\n[inbucket]\nport=54324\n')
        (self.app / 'supabase/seed.sql').write_text('original seed\n')
        (self.app / 'supabase/migrations').mkdir()
        (self.app / 'supabase/migrations/one.sql').write_text('original migration\n')
        canonical = self.app / 'scripts/gridex-aud-003-clean-replay.sh'
        canonical.write_text('''set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED="$ROOT/supabase/seed.sql"
SEED_BACKUP="$(mktemp)"
cp "$SEED" "$SEED_BACKUP"
cleanup() {
  local canonical_status=$?
  set +e
  supabase stop --no-backup
  if [[ "${TEST_RESTORE_FAILURE:-0}" != 1 ]]; then cp "$SEED_BACKUP" "$SEED"; fi
  rm -f "$SEED_BACKUP"
  printf 'canonical:restore\\n' >> "$TEST_TRACE"
}
trap cleanup EXIT
printf live > "$TEST_BACKEND"
printf 'mutated seed\\n' > "$SEED"
printf 'canonical:started\\n' >> "$TEST_TRACE"
if [[ "${TEST_REPLAY_FAILURE:-0}" == 1 ]]; then false; printf 'ERROR-errexit-suppressed\\n' >> "$TEST_TRACE"; fi
printf '%s\\n' '[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger'
''')
        self.canonical = canonical
        self.assignment = self.root / 'assignment.json'
        ports = {'SIM_API_PORT':55101,'SIM_DB_PORT':54322,'SIM_SHADOW_PORT':55103,'SIM_POOLER_PORT':55104,
                 'SIM_STUDIO_PORT':55105,'SIM_MAIL_HTTP_PORT':55106,'SIM_SMTP_PORT':55107,
                 'SIM_APP_PORT':55108,'SIM_COUNTERPART_PORT':55109}
        self.a = {'sourceCommit':'1'*40,'projectId':'sim-t2-fixture','runDir':str(self.app),
                  'sourceFiles':{'scripts/simulation/track2/up.sh':module.digest(self.up)},
                  'canonicalReplaySHA256':module.digest(canonical),'ports':ports,
                  'startupAttempt':{'exclusiveHost':True,'backendReservation':{'ref':'refs/tags/agent-claims/masterplan/backend-synthetic','receipt':'2'*40},
                                    'producerReservation':{'ref':'refs/tags/agent-claims/masterplan/producer-synthetic','receipt':'3'*40}}}
        module.save_private(self.assignment,self.a)
        cli = '''import importlib.util,json,os,pathlib,sys,time
spec=importlib.util.spec_from_file_location('actual_runtime',os.environ['TEST_REAL_QUALIFIER'])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a=json.load(open(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE']));home=pathlib.Path(os.environ['SIM_HOME']);app=pathlib.Path(os.environ['RUN_DIR'])
m.git=lambda app,*args: ('INDEX_CHANGED' if pathlib.Path(os.environ['TEST_INDEX']).exists() else 'INDEX_STABLE') if args[0]=='ls-files' else ''
m.inventory=lambda *args: []
op=sys.argv[sys.argv.index('--operation')+1]
def event(message):
 with open(os.environ['TEST_TRACE'],'a') as f:f.write(message+'\\n')
if op=='replay-before':m.lifetime_snapshot(a,home,app,'before')
elif op=='supervisor-entered':m.verify_supervisor(a,home,require_parent=True)
elif op=='replay-live':m.live_replay(a,home,app)
elif op=='supervisor-cleanup-preflight':m.verify_supervisor(a,home,require_parent=True);m.canonical_copy(a,home,app)
elif op=='replay-after':m.lifetime_snapshot(a,home,app,'after')
elif op=='mailbox-start':event('mailbox:start-once')
elif op=='mailbox-export':
 m.private_bytes(home/'mailbox.env',b'EDIEL_SMTP_SECURE=true\\nSIM_PILOT_MAILBOX_PASSWORD=synthetic\\nNODE_EXTRA_CA_CERTS=/private/synthetic-ca\\n')
elif op=='qualify':
 assert pathlib.Path(os.environ['TEST_BACKEND']).exists();event('qualify:backend-live')
elif op=='scenario':
 assert pathlib.Path(os.environ['TEST_BACKEND']).exists();event('consumer:backend-live')
 mode=os.environ.get('TEST_CONSUMER_MODE','success')
 if mode=='failure':sys.exit(23)
 if mode=='hang':time.sleep(30)
 if mode=='index':pathlib.Path(os.environ['TEST_INDEX']).write_text('changed')
 event('consumer:done')
elif op=='actor-proof':event('actors:observed-finite-port')
else:raise RuntimeError('unexpected fixture port '+op)
'''
        (self.harness / 'hosted/qualify-runtime.py').write_text(cli)
        self.tool('git','printf "'+('1'*40)+'\\n"\n')
        self.tool('node','if [[ "${1:-}" == --version ]]; then echo v22.0.0; fi\nexit 0\n')
        self.tool('psql','exit 0\n')
        self.tool('docker','exit 0\n')
        self.tool('curl','printf 200\n')
        self.tool('openssl','printf "'+('0'*48)+'\\n"\n')
        self.tool('npm','[[ -f "$TEST_BACKEND" ]] || exit 10\nprintf "build:backend-live\\n" >> "$TEST_TRACE"\nmkdir -p .next\nprintf build > .next/BUILD_ID\nprintf "{}" > .next/build-manifest.json\n')
        self.tool('supabase','''if [[ "${1:-}" == --version ]]; then echo 2.101.0
elif [[ "${1:-}" == stop ]]; then rm -f "$TEST_BACKEND"; printf 'canonical:stop\\n' >> "$TEST_TRACE"
elif [[ "${1:-}" == status ]]; then printf '%s\\n' 'API_URL=http://127.0.0.1:55101' 'ANON_KEY=synthetic' 'SERVICE_ROLE_KEY=synthetic' 'DB_URL=postgresql://synthetic'
else exit 4; fi
''')
        next_bin = self.app / 'node_modules/.bin/next'
        next_bin.parent.mkdir(parents=True)
        next_bin.write_text('#!/bin/sh\nexit 0\n')
        next_bin.chmod(0o700)
        env = {'PATH':str(self.bin)+':'+os.environ['PATH'],'RUN_DIR':str(self.app),'SIM_HOME':str(self.home),
               'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.assignment),'SIM_PROJECT_ID':self.a['projectId'],
               'TEST_BACKEND':str(self.backend),'TEST_TRACE':str(self.trace),'TEST_INDEX':str(self.index),
               'TEST_REAL_QUALIFIER':str(HERE/'qualify-runtime.py'),**{k:str(v) for k,v in ports.items()}}
        self.env=mock.patch.dict(os.environ,env)
        self.env.start();self.addCleanup(self.env.stop)

    def tool(self,name,text):
        p=self.bin/name;p.write_text('#!/bin/bash\n'+text);p.chmod(0o700)

    def supervise(self,timeout=10):
        def git(app,*args):
            if args[0]=='ls-files':return 'INDEX_CHANGED' if self.index.exists() else 'INDEX_STABLE'
            return ''
        with mock.patch.object(module,'git',side_effect=git):
            return module.run_supervisor(['bash',str(self.up)],self.a,self.home,self.app,timeout,grace=3,observe=lambda:None)

    def test_red_child_replay_stops_backend_before_consumer(self):
        command='bash "$RUN_DIR/scripts/gridex-aud-003-clean-replay.sh"; test -f "$TEST_BACKEND"'
        result=subprocess.run(['bash','-c',command],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(self.backend.exists())
        self.assertIn('canonical:stop',self.trace.read_text())

    def test_red_noop_stop_copy_mutation_rejected_before_backend(self):
        with mock.patch.dict(os.environ,{'TEST_COPY_MUTATION':'1'}):
            with self.assertRaisesRegex(ValueError,'canonical-supervisor-consumer-or-cleanup-failed'):
                self.supervise()
        self.assertFalse(self.backend.exists())
        self.assertFalse(self.trace.exists())
        self.assertEqual(module.digest(self.canonical),self.a['canonicalReplaySHA256'])

    def test_green_real_source_shell_keeps_backend_through_consumers_then_restores(self):
        self.supervise()
        trace=self.trace.read_text().splitlines()
        self.assertLess(trace.index('consumer:done'),trace.index('canonical:stop'))
        self.assertLess(trace.index('canonical:stop'),trace.index('canonical:restore'))
        self.assertEqual(trace.count('mailbox:start-once'),1)
        self.assertFalse(self.backend.exists())
        self.assertEqual((self.home/'replay-root/supabase/seed.sql').read_text(),'original seed\n')
        self.assertEqual(module.digest(self.home/'replay-root/scripts/gridex-aud-003-clean-replay.sh'),self.a['canonicalReplaySHA256'])
        terminal=module.load_private(self.home/'supervisor-terminal.json')
        self.assertTrue(terminal['actualChildExitObserved']);self.assertTrue(terminal['sourceRestored'])
        self.assertEqual(terminal['returnCode'],0)
        self.assertNotIn('SIM_MAIL_HTTP_URL=',(self.home/'app.env').read_text())
        self.assertIn('EDIEL_SMTP_SECURE=true',(self.home/'app.env').read_text())

    def test_consumer_failure_preserves_exit_and_still_runs_original_cleanup(self):
        with mock.patch.dict(os.environ,{'TEST_CONSUMER_MODE':'failure'}):
            with self.assertRaisesRegex(ValueError,'canonical-supervisor-consumer-or-cleanup-failed'):
                self.supervise()
        terminal=module.load_private(self.home/'supervisor-terminal.json')
        self.assertEqual(terminal['returnCode'],23)
        self.assertTrue(terminal['actualChildExitObserved']);self.assertTrue(terminal['sourceRestored'])
        self.assertFalse(self.backend.exists())

    def test_bare_source_failure_keeps_errexit_and_original_exit_cleanup(self):
        with mock.patch.dict(os.environ,{'TEST_REPLAY_FAILURE':'1'}):
            with self.assertRaisesRegex(ValueError,'canonical-supervisor-consumer-or-cleanup-failed'):
                self.supervise()
        trace=self.trace.read_text()
        self.assertNotIn('ERROR-errexit-suppressed',trace)
        self.assertNotIn('consumer:',trace)
        self.assertIn('canonical:stop',trace)
        self.assertFalse(self.backend.exists())
        self.assertTrue(module.load_private(self.home/'supervisor-terminal.json')['sourceRestored'])

    def test_timeout_gracefully_observes_real_child_exit_and_restoration(self):
        with mock.patch.dict(os.environ,{'TEST_CONSUMER_MODE':'hang'}):
            with self.assertRaisesRegex(ValueError,'canonical-supervisor-deadline-or-signal'):
                self.supervise(timeout=1.5)
        terminal=module.load_private(self.home/'supervisor-terminal.json')
        self.assertTrue(terminal['actualChildExitObserved']);self.assertTrue(terminal['sourceRestored'])
        self.assertIn('consumer:backend-live',self.trace.read_text())
        self.assertNotEqual(terminal['returnCode'],0)
        self.assertFalse(self.backend.exists())

    def test_failed_source_restoration_refuses_full_cleanup_qualification(self):
        with mock.patch.dict(os.environ,{'TEST_RESTORE_FAILURE':'1'}):
            with self.assertRaisesRegex(ValueError,'canonical-source-not-restored-after-exit'):
                self.supervise()
        self.assertFalse((self.home/'supervisor-terminal.json').exists())
        self.assertNotEqual((self.home/'replay-root/supabase/seed.sql').read_text(),'original seed\n')

    def test_index_drift_is_not_accepted_as_restored_source(self):
        with mock.patch.dict(os.environ,{'TEST_CONSUMER_MODE':'index'}):
            with self.assertRaisesRegex(ValueError,'canonical-source-not-restored-after-exit'):
                self.supervise()
        self.assertFalse((self.home/'supervisor-terminal.json').exists())

    def test_late_copy_drift_cannot_reuse_terminal_restoration_receipt(self):
        self.supervise()
        (self.home/'replay-root/supabase/seed.sql').write_text('late mutation')
        with mock.patch.object(module,'git',return_value='INDEX_STABLE'):
            with self.assertRaisesRegex(ValueError,'terminal-source-restoration-drift'):
                module.require_terminal_supervisor(self.a,self.home)

    def test_cleanup_reconciles_owned_live_shell_with_real_exit_not_pass(self):
        import time
        with mock.patch.dict(os.environ,{'TEST_CONSUMER_MODE':'hang'}):
            process=subprocess.Popen(['bash',str(self.up)],start_new_session=True)
            self.addCleanup(lambda: process.poll() is None and process.kill())
            birth=module.process_identity(process.pid)
            birth.update(assignment=module.digest(self.assignment),wrapper=str(self.up),wrapperSHA256=module.digest(self.up))
            module.save_private(self.home/'supervisor-birth.json',birth)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline and (not self.trace.exists() or 'consumer:backend-live' not in self.trace.read_text()):
                time.sleep(.02)
            self.assertIn('consumer:backend-live',self.trace.read_text())
            with mock.patch.object(module,'git',return_value='INDEX_STABLE'):
                module.reconcile_supervisor(self.a,self.home,grace=3)
            process.wait(timeout=1)
        terminal=module.load_private(self.home/'supervisor-terminal.json')
        self.assertTrue(terminal['actualChildExitObserved']);self.assertTrue(terminal['sourceRestored'])
        self.assertTrue(terminal['failure'])
        self.assertEqual(terminal['observation'],'CLEANUP_RECONCILIATION_NOT_CONSUMER_ACCEPTANCE')
        self.assertFalse(self.backend.exists())


class PilotMailPolicyContracts(unittest.TestCase):
    def valid(self):
        image=json.loads((HERE/'profile.requirements.json').read_text())['pilotMailboxImage']
        return {'pilotId':'TERM02.03','scenario':'scenarios/pilot-term0203.test.ts',
                'mailCapabilities':dict(module.MAIL_CAPABILITIES),'projectId':'sim-t2-unit',
                'ports':{'SIM_DB_PORT':54322,'SIM_SMTP_PORT':55107,'SIM_MAIL_HTTP_PORT':55106},
                'pilotMailbox':{'image':image,'containerName':'sim-t2-unit-pilot-mailbox',
                    'mailboxAddress':'unit@t2.sim.invalid','ports':{'smtps':55201,'imaps':55202}}}

    def test_only_exact_pilot_mail_profile_uses_no_http_service(self):
        a=self.valid();module.require_pilot_profile(a)
        for key,value in [('pilotId','TERM02.04'),('scenario','scenarios/smoke.test.ts'),('mailCapabilities',{})]:
            bad=copy.deepcopy(a);bad[key]=value
            with self.assertRaisesRegex(ValueError,'unsupported-pilot-or-mail-capability-profile'):
                module.require_pilot_profile(bad)
        a['ports']['SIM_DB_PORT']=55102
        with self.assertRaisesRegex(ValueError,'explicit-canonical-db-port-required'):
            module.require_pilot_profile(a)

    def test_mailbox_must_use_actual_pin_and_synthetic_noncolliding_ports(self):
        a=self.valid();a['pilotMailbox']['image']='unqualified:latest'
        with self.assertRaisesRegex(ValueError,'signed-pilot-mailbox-profile-invalid'):
            module.require_pilot_profile(a)
        a=self.valid();a['pilotMailbox']['ports']['smtps']=55107
        with self.assertRaisesRegex(ValueError,'signed-mailbox-ports-invalid'):
            module.require_pilot_profile(a)

    def test_reserved_legacy_roles_refuse_foreign_listener_and_close_sockets(self):
        import socket
        opened=[]
        class Socket:
            def __init__(self):self.closed=False;opened.append(self)
            def bind(self,address):
                if address[1]==55106:raise OSError('confined occupied port')
            def close(self):self.closed=True
        with mock.patch.object(socket,'socket',side_effect=Socket):
            with self.assertRaises(OSError):module.reserved_mail_ports(self.valid())
        self.assertTrue(all(item.closed for item in opened))
        self.assertEqual(len(opened),2)

    def test_private_mail_export_preserves_merged_ca_and_requires_secure_smtp(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            a=self.valid()
            descriptor={'nodeExtraCaPath':'/private/merged-existing-proxy-and-mailbox-ca.pem',
                        'mailboxAddress':'unit@t2.sim.invalid','imap':{'password':'synthetic','secure':True},
                        'smtp':{'host':'127.0.0.1','port':55201,'user':'unit@t2.sim.invalid','password':'synthetic','secure':True}}
            with mock.patch.object(module,'authenticate',return_value=(a,home,home)), \
                    mock.patch.object(module,'mailbox_descriptor',return_value=descriptor):
                module.export_mailbox()
            text=(home/'mailbox.env').read_text()
            self.assertIn('EDIEL_SMTP_SECURE=true',text)
            self.assertIn('NODE_EXTRA_CA_CERTS=/private/merged-existing-proxy-and-mailbox-ca.pem',text)
            self.assertIn('SIM_PILOT_MAILBOX_PASSWORD=synthetic',text)
            self.assertEqual((home/'mailbox.env').stat().st_mode & 0o777,0o600)


class BootstrapContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared=tempfile.TemporaryDirectory()
        cls.keys=Path(cls.shared.name)
        cls.key=cls.keys/'root.key';cls.cert=cls.keys/'root.crt'
        module.command(['openssl','req','-newkey','rsa:4096','-x509','-noenc','-sha256','-days','1',
                        '-subj','/CN=confined-bootstrap-root','-keyout',str(cls.key),'-out',str(cls.cert)])
        cls.key.chmod(0o600)

    @classmethod
    def tearDownClass(cls):cls.shared.cleanup()

    def setUp(self):
        import hashlib
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.root.chmod(0o700)
        self.env={'RUNNER_TEMP':str(self.root),'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':module.REPOSITORY,
                  'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'777','GITHUB_JOB':'term','GITHUB_EVENT_NAME':'workflow_dispatch','SIM_BOOTSTRAP_MODE':'admitted',
                  'GITHUB_SHA':'a'*40,'GITHUB_WORKSPACE':str(self.root),'SIM_RUNTIME_ASSIGNMENT_FILE':str(self.root/'assignment.json')}
        patch=mock.patch.dict(os.environ,self.env);patch.start();self.addCleanup(patch.stop)
        self.run=module.bootstrap_run()
        self.source={'commit':'a'*40,'tree':'b'*40,'files':{'package-lock.json':'c'*64}}
        self.host={'bootId':'PRIVATE-BOOT-SENTINEL','machineId':'PRIVATE-MACHINE-SENTINEL','hostname':'PRIVATE-HOST-SENTINEL'}
        self.daemon={'driver':'overlay2','daemonId':'PRIVATE-DAEMON-SENTINEL','dockerRootDir':'/private-root',
                     'socketIdentity':{'device':1,'inode':2}}
        self.observation={**self.daemon,'effectiveRAMBytes':16*module.GIB,'dockerRootFreeBytes':50*module.GIB,'cgroupCapacity':copy.deepcopy(QUALIFIED_CGROUP),'backendCapacity':copy.deepcopy(MODEL_BACKEND),
                          'rootNamespaceVerified':True,'cpuQuota':[{'quota':'max 100000'}]}
        self.context={'runId':777,'runAttempt':1,'sourceCommit':'a'*40,'jobId':888,'checkId':'888','annotationsCount':1}
        self.requirements={'bootstrapRecipientCertificate':self.cert.read_text(),
                           'bootstrapRecipientCertificateSHA256':hashlib.sha256(self.cert.read_bytes()).hexdigest()}

    def observe(self,observation=None):
        import io
        original=Path.read_text
        def read(path,*args,**kwargs):
            if path.name=='profile.requirements.json':return json.dumps(self.requirements)
            return original(path,*args,**kwargs)
        with mock.patch.object(module,'bootstrap_source',return_value=self.source), \
             mock.patch.object(module,'bootstrap_identity',return_value=self.host), \
             mock.patch.object(module,'daemon_identity',return_value=(self.daemon,observation or self.observation)), \
             mock.patch.object(module,'docker_resources',return_value=[]),mock.patch.object(Path,'read_text',read), \
             mock.patch('sys.stdout',new_callable=io.StringIO) as console:
            try:return module.bootstrap_observe(),console.getvalue()
            finally:self.console=console.getvalue()

    def validate(self,a=None,**patches):
        a=a or {'bootstrapProofSHA256':module.digest(module.bootstrap_directory()/'proof.json'),
                'sourceCommit':'a'*40,'sourceTree':'b'*40}
        with mock.patch.object(module,'bootstrap_source',return_value=patches.get('source',self.source)), \
             mock.patch.object(module,'bootstrap_identity',return_value=patches.get('host',self.host)), \
             mock.patch.object(module,'daemon_identity',return_value=(patches.get('daemon',self.daemon),self.observation)):
            return module.validate_bootstrap(a,reobserve=True)

    def annotation(self):
        safe=module.load_private(module.bootstrap_directory()/'safe.json')
        return {'title':module.BOOTSTRAP_TITLE,'annotation_level':'notice','message':json.dumps(safe)}

    def transport(self,safe=None):
        safe=safe or module.load_private(module.bootstrap_directory()/'safe.json')
        annotations=[{'title':title,'annotation_level':'notice','message':message} for title,message in module.bootstrap_frames(safe)]
        self.context['annotationsCount']=len(annotations)
        return annotations

    def test_real_bootstrap_cms_roundtrip_keeps_host_private_and_run_bound(self):
        proof,console=self.observe()
        for secret in ('PRIVATE-BOOT-SENTINEL','PRIVATE-MACHINE-SENTINEL','PRIVATE-HOST-SENTINEL','PRIVATE-DAEMON-SENTINEL'):
            self.assertNotIn(secret,console)
        self.assertIn('CAPACITY_OBSERVED_NOT_ADMITTED',console)
        self.assertEqual(self.validate(),proof)
        output=self.root/'root-observed.json'
        with mock.patch.object(module,'delivery_get',return_value=self.transport()):
            digest=module.decrypt_bootstrap(self.context,self.key,output)
        self.assertEqual(digest,module.digest(output))
        self.assertEqual(json.loads(output.read_text()),proof)
        self.assertEqual(output.stat().st_mode & 0o777,0o600)
        self.assertEqual((module.bootstrap_directory()/'proof.json').stat().st_mode & 0o777,0o600)

    def test_capacity_hold_emits_only_encrypted_proof_without_install_or_backend(self):
        low=dict(self.observation,effectiveRAMBytes=module.GIB)
        with mock.patch.object(module,'install_dependencies') as install,mock.patch.object(module,'prime_images') as images:
            with self.assertRaisesRegex(ValueError,'bootstrap-capacity-unqualified'):self.observe(low)
        install.assert_not_called();images.assert_not_called()
        self.assertIn('CAPACITY_HOLD',self.console)
        self.assertNotIn('PRIVATE-BOOT-SENTINEL',self.console)

    def test_old_capacity_proof_is_rejected_even_with_current_matching_assignment_hash(self):
        self.observe();path=module.bootstrap_directory()/'proof.json'
        proof=module.load_private(path);proof['capacity'].pop('cgroupCapacity');path.write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError,'bootstrap-proof-not-bound-or-unqualified'):self.validate()

    def test_old_encrypted_capacity_proof_cannot_be_promoted_by_decryption(self):
        self.observe();proof=module.load_private(module.bootstrap_directory()/'proof.json')
        proof['capacity'].pop('cgroupCapacity')
        old=self.root/'legacy-proof';old.mkdir(mode=0o700)
        with self.fixture_requirements(self.requirements):cipher=module.encrypt_bootstrap(proof,old)
        safe=module.load_private(module.bootstrap_directory()/'safe.json')
        safe.update(proofSHA256=module.digest(old/'proof.json'),cmsBase64=cipher)
        output=self.root/'legacy-decrypted.json'
        with mock.patch.object(module,'delivery_get',return_value=self.transport(safe)):
            with self.assertRaisesRegex(ValueError,'bootstrap-capacity-evidence-unqualified'):
                module.decrypt_bootstrap(self.context,self.key,output)
        self.assertFalse(output.exists())

    def test_unknown_new_observation_is_hold_and_can_be_read_without_becoming_admission(self):
        unknown=dict(self.observation,effectiveRAMBytes=None,cpuQuota=None,cgroupCapacity={'state':'UNKNOWN_HOLD'})
        with self.assertRaisesRegex(ValueError,'bootstrap-capacity-unqualified'):self.observe(unknown)
        safe=module.load_private(module.bootstrap_directory()/'safe.json');self.assertEqual(safe['state'],'CAPACITY_HOLD')
        output=self.root/'unknown-observation.json'
        with mock.patch.object(module,'delivery_get',return_value=self.transport(safe)):
            module.decrypt_bootstrap(self.context,self.key,output)
        self.assertEqual(module.load_private(output)['capacity']['cgroupCapacity']['state'],'UNKNOWN_HOLD')
        with self.assertRaisesRegex(ValueError,'bootstrap-proof-not-bound-or-unqualified'):self.validate()

    def test_assignment_missing_wrong_or_tampered_host_digest_rejected(self):
        self.observe()
        for digest in (None,'d'*64):
            with self.assertRaisesRegex(ValueError,'bootstrap-proof-not-bound-or-unqualified'):
                self.validate({'bootstrapProofSHA256':digest})
        with self.assertRaisesRegex(ValueError,'bootstrap-host-or-boot-changed'):
            self.validate(host=dict(self.host,bootId='another-boot'))
        with self.assertRaisesRegex(ValueError,'bootstrap-daemon-or-capacity-changed'):
            self.validate(daemon=dict(self.daemon,daemonId='another-daemon'))
        with self.assertRaisesRegex(ValueError,'bootstrap-run-or-source-changed'):
            self.validate(source=dict(self.source,tree='e'*40))

    def test_stale_proof_and_pr_host_cannot_admit_term(self):
        self.observe();path=module.bootstrap_directory()/'proof.json';proof=module.load_private(path)
        proof['observedAt']='2020-01-01T00:00:00+00:00';path.write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError,'bootstrap-proof-stale'):self.validate()
        proof['run']['job']='bootstrap-probe';path.write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError,'bootstrap-run-or-source-changed'):self.validate()

    def test_public_digest_run_certificate_and_gcm_tamper_cannot_install_proof(self):
        import base64
        self.observe();annotation=self.annotation()
        for field,value in [('proofSHA256','f'*64),('cmsBase64',base64.b64encode(b'invalid').decode())]:
            changed=json.loads(annotation['message']);changed[field]=value
            with mock.patch.object(module,'delivery_get',return_value=self.transport(changed)):
                with self.assertRaises((ValueError,subprocess.SubprocessError)):
                    module.decrypt_bootstrap(self.context,self.key,self.root/('rejected-'+field))
            self.assertFalse((self.root/('rejected-'+field)).exists())
        changed=json.loads(annotation['message']);changed['run']['runId']=999
        with mock.patch.object(module,'delivery_get',return_value=self.transport(changed)):
            with self.assertRaisesRegex(ValueError,'bootstrap-public-run-binding-mismatch'):
                module.verify_published_bootstrap(self.context,{'bootstrapProofSHA256':'f'*64})

    def test_expired_or_substituted_root_certificate_prevents_notice(self):
        self.requirements['bootstrapRecipientCertificateSHA256']='0'*64
        with self.assertRaisesRegex(ValueError,'bootstrap-root-certificate-pin-mismatch'):self.observe()
        self.assertEqual(self.console,'')

    def test_fork_probe_refused_before_any_daemon_observation(self):
        event=self.root/'event.json';event.write_text(json.dumps({'pull_request':{'head':{'repo':{'full_name':'foreign/repo'}},
                     'base':{'repo':{'full_name':module.REPOSITORY}}}}))
        with mock.patch.dict(os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_JOB':'bootstrap-probe','GITHUB_EVENT_PATH':str(event)}), \
             mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaisesRegex(ValueError,'bootstrap-fork-forbidden'):module.bootstrap_observe()
        daemon.assert_not_called()

    def image_policy(self):
        ref='registry.invalid/owned@sha256:'+'a'*64
        return {'images':{ref:'sha256:'+'b'*64},'imageSelectors':{'registry.invalid/owned:qualified':ref},
                'provenanceSHA256':'c'*64}

    def test_real_priming_path_pulls_only_digest_then_checks_before_local_alias(self):
        policy=self.image_policy();module.bootstrap_directory().mkdir(mode=0o700)
        calls=[]
        def command(argv,**kwargs):
            calls.append(argv)
            if '--format' in argv:return 'sha256:'+'b'*64
            if argv[:3]==['docker','image','inspect']:return json.dumps([{'Id':'sha256:'+'b'*64,'RepoDigests':list(policy['images'])}])
            return ''
        def run(argv,**kwargs):calls.append(argv);return subprocess.CompletedProcess(argv,0)
        with mock.patch.object(module,'authenticate',return_value=({},None,self.root)), \
             mock.patch.object(module,'validate_bootstrap'),mock.patch.object(module,'installed_tool_receipt',return_value=policy), \
             mock.patch.object(module,'command',side_effect=command),mock.patch.object(subprocess,'run',side_effect=run):
            module.prime_images()
            with self.assertRaisesRegex(ValueError,'image-priming-budget-exceeded'):module.prime_images()
        pulls=[x for x in calls if x[:2]==['docker','pull']]
        self.assertEqual(pulls,[['docker','pull',next(iter(policy['images']))]])
        self.assertTrue((module.bootstrap_directory()/'image-priming.json').exists())
        self.assertLess(calls.index(pulls[0]),next(i for i,x in enumerate(calls) if x[:2]==['docker','tag']))

    def test_wrong_image_id_never_tags_or_records_priming_success(self):
        policy=self.image_policy();module.bootstrap_directory().mkdir(mode=0o700)
        calls=[]
        def command(argv,**kwargs):calls.append(argv);return json.dumps([{'Id':'sha256:'+'0'*64,'RepoDigests':list(policy['images'])}])
        with mock.patch.object(module,'authenticate',return_value=({},None,self.root)), \
             mock.patch.object(module,'validate_bootstrap'),mock.patch.object(module,'installed_tool_receipt',return_value=policy), \
             mock.patch.object(module,'command',side_effect=command), \
             mock.patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0)):
            with self.assertRaisesRegex(ValueError,'pulled-image-digest-or-id-mismatch'):module.prime_images()
        self.assertFalse(any(x[:2]==['docker','tag'] for x in calls))
        self.assertFalse((module.bootstrap_directory()/'image-priming.json').exists())

    def test_actual_prepare_rejects_missing_bootstrap_before_daemon_or_home_creation(self):
        a={'runDir':str(self.root)}
        home=self.root/'runtime'
        with mock.patch.object(module,'authenticate',return_value=(a,home,self.root)), \
             mock.patch.object(module,'validate_installed_materials'),mock.patch.object(module,'daemon_identity') as daemon:
            with self.assertRaises(FileNotFoundError):module.prepare_attempt()
        daemon.assert_not_called();self.assertFalse(home.exists())


    def tool_fixture(self,with_go=True):
        bins=self.root/'bin';bins.mkdir()
        versions={'node':'v22.22.0','npm':'10.9.2','supabase':'2.101.0','psql':'psql (PostgreSQL) 17.11',
                  'pg_dump':'pg_dump (PostgreSQL) 17.11'}
        for tool,version in versions.items():
            content='#!/bin/sh\n'
            if tool=='npm':content+='if [ "$1" = ci ]; then mkdir -p node_modules; echo "{}" > node_modules/.package-lock.json; echo PRIVATE-NPM-LOG-SENTINEL; exit 0; fi\n'
            content+="printf '%s\\n' '"+version+"'\n"
            file=bins/tool;file.write_text(content);file.chmod(0o700)
        lock=self.root/'package-lock.json';lock.write_text('{}')
        requirements=json.loads(Path(module.__file__).with_name('profile.requirements.json').read_text())
        tools={tool:{'version':version,'executableSHA256':module.digest(bins/tool)} for tool,version in versions.items()}
        if with_go:
            companion=bins/'supabase-go';companion.write_text('#!/bin/sh\nprintf "%s\\n" "2.101.0"\n');companion.chmod(0o700)
            tools['supabase-go']={'version':'2.101.0','executableSHA256':module.digest(companion),
                                  'canonicalFile':'adjacent-to-canonical-supabase/supabase-go'}
        requirements['qualifiedToolHashes']={tool:entry['executableSHA256'] for tool,entry in tools.items()}
        policy={'tools':tools,'packageLockSHA256':module.digest(lock),
                'images':requirements['qualifiedImagePolicy']['images'],
                'imageSelectors':requirements['qualifiedImagePolicy']['imageSelectors'],'provenanceSHA256':'a'*64}
        return bins,requirements,{'runDir':str(self.root),'sourceCommit':'a'*40,'bootstrapProofSHA256':'b'*64,'installationPolicy':policy}

    def fixture_requirements(self,requirements):
        original=Path.read_text
        def read(path,*args,**kwargs):
            if path.name=='profile.requirements.json':return json.dumps(requirements)
            return original(path,*args,**kwargs)
        return mock.patch.object(Path,'read_text',read)

    def test_go_missing_is_not_an_acceptable_frontend_only_installation(self):
        bins,requirements,a=self.tool_fixture(with_go=False)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':''}):
            with self.assertRaisesRegex(ValueError,'adjacent-supabase-go-missing'):
                module.installed_tool_receipt(a)

    def test_go_foreign_override_is_rejected_even_with_good_frontend(self):
        bins,requirements,a=self.tool_fixture(with_go=False)
        foreign=self.root/'foreign-go';foreign.write_text('#!/bin/sh\necho 2.101.0\n');foreign.chmod(0o700)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':str(foreign)}):
            with self.assertRaisesRegex(ValueError,'supabase-go-override-not-adjacent'):
                module.installed_tool_receipt(a)

    def test_go_exact_adjacent_policy_records_canonical_paths_and_accepts_exact_override(self):
        bins,requirements,a=self.tool_fixture()
        companion=bins/'supabase-go'
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':str(companion)}):
            receipt=module.installed_tool_receipt(a)
            self.assertEqual(receipt['supabaseCanonicalPath'],str((bins/'supabase').resolve()))
            self.assertEqual(receipt['supabaseGoCanonicalPath'],str(companion.resolve()))
            self.assertEqual(receipt['tools']['supabase-go'],a['installationPolicy']['tools']['supabase-go'])
            del a['installationPolicy']['tools']['supabase-go']
            with self.assertRaisesRegex(ValueError,'signed-installation-policy-mismatch'):module.installed_tool_receipt(a)

    def test_go_wrong_hash_rejected_before_executing_unqualified_companion(self):
        bins,requirements,a=self.tool_fixture();companion=bins/'supabase-go'
        companion.write_text('#!/bin/sh\necho PRIVATE-FOREIGN-GO\n')
        original=module.command;calls=[]
        def command(argv,**kwargs):calls.append(argv);return original(argv,**kwargs)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':''}), \
             mock.patch.object(module,'command',side_effect=command):
            with self.assertRaisesRegex(ValueError,'supabase-go-distribution-provenance-mismatch'):module.installed_tool_receipt(a)
        self.assertFalse(any(argv[0]==str(companion) for argv in calls))

    def test_go_old_version_rejected_even_when_bytes_match_the_constrained_test_policy(self):
        bins,requirements,a=self.tool_fixture();companion=bins/'supabase-go'
        companion.write_text('#!/bin/sh\necho 2.100.0\n')
        requirements['qualifiedToolHashes']['supabase-go']=module.digest(companion)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':''}):
            with self.assertRaisesRegex(ValueError,'supabase-go-version-mismatch'):module.installed_tool_receipt(a)

    def test_go_symlink_companion_or_alternate_override_is_rejected(self):
        bins,requirements,a=self.tool_fixture();companion=bins/'supabase-go'
        actual=self.root/'actual-go';companion.rename(actual);companion.symlink_to(actual)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':''}):
            with self.assertRaisesRegex(ValueError,'adjacent-supabase-go-missing'):module.installed_tool_receipt(a)
        companion.unlink();actual.rename(companion)
        alias=self.root/'alias-go';alias.symlink_to(companion)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':str(alias)}):
            with self.assertRaisesRegex(ValueError,'supabase-go-override-not-adjacent'):module.installed_tool_receipt(a)

    def test_go_official_distribution_pin_and_source_policy_are_complete(self):
        requirements=json.loads(Path(module.__file__).with_name('profile.requirements.json').read_text())
        self.assertEqual(requirements['qualifiedToolHashes']['supabase-go'],'9dd9e81a21074081328b77a27a8aef7be45a2828f81d99c4e1fb65efbec73947')
        self.assertEqual(requirements['toolchain']['supabaseGo'],'2.101.0')
        self.assertEqual(requirements['toolchain']['supabaseGoCanonicalFile'],'adjacent-to-canonical-supabase/supabase-go')

    def test_go_missing_blocks_dependency_install_before_npm_or_install_intent(self):
        bins,requirements,a=self.tool_fixture();(bins/'supabase-go').unlink()
        module.bootstrap_directory().mkdir(mode=0o700)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH'],'SUPABASE_GO_BINARY':''}), \
             mock.patch.object(module,'authenticate',return_value=(a,None,self.root)),mock.patch.object(module,'validate_bootstrap'):
            with self.assertRaisesRegex(ValueError,'adjacent-supabase-go-missing'):module.install_dependencies()
        self.assertFalse((self.root/'node_modules').exists())
        self.assertFalse((module.bootstrap_directory()/'installation-started.json').exists())

    def test_actual_finite_npm_install_receipt_and_one_shot_boundary(self):
        import io
        bins,requirements,a=self.tool_fixture();module.bootstrap_directory().mkdir(mode=0o700)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH']}), \
             mock.patch.object(module,'authenticate',return_value=(a,None,self.root)),mock.patch.object(module,'validate_bootstrap'), \
             mock.patch('sys.stdout',new_callable=io.StringIO) as output:
            module.install_dependencies()
            with self.assertRaisesRegex(ValueError,'dependency-install-already-attempted'):module.install_dependencies()
            receipt=module.load_private(module.bootstrap_directory()/'installation.json')
            self.assertEqual(receipt['installedLockSHA256'],module.digest(self.root/'node_modules/.package-lock.json'))
            self.assertNotIn('PRIVATE-NPM-LOG-SENTINEL',output.getvalue())
        self.assertIn('PRIVATE-NPM-LOG-SENTINEL',(module.bootstrap_directory()/'npm-ci.private.log').read_text())
        self.assertEqual((module.bootstrap_directory()/'npm-ci.private.log').stat().st_mode & 0o777,0o600)

    def test_unqualified_tool_or_incomplete_image_policy_never_runs_npm(self):
        bins,requirements,a=self.tool_fixture();module.bootstrap_directory().mkdir(mode=0o700)
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH']}), \
             mock.patch.object(module,'authenticate',return_value=(a,None,self.root)),mock.patch.object(module,'validate_bootstrap'):
            a['installationPolicy']['images']={requirements['pilotMailboxImage']:requirements['qualifiedImagePolicy']['images'][requirements['pilotMailboxImage']]}
            with self.assertRaisesRegex(ValueError,'qualified-image-selectors-and-provenance-required|complete-qualified-image-inventory-required'):
                module.install_dependencies()
            self.assertFalse((self.root/'node_modules').exists())
            a['installationPolicy']['images']=requirements['qualifiedImagePolicy']['images']
            # A signed caller-chosen hash cannot substitute source-qualified executable bytes.
            requirements['qualifiedToolHashes']['node']='0'*64
            with self.assertRaisesRegex(ValueError,'tool-distribution-provenance-mismatch'):module.install_dependencies()
            self.assertFalse((self.root/'node_modules').exists())

    def test_real_certificate_insufficient_lifetime_rejected_before_public_notice(self):
        real=module.command
        def command(argv,**kwargs):
            if argv[:2]==['openssl','x509'] and '-checkend' in argv:
                argv=list(argv);argv[argv.index('-checkend')+1]='8640000'
            return real(argv,**kwargs)
        with mock.patch.object(module,'command',side_effect=command):
            with self.assertRaises(subprocess.SubprocessError):self.observe()
        self.assertEqual(self.console,'')

    def test_gcm_ciphertext_tamper_rejected_without_private_proof_output(self):
        import base64
        self.observe();annotation=self.annotation();safe=json.loads(annotation['message'])
        ciphertext=bytearray(base64.b64decode(safe['cmsBase64']));ciphertext[-1]^=1
        safe['cmsBase64']=base64.b64encode(ciphertext).decode()
        with mock.patch.object(module,'delivery_get',return_value=self.transport(safe)):
            with self.assertRaises(subprocess.SubprocessError):module.decrypt_bootstrap(self.context,self.key,self.root/'tampered-proof')
        self.assertFalse((self.root/'tampered-proof').exists())

    def context_ports(self,pr=False):
        head='f'*40 if pr else 'a'*40
        run={'head_sha':head,'run_attempt':1,'event':'pull_request' if pr else 'workflow_dispatch',
             'path':'.github/workflows/t2-term-disposable.yml'}
        commit={'sha':'a'*40,'tree':{'sha':'b'*40},'parents':[{'sha':head}]}
        job={'id':888,'name':'bootstrap-probe' if pr else 'term','run_id':777,'run_attempt':1,'head_sha':head,
             'check_run_url':'https://api.github.com/repos/'+module.REPOSITORY+'/check-runs/888'}
        check={'app':{'slug':'github-actions'},'head_sha':head,
               'details_url':'https://github.com/'+module.REPOSITORY+'/actions/runs/777/job/888',
               'output':{'annotations_count':1}}
        return [run,commit,{'total_count':1,'jobs':[job]},check]

    def test_root_api_consumer_distinguishes_pr_head_merge_and_real_term_provenance(self):
        for pr in (False,True):
            with self.subTest(pr=pr),mock.patch.object(module,'delivery_get',side_effect=self.context_ports(pr)):
                context=module.bootstrap_context(777,'a'*40,'bootstrap-probe' if pr else 'term')
            self.assertEqual(context['checkoutTree'],'b'*40)
            self.assertEqual(context['workflowHeadCommit'],('f' if pr else 'a')*40)
        ports=self.context_ports(True);ports[1]['parents']=[{'sha':'0'*40}]
        with mock.patch.object(module,'delivery_get',side_effect=ports):
            with self.assertRaisesRegex(ValueError,'bootstrap-checkout-head-mismatch'):
                module.bootstrap_context(777,'a'*40,'bootstrap-probe')
        ports=self.context_ports();ports[-1]['app']['slug']='another-app'
        with mock.patch.object(module,'delivery_get',side_effect=ports):
            with self.assertRaisesRegex(ValueError,'bootstrap-check-provenance-mismatch'):
                module.bootstrap_context(777,'a'*40,'term')

    def test_actual_prepare_rejects_installation_receipt_drift_before_resource_allocation(self):
        self.observe();bins,requirements,a=self.tool_fixture()
        a['bootstrapProofSHA256']=module.digest(module.bootstrap_directory()/'proof.json')
        a['sourceTree']='b'*40
        installed=self.root/'node_modules';installed.mkdir();(installed/'.package-lock.json').write_text('{}')
        with self.fixture_requirements(requirements),mock.patch.dict(os.environ,{'PATH':str(bins)+':'+os.environ['PATH']}):
            receipt=module.installed_tool_receipt(a)
            receipt['installedLockSHA256']='0'*64
            module.save_private(module.bootstrap_directory()/'installation.json',receipt)
            with mock.patch.object(module,'authenticate',return_value=(a,self.root/'runtime',self.root)), \
                 mock.patch.object(module,'validate_installed_materials'),mock.patch.object(module,'bootstrap_source',return_value=self.source), \
                 mock.patch.object(module,'bootstrap_identity',return_value=self.host), \
                 mock.patch.object(module,'daemon_identity',return_value=(self.daemon,self.observation)), \
                 mock.patch.object(module,'docker_resources') as resources:
                with self.assertRaisesRegex(ValueError,'installed-tool-or-dependency-receipt-changed'):module.prepare_attempt()
            resources.assert_not_called()
        self.assertFalse((self.root/'runtime').exists())

    def test_pr_or_bootstrap_only_public_proof_cannot_be_used_for_admitted_delivery(self):
        self.observe();safe=module.load_private(module.bootstrap_directory()/'safe.json')
        safe['run']['mode']='bootstrap'
        with mock.patch.object(module,'delivery_get',return_value=self.transport(safe)):
            with self.assertRaisesRegex(ValueError,'delivery-bootstrap-binding-mismatch'):
                module.verify_published_bootstrap(self.context,{'bootstrapProofSHA256':safe['proofSHA256']})
        safe['run'].update(mode='pr-probe',event='pull_request',job='bootstrap-probe')
        with mock.patch.object(module,'delivery_get',return_value=self.transport(safe)):
            with self.assertRaisesRegex(ValueError,'bootstrap-public-run-binding-mismatch'):
                module.verify_published_bootstrap(self.context,{'bootstrapProofSHA256':safe['proofSHA256']})

    def test_actual_4096_byte_annotation_clipping_red_then_framed_green_roundtrip(self):
        # Finite realistic larger source vector reproduces the observed GitHub message clipping.
        self.source['files'].update({'owned-source-'+str(i):'e'*64 for i in range(45)})
        proof,console=self.observe();legacy=self.annotation()['message']
        self.assertGreater(len(legacy.encode()),4096)
        clipped=legacy.encode()[:4096].decode()
        with self.assertRaises(ValueError):module.strict_transport_json(clipped)
        annotations=[]
        for line in console.splitlines():
            prefix,message=line.split('::',2)[1:]
            title=prefix.removeprefix('notice title=')
            self.assertLessEqual(len(message.encode()),3500)
            annotations.append({'title':title,'annotation_level':'notice','message':message.encode()[:4096].decode()})
        self.assertGreater(len(annotations),2)
        self.context['annotationsCount']=len(annotations)
        with mock.patch.object(module,'delivery_get',return_value=list(reversed(annotations))):
            output=self.root/'real-transport-proof.json';module.decrypt_bootstrap(self.context,self.key,output)
        self.assertEqual(json.loads(output.read_text()),proof)
        self.assertEqual(module.digest(output),json.loads(annotations[0]['message'])['proofSHA256'])

    def test_missing_duplicate_wrong_index_and_inventory_never_reach_decrypt(self):
        self.observe();frames=self.transport()
        wrong=json.loads(frames[1]['message']);wrong['index']=999
        duplicate=[frames[0],frames[1],frames[1]]+frames[2:]
        cases=[frames[:-1],duplicate,[frames[0],dict(frames[1],message=json.dumps(wrong))]+frames[2:]]
        for index,annotations in enumerate(cases):
            with self.subTest(index=index):
                self.context['annotationsCount']=len(annotations)
                with mock.patch.object(module,'delivery_get',return_value=annotations),mock.patch.object(module,'command') as decrypt:
                    with self.assertRaises(ValueError):module.decrypt_bootstrap(self.context,self.key,self.root/('missing-'+str(index)))
                decrypt.assert_not_called()
        self.context['annotationsCount']=len(frames)+1
        with mock.patch.object(module,'delivery_get',return_value=frames):
            with self.assertRaisesRegex(ValueError,'bootstrap-annotations-incomplete'):module.published_bootstrap(self.context)

    def test_tampered_chunk_cross_run_and_header_binding_are_rejected(self):
        self.observe();frames=self.transport();header=json.loads(frames[0]['message'])
        changed=json.loads(frames[1]['message']);changed['data']=('A' if changed['data'][0]!='A' else 'B')+changed['data'][1:]
        with self.assertRaisesRegex(ValueError,'bootstrap-reassembled-cipher-mismatch'):
            module.reassemble_bootstrap([frames[0],dict(frames[1],message=json.dumps(changed))]+frames[2:])
        safe=module.load_private(module.bootstrap_directory()/'safe.json');safe['run']['runId']=999
        other=self.transport(safe)
        with self.assertRaisesRegex(ValueError,'bootstrap-chunk-binding-or-index-invalid'):
            module.reassemble_bootstrap([frames[0],other[1]]+frames[2:])
        header['proofSHA256']='0'*64
        with self.assertRaisesRegex(ValueError,'bootstrap-chunk-binding-or-index-invalid'):
            module.reassemble_bootstrap([dict(frames[0],message=json.dumps(header))]+frames[1:])

    def test_oversized_legacy_or_frame_and_cipher_budgets_fail_closed(self):
        import base64
        self.observe();safe=module.load_private(module.bootstrap_directory()/'safe.json');frames=self.transport()
        with self.assertRaises(ValueError):module.reassemble_bootstrap([self.annotation()])
        oversized=dict(frames[1],message=frames[1]['message']+' '*3501)
        with self.assertRaisesRegex(ValueError,'bootstrap-framed-notice-invalid'):
            module.reassemble_bootstrap([frames[0],oversized]+frames[2:])
        safe['cmsBase64']=base64.b64encode(b'x'*24576).decode()
        with self.assertRaisesRegex(ValueError,'bootstrap-proof-too-large'):module.bootstrap_frames(safe)
        self.context['annotationsCount']=101
        with mock.patch.object(module,'delivery_get',return_value=frames):
            with self.assertRaisesRegex(ValueError,'bootstrap-annotations-incomplete'):module.published_bootstrap(self.context)

    def test_all_frames_checked_before_any_notice_is_printed(self):
        huge=dict(self.run,unsafeExtra='x'*3600)
        with mock.patch.object(module,'bootstrap_run',return_value=huge):
            with self.assertRaisesRegex(ValueError,'bootstrap-frame-budget-exceeded'):self.observe()
        self.assertEqual(self.console,'')

class WorkflowRunnerContextContracts(unittest.TestCase):
    def workflow_term(self):
        return Path(module.__file__).parents[4].joinpath('.github/workflows/t2-term-disposable.yml').read_text().split('  term:\n',1)[1]

    def binding_script(self):
        term=self.workflow_term()
        first=term.split('    steps:\n',1)[1].split('      - uses:',1)[0]
        self.assertIn('Bind private runtime paths from actual runner process environment',first)
        return '\n'.join(line[10:] for line in first.split('        run: |\n',1)[1].splitlines())+'\n'

    def test_job_environment_uses_only_contexts_supported_by_github_actions(self):
        import re
        term=self.workflow_term();job_env=term.split('    env:\n',1)[1].split('    steps:\n',1)[0]
        # Actual GitHub schema RED: jobs.<job_id>.env does not allow runner context.
        self.assertNotRegex(job_env,r'\$\{\{\s*runner\.')
        for key in ('SIM_RUNTIME_ASSIGNMENT_FILE:','SIM_HOME:','RUN_DIR:'):
            self.assertNotIn(key,job_env)
        self.assertLess(term.index('Bind private runtime paths'),term.index('actions/checkout@'))

    def test_actual_first_step_exports_real_paths_and_missing_runner_inputs_fail_closed(self):
        script=self.binding_script()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);runner=root/'actual runner';workspace=root/'actual workspace'
            runner.mkdir();workspace.mkdir();envfile=root/'environment';envfile.touch()
            env=dict(os.environ,RUNNER_TEMP=str(runner),GITHUB_WORKSPACE=str(workspace),GITHUB_ENV=str(envfile))
            result=subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(envfile.read_text(),'SIM_RUNTIME_ASSIGNMENT_FILE='+str(runner)+'/t2-admission.json\nSIM_HOME='+str(runner)+'/t2-runtime\nRUN_DIR='+str(workspace)+'\n')
            self.assertEqual(result.stdout,'')
            for missing in ('RUNNER_TEMP','GITHUB_WORKSPACE','GITHUB_ENV'):
                with self.subTest(missing=missing):
                    envfile.write_text('');bad=dict(env);bad.pop(missing)
                    failed=subprocess.run(['bash','-c',script],env=bad,capture_output=True,text=True)
                    self.assertNotEqual(failed.returncode,0)
                    self.assertEqual(envfile.read_text(),'')


class BackendBridgeContracts(unittest.TestCase):
    def fixture(self):
        witness = {'schema':'gridex-t2-shared-backend-capacity-v1','state':'VERIFIED','errors':[],
                   'docker':{'id':'unit-daemon','rootDir':'/unit/docker'},
                   'socket':{'activation':'direct','filesystem':{'device':1,'inode':2}},
                   'process':{'pid':42,'startTicks':123,'effectiveUID':0,'executable':'/usr/bin/dockerd',
                              'namespaces':{'mnt':'mnt:[1]','pid':'pid:[2]','net':'net:[3]'}},
                   'backend':{'effectiveRAMBytes':8*module.GIB}}
        info = {'ID':'unit-daemon','Driver':'overlay2','DockerRootDir':'/unit/docker'}
        calls = []
        def command(argv, **kwargs):
            calls.append(argv)
            if argv == ['docker','context','show']: return 'default'
            if argv[:3] == ['docker','context','inspect']: return json.dumps('unix:///var/run/docker.sock')
            if argv[:2] == ['docker','info']: return json.dumps(info)
            if argv[-1] == '--daemon': return json.dumps(witness)
            if argv[:4] == ['sudo','-n','python3','-c']: return str(50*module.GIB)
            raise AssertionError('undeclared external port')
        return witness, info, command, calls

    def observe(self, witness, command, admit):
        import types
        with mock.patch.dict(os.environ, DOCKER_HOST='unix:///var/run/docker.sock', DOCKER_CONTEXT=''), \
                mock.patch.object(module,'command',side_effect=command), \
                mock.patch.object(module,'observe_host',return_value=dict(QUALIFIED_TEST_CAPACITY,effectiveRAMBytes=16*module.GIB)), \
                mock.patch.object(Path,'is_dir',return_value=True), mock.patch.object(Path,'is_symlink',return_value=False), \
                mock.patch.object(Path,'stat',return_value=types.SimpleNamespace(st_dev=1,st_ino=2)), \
                mock.patch.object(module.os,'readlink',side_effect=lambda path:witness['process']['namespaces'][path.rsplit('/',1)[1]]):
            return module.daemon_identity(capacity=admit)

    def test_measured_backend_witness_is_used_in_actual_admission_bridge(self):
        witness, info, command, calls = self.fixture()
        identity, observation = self.observe(witness, command, True)
        self.assertEqual(observation['effectiveRAMBytes'],8*module.GIB)
        self.assertEqual(identity['daemonProcess']['pid'],42)
        self.assertEqual(observation['backendCapacity'],witness)
        self.assertTrue(any(argv[-1] == '--daemon' for argv in calls))

    def test_low_shared_budget_rejects_admission_but_passive_diagnostics_survive(self):
        witness, info, command, calls = self.fixture()
        witness['backend']['effectiveRAMBytes'] = 2*module.GIB
        witness.update(state='UNKNOWN_HOLD',errors=['shared-backend-ram-below-minimum'])
        with self.assertRaisesRegex(ValueError,'host-capacity-unqualified'):
            self.observe(witness, command, True)
        identity, observation = self.observe(witness, command, False)
        self.assertEqual(observation['effectiveRAMBytes'],2*module.GIB)
        self.assertEqual(observation['backendCapacity']['errors'],['shared-backend-ram-below-minimum'])

    def test_other_daemon_api_identity_cannot_qualify_filesystem_namespace(self):
        witness, info, command, calls = self.fixture()
        witness['docker']['id'] = 'alternate-daemon'
        with self.assertRaisesRegex(ValueError,'host-capacity-unqualified'):
            self.observe(witness, command, True)
        self.assertFalse(any(argv[:4] == ['sudo','-n','python3','-c'] for argv in calls))


    def test_current_backend_rejects_process_or_shared_parent_drift(self):
        import copy
        witness, _, _, _ = self.fixture()
        identity = {'daemonId':'unit-daemon','daemonProcess':{'pid':42,'startTicks':123}}
        attempt = {'daemon':identity,'host':{'backendCapacity':witness}}
        with mock.patch.object(module,'load_private',return_value=attempt):
            with mock.patch.object(module,'daemon_identity',return_value=(identity,{'backendCapacity':witness})):
                self.assertEqual(module.current_backend_capacity(Path('/unit')),witness)
            changed = copy.deepcopy(witness); changed['backend']['globalParent'] = '/different'
            for current_identity, current in ((identity,changed), ({'daemonId':'replacement'},witness)):
                with self.subTest(current=current), mock.patch.object(module,'daemon_identity',return_value=(current_identity,{'backendCapacity':current})):
                    with self.assertRaisesRegex(ValueError,'backend-capacity-mapping-changed'):
                        module.current_backend_capacity(Path('/unit'))


class NativePushContracts(unittest.TestCase):
    branch = 'codex/t2-native-00000000-0000-4000-8000-000000000001'

    def environment(self, branch):
        return {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': module.REPOSITORY,
                'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_JOB': 'term',
                'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': 'a'*40,
                'GITHUB_REF_NAME': branch, 'SIM_BOOTSTRAP_MODE': 'admitted'}

    def test_native_push_observation_binds_actual_uuid_branch_without_grant(self):
        with mock.patch.dict(os.environ, self.environment(self.branch)):
            context = module.bootstrap_run()
        self.assertEqual(context['event'], 'push')
        self.assertEqual(context['headBranch'], self.branch)
        self.assertEqual(context['mode'], 'admitted')
        self.assertNotIn('state', context)  # Invocation identity is not an ACTIVE assignment.

    def test_other_push_branches_or_modes_never_enter_native_context(self):
        for branch in ('main', 'codex/t2-native-not-uuid', self.branch+'-extra'):
            with self.subTest(branch=branch), mock.patch.dict(os.environ, self.environment(branch)):
                with self.assertRaises(ValueError): module.bootstrap_run()
        env = self.environment(self.branch); env['SIM_BOOTSTRAP_MODE'] = 'bootstrap'
        with mock.patch.dict(os.environ, env), self.assertRaises(ValueError): module.bootstrap_run()


if __name__ == '__main__':
    unittest.main(verbosity=2)
