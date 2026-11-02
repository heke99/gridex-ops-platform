"""Finite authority/budget ports; no GitHub request or Docker command."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import urllib.error
from unittest.mock import patch


def load():
    spec = importlib.util.spec_from_file_location('profile', Path(__file__).with_name('hosted-profile.py'))
    unit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(unit)
    return unit


class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.unit = load()
        self.plan = {'epoch': 'synthetic-authority-test', 'inputEpoch': 'synthetic-input', 'appCommit': 'a' * 40,
                     'harnessCommit': 'b' * 40, 'projectId': 'synthetic-t3',
                     'environment': 'test', 'environmentId': 't3-synthetic',
                     'ports': {'api': 54321, 'db': 54322, 'app': 3103, 'smtp': 3125, 'imapPlain': 3143, 'imapTls': 3993, 'control': 3199},
                     'greenmailImage': 'greenmail/standalone@sha256:' + '1' * 64, 'reviewerCertificateSha256': '2' * 64,
                     'consumer': {'path': 'scripts/simulation/track3/hosted-consumer.py', 'sha256': '3' * 64},
                     'schemaEpoch': 'synthetic-schema', 'execution': {'purpose': 'ediel03_physical',
                         'scenarioFile': 'scenarios/ediel03-03.test.ts', 'scenarioSha256': 'd' * 64},
                     'expiresAtUtc': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
        self.identity = {'GITHUB_REPOSITORY': 'synthetic/repository', 'GITHUB_REF': 'refs/heads/synthetic-branch',
            'event': {'name': 'workflow_dispatch', 'ref': 'refs/heads/synthetic-branch', 'sourceSha': 'b' * 40,
                      'createOnly': False, 'triggerActor': 'synthetic-maintainer'}}
        self.receipt = {'protocol': 'masterplan-reservation-v1', 'agent': 'synthetic-agent', 'epoch': self.plan['epoch'],
            'source': self.plan['appCommit'], 'packet': 'synthetic-packet', 'slot': 'synthetic-slot',
            'checkpoint': 'private-test-only', 'branch': 'synthetic-branch',
            'runtimeAuthorization': {'roles': ['producer'], 'track': 'T3', 'inputEpoch': self.plan['inputEpoch'],
             'attemptBudget': 1, 'exclusiveHost': True, 'workflow': self.unit.WORKFLOW,
             'harnessCommit': self.plan['harnessCommit'], 'repository': 'synthetic/repository',
             'projectId': self.plan['projectId'], 'execution': deepcopy(self.plan['execution']),
             'environment': self.plan['environment'], 'environmentId': self.plan['environmentId'],
             'ports': deepcopy(self.plan['ports']), 'greenmailImage': self.plan['greenmailImage'],
             'reviewerCertificateSha256': self.plan['reviewerCertificateSha256'],
             'consumer': deepcopy(self.plan['consumer']),
             'event': deepcopy(self.identity['event']),
             'schemaEpoch': self.plan['schemaEpoch'], 'expiresAtUtc': self.plan['expiresAtUtc']}}

    def validate(self, receipt):
        self.unit.validate_authority(receipt, 'producer', self.plan, self.identity, 'synthetic-agent')

    def test_explicit_full_runtime_authority_matches(self):
        self.validate(self.receipt)

    def test_public_source_only_receipt_cannot_allocate_runtime(self):
        with self.assertRaises(ValueError):
            self.validate({'base': 'c' * 40, 'files': ['owned-source.py'], 'operation': 'd' * 64})

    def test_full_receipt_without_runtime_authorization_is_not_native_authority(self):
        receipt = deepcopy(self.receipt)
        del receipt['runtimeAuthorization']
        with self.assertRaises(ValueError):
            self.validate(receipt)

    def test_wrong_source_role_epoch_scope_budget_or_expiry_hold(self):
        changes = [('roles', ['backend']), ('inputEpoch', 'other-input'), ('attemptBudget', 2), ('attemptBudget', True),
                   ('exclusiveHost', False), ('execution', {'purpose': 'controlled_issuer_underlay'}), ('repository', 'foreign/repository'),
                   ('schemaEpoch', 'another-migration-epoch'),
                   ('harnessCommit', 'c' * 40), ('expiresAtUtc', '2000-01-01T00:00:00Z')]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                receipt = deepcopy(self.receipt)
                receipt['runtimeAuthorization'][key] = value
                with self.assertRaises(ValueError):
                    self.validate(receipt)

    def test_producer_cannot_satisfy_separate_backend_role(self):
        with self.assertRaises(ValueError):
            self.unit.validate_authority(self.receipt, 'backend', self.plan, self.identity, 'synthetic-agent')


class BudgetTests(unittest.TestCase):
    def test_actual_http_port_records_unknown_without_retry_or_token_in_receipt(self):
        unit = load()
        api = unit.GitHub('synthetic/repository', 'SYNTHETIC_FINITE_TOKEN_NOT_A_CREDENTIAL')
        api.opener = SimpleNamespace(open=lambda *_args, **_kwargs: (_ for _ in ()).throw(urllib.error.URLError('finite lost response')))
        with self.assertRaises(ValueError):
            unit.consume_attempt(api, 'a' * 40, 'synthetic')
        self.assertEqual(len(api.events), 1)
        self.assertEqual(api.events[0]['status'], 'UNKNOWN')
        self.assertNotIn('SYNTHETIC_FINITE_TOKEN', json.dumps(api.events))
    def test_same_authority_input_has_one_global_budget_across_hosts(self):
        unit = load()
        calls = []
        class API:
            def call(self, path, method='GET', body=None):
                calls.append((method, path, body))
                return {'ref': unit.attempt_ref('a' * 40, 'synthetic'), 'object': {'sha': 'a' * 40}}
        ref = unit.consume_attempt(API(), 'a' * 40, 'synthetic')
        self.assertRegex(ref, r'^refs/tags/agent-claims/masterplan/runtime-attempt-[a-f0-9]{64}$')
        self.assertNotIn('synthetic', ref)
        self.assertEqual([x[0] for x in calls], ['POST', 'GET'])
        self.assertEqual(calls[0][2], {'ref': ref, 'sha': 'a' * 40})

    def test_collision_or_unknown_create_never_gets_mutation_retry_or_match_healing(self):
        unit = load()
        calls = []
        class API:
            def call(self, path, method='GET', body=None):
                calls.append(method)
                raise ValueError('finite simulated 422 or unknown network outcome')
        with self.assertRaises(ValueError):
            unit.consume_attempt(API(), 'a' * 40, 'synthetic')
        self.assertEqual(calls, ['POST'])

    def test_failed_readback_holds_without_another_create(self):
        unit = load()
        calls = []
        class API:
            def call(self, path, method='GET', body=None):
                calls.append(method)
                if method == 'POST':
                    return {'ref': unit.attempt_ref('a' * 40, 'synthetic'), 'object': {'sha': 'a' * 40}}
                return {'ref': 'foreign', 'object': {'sha': 'b' * 40}}
        with self.assertRaises(ValueError):
            unit.consume_attempt(API(), 'a' * 40, 'synthetic')
        self.assertEqual(calls, ['POST', 'GET'])


class PrivateNativeCapsuleTests(unittest.TestCase):
    setUp = AuthorityTests.setUp
    def test_neutral_public_body_only_activates_with_complete_private_authority_and_native_refs(self):
        unit = self.unit
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'authority').mkdir(mode=0o700)
            plan = {**self.plan, 'appTree': 'c' * 40, 'harnessTree': 'd' * 40, 'simHome': str(home)}
            source = {key: plan[key] for key in ['appCommit', 'appTree', 'harnessCommit', 'harnessTree']}
            def original(name, data):
                file = home / 'authority' / name
                file.write_bytes(data)
                return {'name': name, 'sha256': unit.hash_bytes(data)}
            capsule = deepcopy(self.receipt)
            refs = {'producer': 'refs/tags/agent-claims/masterplan/producer-synthetic-native',
                    'backend': 'refs/tags/agent-claims/masterplan/backend-synthetic-private'}
            packet_id = '00000000-0000-4000-8000-000000000001'
            capsule.update(base='e' * 40, files=[], packet=packet_id, slot='session-' + packet_id, ids=[],
                           createdAt=datetime.now(timezone.utc).isoformat(),
                           resources=sorted([*refs.values(), 'refs/tags/agent-claims/masterplan/slot-session-' + packet_id]), authors=['synthetic-author'])
            capsule['runtimeAuthorization'].update(roles=['backend', 'producer'], roleRefs=refs)
            capsule['userNativeMandate'] = {**original('mandate.txt', b'SYNTHETIC FINITE MANDATE PORT; NOT ACTUAL AUTHORIZATION'),
                                           'scope': 'T3_CONTROLLED_SYNTHETIC_NATIVE_TESTDATA'}
            capsule['independentReviews'] = [{**original('review' + str(i) + '.txt', b'SYNTHETIC FINITE REVIEW PORT'),
                'agent': 'synthetic-reviewer-' + str(i), 'decision': 'APPROVE_SOURCE_ONLY', 'source': source,
                'executionSha256': unit.canonical_hash(plan['execution'])} for i in [1, 2]]
            raw = json.dumps(capsule).encode()
            original('capsule.json', raw)
            digest, target = unit.hash_bytes(raw), 'f' * 40
            capsule_ref = 'refs/tags/agent-claims/masterplan/runtime-authority-' + digest
            bindings = {role: {'ref': ref, 'sha': target, 'agent': capsule['agent'], 'capsuleName': 'capsule.json',
                        'capsuleSha256': digest, 'capsuleRef': capsule_ref} for role, ref in refs.items()}
            profile = {'authorities': bindings}
            resources = sorted(capsule['resources'] + [capsule_ref])
            plan.update(producerReservation=target, backendReservation=target,
                        reservationRefs=[{'ref': ref, 'sha': target} for ref in resources])
            public = {'base': capsule['base'], 'files': [],
                      'operation': 'Reserve runtime producer and backend; resources-sha256=' + unit.hash_bytes('\n'.join(resources).encode())}
            calls = []
            class API:
                wrong_operation = False
                partial = False
                def call(self, path):
                    calls.append(path)
                    if path == '/git/commits/' + target:
                        body = dict(public, operation='Reserve source files and rule IDs') if self.wrong_operation else public
                        return {'message': json.dumps(body), 'parents': [{'sha': capsule['base']}], 'tree': {'sha': '1' * 40}}
                    if path == '/git/commits/' + capsule['base']:
                        return {'tree': {'sha': '1' * 40}}
                    ref = 'refs/' + path.removeprefix('/git/ref/')
                    return {'ref': ref, 'object': {'type': 'commit', 'sha': '2' * 40 if self.partial and ref == refs['backend'] else target}}
            prepare = SimpleNamespace(private=lambda path: Path(path))
            unit.read_authorities(profile, plan, self.identity, API(), prepare)
            api = API(); api.wrong_operation = True
            with self.assertRaises(ValueError):
                unit.read_authorities(profile, plan, self.identity, api, prepare)
            api = API(); api.partial = True
            with self.assertRaises(ValueError):
                unit.read_authorities(profile, plan, self.identity, api, prepare)
            (home / 'authority/review1.txt').write_bytes(b'changed finite approval original')
            with self.assertRaises(ValueError):
                unit.read_authorities(profile, plan, self.identity, API(), prepare)
            self.assertFalse(any('runtimeAuthorization' in json.dumps(public) for _ in [0]))


class BootstrapFailStopTests(unittest.TestCase):
    def test_failed_capacity_admission_cannot_reach_budget_tools_or_shell(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / 'profile.json'
            profile.write_text('{}')
            prepare = SimpleNamespace(private=lambda path: Path(path))
            with patch.object(unit, 'load', return_value=prepare), patch.object(unit, 'hosted_identity', return_value={}), \
                 patch.object(unit, 'preflight', side_effect=ValueError('actual_docker_root_capacity_failed')), \
                 patch.object(unit, 'GitHub') as api, patch.object(unit, 'locked_tools') as tools:
                with self.assertRaisesRegex(ValueError, 'capacity_failed'):
                    unit.main(['execute', '--profile', str(profile)])
                api.assert_not_called()
                tools.assert_not_called()

    def test_unknown_budget_consumption_never_reaches_tool_install_or_native_shell(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            profile = home / 'profile.json'
            profile.write_text(json.dumps({'authorities': {'producer': {'sha': 'a' * 40}}}))
            prepare = SimpleNamespace(private=lambda path: Path(path), same_host=lambda *_: None,
                                      host_identity=lambda: {}, bounded_timeout=lambda *_: 1)
            packet = SimpleNamespace(home=home, host={}, transport={}, plan={'inputEpoch': 'synthetic', 'sameShellTimeoutSeconds': 1}, expires=datetime.now(timezone.utc) + timedelta(minutes=5))
            api = SimpleNamespace(events=[{'status': 'UNKNOWN'}])
            with patch.object(unit, 'load', return_value=prepare), patch.object(unit, 'hosted_identity', return_value={'GITHUB_REPOSITORY': 'synthetic/repository'}), \
                 patch.object(unit, 'preflight', return_value=(packet, (), {})), patch.object(unit, 'GitHub', return_value=api), \
                 patch.object(unit, 'observed_job', return_value={}), patch.object(unit, 'admit_job_deadline'), patch.object(unit, 'read_authorities'), patch.object(unit, 'consume_attempt', side_effect=ConnectionError('finite unknown result')), \
                 patch.object(unit, 'locked_tools') as tools:
                with self.assertRaises(ConnectionError):
                    unit.main(['execute', '--profile', str(profile)])
                tools.assert_not_called()
                self.assertTrue((home / 'execution-intent.json').is_file())
                self.assertEqual(json.loads((home / 'attempt-api.json').read_text()), api.events)
                with self.assertRaises(FileExistsError):
                    unit.main(['execute', '--profile', str(profile)])

    def test_actual_run_api_mismatch_cannot_be_replaced_by_matching_environment_strings(self):
        unit = load()
        identity = {'GITHUB_RUN_ID': '123', 'GITHUB_SHA': 'a' * 40, 'GITHUB_REPOSITORY': 'synthetic/repository',
                    'GITHUB_WORKFLOW_REF': 'synthetic/repository/' + unit.WORKFLOW + '@refs/heads/synthetic',
                    'GITHUB_JOB': 'physical-e03', 'RUNNER_NAME': 'synthetic-runner', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                    'GITHUB_ACTOR': 'synthetic-maintainer'}
        run = {'id': 123, 'head_sha': 'a' * 40, 'event': 'workflow_dispatch', 'run_attempt': 1, 'path': unit.WORKFLOW,
               'status': 'in_progress', 'repository': {'full_name': 'synthetic/repository'},
               'head_repository': {'full_name': 'synthetic/repository'}, 'head_branch': 'synthetic',
               'actor': {'login': 'synthetic-maintainer'}, 'triggering_actor': {'login': 'synthetic-maintainer'}}
        job = {'name': 'physical-e03', 'status': 'in_progress', 'runner_name': 'synthetic-runner', 'runner_id': 456, 'labels': ['ubuntu-24.04']}
        def api(observed_run, observed_job):
            return SimpleNamespace(call=lambda path: {'total_count': 1, 'jobs': [observed_job]} if path.endswith('/jobs') else observed_run)
        unit.observed_job(identity, api(run, job))
        for changed in [dict(run, head_sha='b' * 40), dict(run, event='push'), dict(run, run_attempt=2), dict(run, path='foreign-workflow.yml')]:
            with self.assertRaises(ValueError):
                unit.observed_job(identity, api(changed, job))
        with self.assertRaises(ValueError):
            unit.observed_job(identity, api(run, dict(job, runner_name='foreign-runner')))

    def test_plan_expiry_cannot_outlive_host_cleanup_window(self):
        unit = load()
        started = datetime.now(timezone.utc)
        job = {'job': {'started_at': started.isoformat()}}
        unit.admit_job_deadline(job, started + timedelta(minutes=60))
        for expiry in [started + timedelta(minutes=91), started - timedelta(seconds=1)]:
            with self.assertRaises(ValueError):
                unit.admit_job_deadline(job, expiry)

    def test_actual_create_only_push_payload_cannot_be_replaced_by_update_force_or_other_publisher(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'event.json'
            ref = 'refs/heads/codex/t3-native-00000000-0000-4000-8000-000000000001'
            env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
                'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '123',
                'GITHUB_REPOSITORY': 'synthetic/repository', 'GITHUB_REF': ref, 'GITHUB_ACTOR': 'synthetic-maintainer',
                'GITHUB_EVENT_PATH': str(path), 'GITHUB_WORKFLOW_REF': 'synthetic/repository/' + unit.WORKFLOW + '@' + ref,
                'GITHUB_JOB': 'physical-e03', 'RUNNER_NAME': 'synthetic-runner'}
            payload = {'created': True, 'forced': False, 'deleted': False, 'before': '0' * 40, 'after': env['GITHUB_SHA'], 'ref': ref,
                       'repository': {'full_name': env['GITHUB_REPOSITORY']}, 'sender': {'login': env['GITHUB_ACTOR']}}
            with patch.object(Path, 'read_text', return_value='ID=ubuntu\nVERSION_ID="24.04"\n'):
                path.write_bytes(json.dumps(payload).encode())
                self.assertTrue(unit.hosted_identity(env)['event']['createOnly'])
                for changed in [dict(payload, created=False), dict(payload, forced=True), dict(payload, before='b' * 40),
                                dict(payload, after='b' * 40), dict(payload, sender={'login': 'foreign'})]:
                    path.write_bytes(json.dumps(changed).encode())
                    with self.assertRaises(ValueError):
                        unit.hosted_identity(env)
                with self.assertRaises(ValueError):
                    unit.hosted_identity(dict(env, GITHUB_REF='refs/heads/codex/t3-normal-source'))


class OwnedNetworkTests(unittest.TestCase):
    def test_real_create_argv_has_explicit_loopback_option_and_no_supabase_cleanup_label(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            packet = SimpleNamespace(home=Path(directory), host={'socket': '/synthetic/docker.sock'}, node='/synthetic/node',
                plan={'producerReservation': 'a' * 40, 'inputEpoch': 'synthetic', 'environmentId': 't3-synthetic'})
            calls = []
            def capture(argv, env):
                calls.append(argv)
                if 'ls' in argv:
                    return ''
                if 'create' in argv:
                    return 'b' * 64
                receipt = json.loads((packet.home / 'network-create-return.json').read_text())
                return json.dumps([{'Id': receipt['id'], 'Name': receipt['name'], 'Driver': 'bridge', 'Scope': 'local',
                    'Labels': receipt['labels'], 'Options': {'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1'}, 'Containers': {}}])
            prepare = SimpleNamespace(capture=capture, phase_environment=lambda *_: {})
            receipt = unit.create_network(prepare, packet, {'GITHUB_RUN_ID': '123'}, 'c' * 64)
            self.assertIn('com.docker.network.bridge.host_binding_ipv4=127.0.0.1', calls[1])
            self.assertNotIn('com.supabase.cli.project', receipt['labels'])
            self.assertEqual(calls[2][-1], 'b' * 64)
            self.assertTrue((packet.home / 'network-birth.json').is_file())

    def test_unknown_create_has_intent_but_no_fabricated_birth_or_retry(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            packet = SimpleNamespace(home=Path(directory), host={'socket': '/synthetic/docker.sock'}, node='/synthetic/node',
                plan={'producerReservation': 'a' * 40, 'inputEpoch': 'synthetic', 'environmentId': 't3-synthetic'})
            calls = []
            def capture(argv, env):
                calls.append(argv)
                if 'ls' in argv:
                    return ''
                raise TimeoutError('finite unknown network-create outcome')
            prepare = SimpleNamespace(capture=capture, phase_environment=lambda *_: {})
            with self.assertRaises(TimeoutError):
                unit.create_network(prepare, packet, {'GITHUB_RUN_ID': '123'}, 'c' * 64)
            self.assertEqual(len(calls), 2)
            self.assertEqual(sum('create' in argv for argv in calls), 1)
            self.assertTrue((packet.home / 'network-create-intent.json').is_file())
            self.assertFalse((packet.home / 'network-birth.json').exists())

    def test_attached_or_changed_network_never_reaches_remove(self):
        unit = load()
        receipt = {'id': 'a' * 64, 'name': 'synthetic-owned', 'labels': {'sim.track': 'track3'}}
        base = {'Id': receipt['id'], 'Name': receipt['name'], 'Driver': 'bridge', 'Scope': 'local', 'Labels': receipt['labels'],
                'Options': {'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1'}, 'Containers': {}}
        for row in [dict(base, Containers={'foreign': {}}), dict(base, Id='b' * 64), dict(base, Labels={'foreign': 'owner'}),
                    dict(base, Options={'com.docker.network.bridge.host_binding_ipv4': '0.0.0.0'})]:
            calls = []
            def capture(argv, env):
                calls.append(argv)
                return json.dumps([row])
            prepare = SimpleNamespace(capture=capture, phase_environment=lambda *_: {}, same_host=lambda *_: None,
                                      host_identity=lambda **_: {})
            same = SimpleNamespace(docker_resources=lambda *_: {'containers': [], 'volumes': [], 'networks': [receipt['id']]})
            packet = SimpleNamespace(host={'socket': '/synthetic/docker.sock'}, node='/synthetic/node')
            with self.subTest(row=row), self.assertRaises(ValueError):
                unit.cleanup_network(prepare, same, packet, receipt, {'containers': [], 'volumes': [], 'networks': []})
            self.assertFalse(any('rm' in argv for argv in calls))


class PostproofTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.u = load()
        cls.root = cls.u.crypto_port('keygen')
        cls.runner = cls.u.crypto_port('keygen')
        cls.foreign = cls.u.crypto_port('keygen')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.u = load()
        self.u.ROOT_SIGNING_PUBLIC_PEM = self.root['publicPem']
        self.u.ROOT_SIGNING_PUBLIC_SHA256 = self.u.hash_bytes(self.root['publicPem'].encode())
        now = datetime.now(timezone.utc)
        self.proof = {'purpose': 't3-hosted-postproof-input', 'repository': 'heke99/gridex-ops-platform',
            'runId': '123456789', 'runAttempt': '1', 'job': 'physical-e03', 'head': 'b'*40, 'tree': 'c'*40,
            'host': {'bootId': 'FINITE_BOOT_NOT_NATIVE', 'socket': '/finite/docker.sock', 'capacityStatus': 'QUALIFIED',
                     'driver': 'overlay2', 'effectiveRamBytes': 8*2**30, 'freeBytes': 15*2**30,
                     'capacityObservation':{'status':'QUALIFIED'}, 'backendIdentity':{'state':'VERIFIED'},
                     'backendCapacity':{'schema':'gridex-t2-shared-backend-capacity-v1','state':'VERIFIED','errors':[],
                                        'backend':{'effectiveRAMBytes':8*2**30}}}, 'inventory': {'containers': [], 'volumes': [], 'networks': []},
            'proofSha256': 'd'*64, 'nonce': 'e'*64, 'inputPublicKey': self.runner['publicPem'],
            'observedAtUtc': now.isoformat(), 'jobDeadlineUtc': (now + timedelta(minutes=80)).isoformat(),
            'runnerTemp': str(self.directory), 'workspaceRoot': str(self.directory / 'workspace')}
        self.profile = {'schema': 'track3-hosted-bootstrap-v1', 'environment': 'test',
            'reviewerCertificateSha256': self.u.REVIEWER_CERT_SHA256, 'configOverlaySha256': 'f'*64,
            'plan': {'schema': 'track3-runner-plan-v1', 'simHome': str(self.directory / 't3-hosted-private'),
                'appDir': str(self.directory / 'workspace/app'), 'replayDir': str(self.directory / 'workspace/replay'),
                'nodeBin': str(self.directory / 't3-hosted-private/tools/node-v22.16.0-linux-x64/bin/node'),
                'appCommit': 'b'*40, 'appTree': 'c'*40, 'harnessCommit': 'b'*40, 'harnessTree': 'c'*40,
                'attemptBudget': 1, 'reviewerCertificateSha256': self.u.REVIEWER_CERT_SHA256,
                'expiresAtUtc': (now + timedelta(minutes=15)).isoformat(),
                'execution': {'purpose': 'ediel03_physical', 'scenarioFile': 'scenarios/ediel03-03.test.ts', 'scenarioSha256': '1'*64}}}
        raw=b'FINITE_PRIVATE_ORIGINAL_NOT_A_GRANT'
        self.files=[{'directory':'authority','name':'finite.txt','base64Bytes':self.u.base64.b64encode(raw).decode(),'sha256':self.u.hash_bytes(raw)}]
        self.payload=self.u.proof_payload(self.proof,self.profile,self.files,self.profile['plan']['expiresAtUtc'])

    def seal(self, payload=None, root=None, public=None):
        root=root or self.root
        return self.u.crypto_port('seal',payload=payload or self.payload,privatePem=root['privatePem'],
             publicPem=public or self.runner['publicPem'],rootPublicPem=root['publicPem'],rootSha256=self.u.hash_bytes(root['publicPem'].encode()))

    def decrypt(self, envelope):
        return self.u.crypto_port('decrypt',envelope=envelope,privatePem=self.runner['privatePem'],publicPem=self.runner['publicPem'],
             rootPublicPem=self.root['publicPem'],rootSha256=self.u.hash_bytes(self.root['publicPem'].encode()))

    def test_actual_pss_oaep_gcm_positive_exact_bytes_and_existing_consumer_abi(self):
        payload=self.decrypt(self.seal())
        home=self.u.materialize_assignment(payload,self.proof)
        self.assertEqual(json.loads((home/'profile.json').read_bytes()),self.profile)
        self.assertEqual((home/'authority/finite.txt').read_bytes(),b'FINITE_PRIVATE_ORIGINAL_NOT_A_GRANT')
        self.assertEqual((home/'reviewer.pem').read_text(),self.u.REVIEWER_CERT)
        self.assertEqual((home/'profile.json').stat().st_mode&0o777,0o600)
        self.assertFalse(any('private.pem' in str(p) for p in home.rglob('*')))
        with self.assertRaises(FileExistsError): self.u.materialize_assignment(payload,self.proof)

    def test_wrong_signer_recipient_and_tampered_gcm_refused(self):
        for envelope in [self.seal(root=self.foreign),self.seal(public=self.foreign['publicPem'])]:
            with self.subTest(kind=envelope['recipientSha256']),self.assertRaises(ValueError):self.decrypt(envelope)
        for field in ['ciphertext','tag','nonce','wrappedKey']:
            envelope=self.seal(); raw=bytearray(self.u.base64.b64decode(envelope[field]));raw[0]^=1
            envelope[field]=self.u.base64.b64encode(raw).decode()
            with self.subTest(field=field),self.assertRaises(ValueError):self.decrypt(envelope)

    def test_utf16_canonicalization_matches_actual_donor_not_python_unicode_sort(self):
        value={'\ue000':1,'\U00010000':2,'a':'åäö','array':[{'z':1,'a':2}]}
        actual=self.u.crypto_port('canonical',value=value)['canonical']
        self.assertLess(actual.index('\U00010000'),actual.index('\ue000'))
        self.assertEqual(actual,'{"a":"åäö","array":[{"a":2,"z":1}],"𐀀":2,"\ue000":1}')
        self.payload['profile']['unicodeTest']=value
        self.assertEqual(self.decrypt(self.seal()),self.payload)

    def test_all_signed_scope_bindings_refuse_changed_field(self):
        for key in ['repository','issue','workflow','runId','runAttempt','job','sourceHead','sourceTree','bootId','proofSha256','nonce','recipientSha256','format','nativeAttemptBudget']:
            value=deepcopy(self.payload);value[key]='foreign'
            with self.subTest(key=key),self.assertRaises(ValueError):self.u.validate_assignment(self.decrypt(self.seal(value)),self.proof)

    def test_expiry_bounds_and_attempt_budget_bool_refused(self):
        for minutes in [-1,91,100]:
            value=deepcopy(self.payload); value['expiresAt']=(datetime.now(timezone.utc)+timedelta(minutes=minutes)).isoformat()
            value['profile']['plan']['expiresAtUtc']=value['expiresAt']
            with self.subTest(minutes=minutes),self.assertRaises(ValueError):self.u.validate_assignment(value,self.proof)
        value=deepcopy(self.payload);value['nativeAttemptBudget']=True
        with self.assertRaises(ValueError):self.u.validate_assignment(value,self.proof)

    def test_no_path_traversal_symlink_duplicate_bad_hash_or_excess_file_bytes(self):
        changes=[{'name':'../escape'},{'directory':'elsewhere'},{'sha256':'0'*64},
                 {'base64Bytes':self.u.base64.b64encode(b'x'*40001).decode(),'sha256':self.u.hash_bytes(b'x'*40001)}]
        for change in changes:
            value=deepcopy(self.payload);value['files'][0].update(change)
            with self.subTest(change=list(change)),self.assertRaises(ValueError):self.u.materialize_assignment(value,self.proof)
            self.assertFalse(Path(self.profile['plan']['simHome']).exists())
        value=deepcopy(self.payload);value['files']*=2
        with self.assertRaises(ValueError):self.u.materialize_assignment(value,self.proof)
        Path(self.profile['plan']['simHome']).symlink_to(self.directory,target_is_directory=True)
        with self.assertRaises(FileExistsError):self.u.materialize_assignment(self.payload,self.proof)

    def test_imported_future_paths_source_or_cert_cannot_replace_proof_binding(self):
        for key,value in [('harnessCommit','0'*40),('harnessTree','0'*40),('appCommit','x\nINJECT=1'),('simHome','/tmp/foreign'),
                          ('appDir','/tmp/app'),('replayDir','/tmp/replay'),('nodeBin','/bin/node'),('reviewerCertificateSha256','0'*64),('attemptBudget',True)]:
            payload=deepcopy(self.payload);payload['profile']['plan'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.u.validate_assignment(payload,self.proof)

    def carrier(self):
        return {'kind':'t3-host-assignment-envelope-v1','runId':self.proof['runId'],'proofSha256':self.proof['proofSha256'],
                'recipientSha256':self.u.hash_bytes(self.runner['publicPem'].encode()),'envelope':self.seal()}

    def snapshot_api(self,count=375,drift=None,budget=1000):
        carrier=self.carrier(); calls=[]; passes=[0]; issue=[0]
        def call(path):
            calls.append(path)
            if path=='/issues/930':
                issue[0]+=1
                return {'comments':count+(1 if drift=='count' and issue[0]==2 else 0)}
            if path=='/rate_limit':return {'resources':{'core':{'remaining':budget,'limit':5000,'reset':int(self.u.time.time()+3600)}}}
            page=int(path.split('page=')[-1]);passes[0]+=int(page==1)
            start=(page-1)*100; stop=min(count,start+100)
            rows=[{'id':i+1,'body':'public ordinary comment','updated_at':'finite'} for i in range(start,stop)]
            if rows and page==4:rows[-1]['body']=json.dumps(carrier)
            if drift=='short' and page==2:rows=rows[:-1]
            if drift=='prefix' and page==4 and passes[0]==1:rows=[]
            if drift=='body' and passes[0]==2 and rows:rows[0]['body']='changed'
            if drift=='ids' and page==2:rows[0]['id']=1
            return rows
        return SimpleNamespace(call=call),calls

    def test_full375comments_fourpages_twice_cost12_positive(self):
        api,calls=self.snapshot_api();envelope,stats=self.u.read_host_carrier(self.proof,api)
        self.assertEqual(self.decrypt(envelope),self.payload)
        self.assertEqual(stats['requestCost'],12)
        self.assertEqual(len(calls),12)
        for page in range(1,5):self.assertEqual(calls.count(f'/issues/930/comments?per_page=100&page={page}'),2)

    def test_full_snapshot_partial_duplicate_id_count_and_content_drift_hold(self):
        for drift in ['short','prefix','body','ids','count']:
            api,_=self.snapshot_api(drift=drift)
            with self.subTest(drift=drift),self.assertRaises(ValueError):self.u.read_host_carrier(self.proof,api)

    def test_quota_hold_before_any_comment_page_read(self):
        api,calls=self.snapshot_api(budget=75)
        with self.assertRaises(ValueError):self.u.read_host_carrier(self.proof,api)
        self.assertEqual(calls,['/issues/930','/rate_limit'])

    def test_ambiguous_or_malformed_carrier_refused(self):
        carrier=self.carrier();row={'body':json.dumps(carrier)}
        for rows in [[row,row],[{'body':'{t3-host-assignment-envelope-v1'}]]:
            with self.assertRaises(ValueError):self.u.select_host_carrier(rows,self.proof)
        carrier['runId']='foreign';self.assertIsNone(self.u.select_host_carrier([{'body':json.dumps(carrier)}],self.proof))

    def test_decrypt_failure_sticky_intent_stops_import_and_all_followup(self):
        proofhome=self.directory/'proof';proofhome.mkdir(mode=0o700)
        self.proof['identity']={'GITHUB_RUN_ID':self.proof['runId'],'GITHUB_JOB':self.proof['job'],'GITHUB_SHA':self.proof['head']}
        self.u.save(proofhome/'host-proof.private.json',self.proof)
        self.u.fresh_private_bytes(proofhome/'ephemeral-input-key.private.pem',self.runner['privatePem'].encode())
        prepare=SimpleNamespace(private=lambda p,*_:p,host_identity=lambda **_:self.proof['host'],same_host=lambda *_:None)
        same=SimpleNamespace(docker_resources=lambda *_:self.proof['inventory'])
        with patch.object(self.u,'read_host_carrier',return_value=({'format':'bad'},{})):
            with self.assertRaises(ValueError):self.u.receive_host_assignment(proofhome,self.proof['identity'],prepare,same,None)
            with self.assertRaises(FileExistsError):self.u.receive_host_assignment(proofhome,self.proof['identity'],prepare,same,None)
        self.assertFalse(Path(self.profile['plan']['simHome']).exists())

    def test_real_source_workflow_has_no_static_secret_checkout_and_preserves_caller_order(self):
        workflow=Path(__file__).parents[3]/'.github/workflows/t3-e03-hosted.yml'
        text=workflow.read_text()
        self.assertNotIn('secrets.T3_HOSTED',text)
        self.assertLess(text.index(' host-proof '),text.index(' receive-input '))
        self.assertLess(text.index(' receive-input '),text.index('path: app'))
        self.assertEqual(text.count('steps.private_input.outputs.appCommit'),2)
        self.assertIn('issues: write',text)
        self.assertIn(' execute ',text)



    def realistic_full_assignment(self, source_refs=8):
        # Finite source-shaped complete capsules; these are NOT actual grants.
        profile=deepcopy(self.profile);p=profile['plan']
        prefix='refs/tags/agent-claims/masterplan/'
        roles={'producer':prefix+'producer-finite-only','backend':prefix+'backend-finite-only'}
        packet='f44546db-112b-4166-9a13-179aee9f1fae'; slot='session-'+packet
        source={k:p[k] for k in ['appCommit','appTree','harnessCommit','harnessTree']}
        p.update(workerId='codex-track3',model='FINITE_SOURCE_TEST_NOT_AUTHORITY',epoch='finite-only',inputEpoch='finite-test-input',
            schemaEpoch='main-source-schema-test-only',environment='test',environmentId='t3-finite-only',projectId='t3-hosted-e03',exclusiveHost=True,
            ports={'api':54321,'db':54322,'app':3103,'smtp':3125,'imapPlain':3143,'imapTls':3993,'control':3199},
            greenmailImage='greenmail/standalone@sha256:d556b8c7df01ba04a0e0f67dacab2c5f75a61207a51774e0654c179b83a671e1',
            allowedActions=['backend','replay','build','up','run','down','cleanup'],
            timeouts={k:900 for k in ['backend','replay','build','up','run','down','cleanup']},
            consumer={'path':'scripts/simulation/track3/hosted-consumer.py','sha256':'a'*64},
            adapters={k:{'path':'scripts/simulation/track3/hosted-consumer.py','sha256':'a'*64} for k in ['backend','replay','cleanup']},
            workflow={'path':self.u.WORKFLOW,'sha256':'a'*64},replayScriptSha256='a'*64,dependencyLockSha256='a'*64,overlayRefs=['b'*40],
            producerReservation='1'*40,backendReservation='2'*40)
        identity={'GITHUB_REPOSITORY':self.proof['repository'],'GITHUB_REF':'refs/heads/finite-source-test',
                  'event':{'name':'workflow_dispatch','ref':'refs/heads/finite-source-test','sourceSha':p['harnessCommit'],'createOnly':False,'triggerActor':'finite-only'}}
        files=[]
        def entry(name,raw):
            if not isinstance(raw,bytes):raw=json.dumps(raw,separators=(',',':')).encode()
            item={'directory':'authority','name':name,'base64Bytes':self.u.base64.b64encode(raw).decode(),'sha256':self.u.hash_bytes(raw)}
            files.append(item);return item
        mandate=entry('user-native-mandate.json',{'scope':'T3_CONTROLLED_SYNTHETIC_NATIVE_TESTDATA','source':'finite actual request-shaped test; not a real grant'})
        reviews=[]
        for i in [1,2]:
            artifact=entry(f'independent-review-{i}.json',{'decision':'APPROVE_SOURCE_ONLY','source':source,'evidence':'finite source applicability review '*20})
            reviews.append({'agent':f'finite-independent-{i}','decision':'APPROVE_SOURCE_ONLY','source':source,
                'executionSha256':self.u.canonical_hash(p['execution']),'name':artifact['name'],'sha256':artifact['sha256']})
        native={'roles':['backend','producer'],'roleRefs':roles,'track':'T3','inputEpoch':p['inputEpoch'],'attemptBudget':1,
            'exclusiveHost':True,'workflow':self.u.WORKFLOW,'harnessCommit':p['harnessCommit'],'repository':self.proof['repository'],
            'projectId':p['projectId'],'execution':p['execution'],'schemaEpoch':p['schemaEpoch'],'environment':'test','environmentId':p['environmentId'],
            'ports':p['ports'],'greenmailImage':p['greenmailImage'],'reviewerCertificateSha256':p['reviewerCertificateSha256'],
            'consumer':p['consumer'],'event':identity['event'],'expiresAtUtc':p['expiresAtUtc']}
        resources=sorted([*roles.values(),prefix+'slot-'+slot])
        profile['authorities']={}
        p['reservationRefs']=[{'ref':prefix+'file-'+self.u.hash_bytes(('finite-source-path-'+str(i)).encode()),'sha':'a'*40} for i in range(source_refs)]
        # Actual source path shapes, preserving realistic complete capsule length.
        sourcepaths=sorted(['.github/workflows/t3-e03-hosted.yml']+
            ['scripts/simulation/track3/'+v.name for v in Path(__file__).parent.iterdir() if v.is_file()]+
            ['__tests__/simulation-t3-business-oracle.test.ts','__tests__/simulation-t3-e03-reception.test.ts'])
        for n,role in enumerate(['producer','backend'],1):
            capsule={'protocol':'masterplan-reservation-v1','agent':'finite-producer-'+role,'epoch':p['epoch'],'source':p['appCommit'],
                'packet':packet,'slot':slot,'checkpoint':'private-finite-test','branch':'finite-source-test','createdAt':datetime.now(timezone.utc).isoformat(),
                'base':'a'*40,'ids':[],'runtimeAuthorization':native,'resources':resources,'files':sourcepaths,
                'userNativeMandate':{'scope':'T3_CONTROLLED_SYNTHETIC_NATIVE_TESTDATA','name':mandate['name'],'sha256':mandate['sha256']},
                'authors':['finite-author'],'independentReviews':reviews}
            original=entry(f'{role}-capsule.json',capsule)
            binding={'ref':roles[role],'sha':str(n)*40,'agent':capsule['agent'],'capsuleName':original['name'],'capsuleSha256':original['sha256'],
                     'capsuleRef':prefix+'runtime-authority-'+original['sha256']}
            profile['authorities'][role]=binding
            p['reservationRefs'] += [{'ref':binding['ref'],'sha':binding['sha']},{'ref':binding['capsuleRef'],'sha':binding['sha']}]
        payload=self.u.proof_payload(self.proof,profile,files,p['expiresAtUtc'])
        return payload,identity

    def test_realistic_complete_native_capsules_fit_transport_and_pass_actual_old_guards(self):
        payload,identity=self.realistic_full_assignment(86)
        envelope=self.seal(payload)
        carrier={'kind':'t3-host-assignment-envelope-v1','runId':self.proof['runId'],'proofSha256':self.proof['proofSha256'],
            'recipientSha256':self.u.hash_bytes(self.runner['publicPem'].encode()),'envelope':envelope}
        self.assertLessEqual(len(envelope['ciphertext']),58000)
        self.assertLessEqual(len(json.dumps(carrier).encode()),60000)
        home=self.u.materialize_assignment(self.decrypt(envelope),self.proof)
        profile=json.loads((home/'profile.json').read_bytes())
        for role,binding in profile['authorities'].items():
            actual=self.u.private_authority(profile,profile['plan'],binding,role,identity,SimpleNamespace(private=lambda p,*_:Path(p)))
            self.assertEqual(actual['runtimeAuthorization']['attemptBudget'],1)
        # All86 is an independent actual custody ACK, not silently deleted to fit.
        # Measure whether duplicating86 into this finite runtime capsule would fit.
        all86,_=self.realistic_full_assignment(86)
        oversized=self.seal(all86)
        self.assertEqual(len(oversized['ciphertext']),len(envelope['ciphertext']))
        print('FINITE_SIZE_ONLY_NOT_AUTHORITY '+json.dumps({'relevantRuntimeRefs':len(payload['profile']['plan']['reservationRefs']),
            'payloadBytes':len(json.dumps(payload,separators=(',',':')).encode()),'ciphertextCharacters':len(envelope['ciphertext']),
            'carrierBytes':len(json.dumps(carrier).encode()),'duplicated86CiphertextCharacters':len(oversized['ciphertext'])}))

    def test_ciphertext_overflow_refused_in_actual_decrypt_port(self):
        payload=deepcopy(self.payload);payload['profile']['excess']='x'*50000
        envelope=self.seal(payload)
        self.assertGreater(len(envelope['ciphertext']),58000)
        with self.assertRaises(ValueError):self.decrypt(envelope)

    def test_source_pinned_cms_certificate_can_encrypt_actual_host_proof_without_private_key(self):
        encrypted=self.u.crypto_port('encrypt',value={'finiteProofOnly':True},publicPem=self.u.REVIEWER_CERT)
        self.assertEqual(encrypted['recipientSha256'],self.u.REVIEWER_CERT_SHA256)
        self.assertEqual(encrypted['algorithm'],'AES-256-GCM/RSA-OAEP-SHA256')



    def test_actual_receive_complete_signed_full_capsules_into_real_caller_abi(self):
        proofhome=self.directory/'proof';proofhome.mkdir(mode=0o700)
        identity={'GITHUB_RUN_ID':self.proof['runId'],'GITHUB_JOB':self.proof['job'],'GITHUB_SHA':self.proof['head']}
        self.proof['identity']=identity
        # Host stored bytes have no self-referential digest; receiver derives it.
        original=deepcopy(self.proof);original.pop('proofSha256')
        self.u.save(proofhome/'host-proof.private.json',original)
        self.proof['proofSha256']=self.u.hash_bytes((proofhome/'host-proof.private.json').read_bytes())
        self.u.fresh_private_bytes(proofhome/'ephemeral-input-key.private.pem',self.runner['privatePem'].encode())
        self.payload,_=self.realistic_full_assignment(86)
        api,calls=self.snapshot_api()
        prepare=SimpleNamespace(private=lambda p,*_:p,host_identity=lambda **_:self.proof['host'],same_host=lambda *_:None)
        same=SimpleNamespace(docker_resources=lambda *_:self.proof['inventory'])
        home=self.u.receive_host_assignment(proofhome,identity,prepare,same,api)
        imported=json.loads((home/'profile.json').read_bytes())
        self.assertEqual(imported,self.payload['profile'])
        self.assertEqual(len(calls),12)
        self.assertEqual(len(list((home/'authority').iterdir())),5)
        self.assertFalse((home/'ephemeral-input-key.private.pem').exists())

    def test_actual_offhost_open_seal_publish_cli_no_key_transfer_no_native_effect(self):
        # Exercise exact CLI parser/file/crypto/publisher path with finite own keys.
        cert=self.runner['publicPem']
        self.u.REVIEWER_CERT=cert;self.u.REVIEWER_CERT_SHA256=self.u.hash_bytes(cert.encode())
        self.profile['reviewerCertificateSha256']=self.profile['plan']['reviewerCertificateSha256']=self.u.REVIEWER_CERT_SHA256
        original=deepcopy(self.proof);original.pop('proofSha256')
        raw=json.dumps(original).encode()
        encrypted=self.u.crypto_port('encrypt',value={'proofBytesBase64':self.u.base64.b64encode(raw).decode(),
            'proofSha256':self.u.hash_bytes(raw)},publicPem=cert)
        # open-proof additionally checks source-produced format/workflow.
        original['format']='t3_actual_host_observation_v1';original['workflow']=self.u.WORKFLOW
        raw=json.dumps(original).encode()
        encrypted=self.u.crypto_port('encrypt',value={'proofBytesBase64':self.u.base64.b64encode(raw).decode(),
            'proofSha256':self.u.hash_bytes(raw)},publicPem=cert)
        proofdir=self.directory/'offhost-proof'
        cipherfile=self.directory/'host-proof.enc.json';self.u.save(cipherfile,{'kind':'t3-host-proof-envelope-v1','envelope':encrypted})
        keyfile=self.directory/'evidence-key.pem';self.u.fresh_private_bytes(keyfile,self.runner['privatePem'].encode())
        # Actual prepare private-file ownership/mode checks, no backend call.
        self.u.postproof_main(['open-proof','--proof-home',str(proofdir),'--ciphertext',str(cipherfile),'--evidence-key',str(keyfile)])
        self.assertEqual((proofdir/'host-proof.private.json').read_bytes(),raw)
        profilefile=self.directory/'profile.json';self.u.save(profilefile,self.profile)
        filesfile=self.directory/'files.json';self.u.save(filesfile,self.files)
        signer=self.directory/'signer.pem';self.u.fresh_private_bytes(signer,self.root['privatePem'].encode())
        output=self.directory/'assignment.enc.json'
        self.u.postproof_main(['seal-assignment','--proof-home',str(proofdir),'--profile',str(profilefile),
            '--files',str(filesfile),'--signing-key',str(signer),'--output',str(output)])
        carrier=json.loads(output.read_bytes())
        self.assertNotIn('profile',carrier)
        self.assertTrue(Path(str(output)+'.sizes.json').is_file())
        calls=[]
        api=SimpleNamespace(call=lambda *args:calls.append(args),audit_home=None)
        with patch.object(self.u,'GitHub',return_value=api):
            self.u.postproof_main(['publish-assignment','--proof-home',str(proofdir),'--ciphertext',str(output)])
            with self.assertRaises(FileExistsError):
                self.u.postproof_main(['publish-assignment','--proof-home',str(proofdir),'--ciphertext',str(output)])
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][:2],('/issues/930/comments','POST'))
        self.assertNotIn('PRIVATE KEY',calls[0][2]['body'])
        self.assertNotIn('nativeAttemptBudget',calls[0][2]['body'])

    def test_actual_github_port_only_issue930_and_global_quota_no_redirect(self):
        api=self.u.GitHub('heke99/gridex-ops-platform','FINITE_TOKEN')
        calls=[]
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,_):return b'{"resources":{}}'
        def open_port(request,timeout):
            calls.append(request.full_url);return Response()
        api.opener=SimpleNamespace(open=open_port)
        api.call('/rate_limit')
        api.call('/issues/930')
        self.assertEqual(calls,['https://api.github.com/rate_limit','https://api.github.com/repos/heke99/gridex-ops-platform/issues/930'])
        for path in ['/issues/931','/issues/930/comments?per_page=100&page=0','/issues/930/comments/123','https://example.invalid']:
            with self.subTest(path=path),self.assertRaises(ValueError):api.call(path)

    def test_unknown_assignment_post_is_once_and_journaled_without_retry(self):
        api=self.u.GitHub('heke99/gridex-ops-platform','FINITE_TOKEN')
        api.audit_home=self.directory
        calls=[]
        def failed(*args,**kwargs):calls.append(args);raise urllib.error.URLError('finite unknown')
        api.opener=SimpleNamespace(open=failed)
        with self.assertRaises(ValueError):api.call('/issues/930/comments','POST',{'body':'FINITE_CIPHERTEXT_ONLY'})
        self.assertEqual(len(calls),1)
        journal=list(self.directory.glob('api-*.json'))
        self.assertEqual(len(journal),1)
        self.assertEqual(json.loads(journal[0].read_bytes())['status'],'UNKNOWN')
        self.assertNotIn('FINITE_TOKEN',journal[0].read_text())



    def decrypt_hold_archive(self, encrypted):
        opened=self.u.crypto_port('open-file',envelope=json.loads(encrypted.read_bytes()),privatePem=self.runner['privatePem'],publicPem=self.runner['publicPem'])
        import io,tarfile
        raw=self.u.base64.b64decode(opened['bytesBase64'])
        with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as bundle:
            return {item.name:bundle.extractfile(item).read() for item in bundle.getmembers()}

    def test_real_hostproof_unknown_post_is_encrypted_hold_without_ephemeral_key(self):
        self.u.REVIEWER_CERT=self.runner['publicPem']
        self.u.REVIEWER_CERT_SHA256=self.u.hash_bytes(self.runner['publicPem'].encode())
        identity={'GITHUB_REPOSITORY':'heke99/gridex-ops-platform','GITHUB_RUN_ID':'123','GITHUB_JOB':'physical-e03',
                  'GITHUB_SHA':'b'*40,'GITHUB_RUN_ATTEMPT':'1'}
        api=self.u.GitHub('heke99/gridex-ops-platform','FINITE_PRIVATE_TOKEN')
        calls=[]
        def unknown(*a,**k):calls.append(a);raise urllib.error.URLError('FINITE_PRIVATE_SERVER_DETAIL')
        api.opener=SimpleNamespace(open=unknown)
        prepare=SimpleNamespace(canonical=lambda p:Path(p).resolve(strict=True),private=lambda p,*_:Path(p),
            capture=lambda _: 'c'*40,source=lambda *_:None,host_identity=lambda **_:self.proof['host'],capacity=lambda *_:None,
            enforce_host_capacity=self.u.load('prepare').enforce_host_capacity)
        same=SimpleNamespace(docker_resources=lambda *_:self.proof['inventory'])
        with patch.dict(self.u.os.environ,{'RUNNER_TEMP':str(self.directory),'GITHUB_WORKSPACE':str(self.directory)}),\
             patch.object(self.u,'hosted_identity',return_value=identity),patch.object(self.u,'GitHub',return_value=api),\
             patch.object(self.u,'observed_job',return_value={'job':{'started_at':datetime.now(timezone.utc).isoformat()}}),\
             patch.object(self.u,'load',side_effect=lambda name:prepare if name=='prepare' else same):
            proofhome=self.directory/'t3-host-proof'
            with self.assertRaises(ValueError):self.u.main(['host-proof','--proof-home',str(proofhome)])
            encrypted=self.u.archive_transport_hold(proofhome,prepare)
        self.assertEqual(len(calls),1)
        members=self.decrypt_hold_archive(encrypted)
        self.assertIn('transport/publish-intent.json',members)
        failures=[json.loads(v) for k,v in members.items() if 'transport-failure-' in k]
        self.assertEqual(failures[0]['reason'],'gitdata_unknown_no_retry')
        self.assertEqual(failures[0]['stage'],'host-proof:ciphertext-post')
        self.assertTrue(any(json.loads(v).get('status')=='UNKNOWN' for k,v in members.items() if '/api-' in k))
        joined=b''.join(members.values())
        self.assertNotIn(b'BEGIN PRIVATE KEY',joined)
        self.assertNotIn(b'FINITE_PRIVATE_TOKEN',joined)
        self.assertNotIn(b'FINITE_PRIVATE_SERVER_DETAIL',joined)
        self.assertFalse(any('ephemeral-input-key' in name for name in members))
        self.assertTrue((proofhome/'ephemeral-input-key.private.pem').is_file())
        self.assertFalse((self.directory/'t3-hosted-transport-hold.tar.gz').exists())

    def test_early_capacity_unknown_safe_reason_and_partial_materialization_inventory_retained(self):
        self.u.REVIEWER_CERT=self.runner['publicPem'];self.u.REVIEWER_CERT_SHA256=self.u.hash_bytes(self.runner['publicPem'].encode())
        proofhome=self.directory/'t3-host-proof';proofhome.mkdir(mode=0o700)
        self.u.fresh_private_bytes(proofhome/'ephemeral-input-key.private.pem',b'FINITE_EPHEMERAL_PRIVATE_BYTES_NEVER_EXPORT')
        self.profile['reviewerCertificateSha256']=self.profile['plan']['reviewerCertificateSha256']=self.u.REVIEWER_CERT_SHA256
        # Actual partial materialization: first original written, second faults.
        files=deepcopy(self.files);files.append({**self.files[0],'name':'second.txt'})
        payload=self.u.proof_payload(self.proof,self.profile,files,self.profile['plan']['expiresAtUtc'])
        writer=self.u.fresh_private_bytes;written=[]
        def fail_second(path,raw):
            if written:raise OSError('FINITE_SECRET_STDERR_MUST_NOT_EXPORT')
            written.append(path);writer(path,raw)
        with patch.object(self.u,'fresh_private_bytes',side_effect=fail_second),self.assertRaises(OSError):
            self.u.materialize_assignment(payload,self.proof)
        prepare=SimpleNamespace(canonical=lambda p:Path(p).resolve(strict=True),private=lambda p,*_:Path(p))
        with patch.dict(self.u.os.environ,{'RUNNER_TEMP':str(self.directory)}),patch.object(self.u,'load',return_value=prepare):
            self.u.transport_stage('host-proof:host-capacity')
            self.u.record_transport_failure(ValueError('capacity_hierarchy_unknown'))
            self.u.transport_stage('receive-input:materialization')
            # Distinct process-equivalent filename for second failure journal.
            with patch.object(self.u.os,'getpid',return_value=987654321):
                self.u.record_transport_failure(OSError('FINITE_SECRET_STDERR_MUST_NOT_EXPORT'))
            encrypted=self.u.archive_transport_hold(proofhome,prepare)
        members=self.decrypt_hold_archive(encrypted)
        failures=[json.loads(v) for k,v in members.items() if 'transport-failure-' in k]
        self.assertTrue(any(v['reason']=='capacity_hierarchy_unknown' for v in failures))
        self.assertTrue(any(v['reason']=='transport_observation_or_import_failed' and v['stage']=='receive-input:materialization' for v in failures))
        summary=json.loads(members['transport/terminal-hold.json'])
        file=next(v for v in summary['partialMaterializationInventory'] if v['path']=='authority/finite.txt')
        self.assertEqual(file['sha256'],self.files[0]['sha256'])
        self.assertNotIn(b'FINITE_EPHEMERAL_PRIVATE_BYTES_NEVER_EXPORT',b''.join(members.values()))
        self.assertNotIn(b'FINITE_SECRET_STDERR_MUST_NOT_EXPORT',b''.join(members.values()))
        self.assertFalse(summary['ephemeralPrivateKeyIncluded'])

    def test_failed_import_workflow_always_archives_and_uploads_only_ciphertext(self):
        text=(Path(__file__).parents[3]/'.github/workflows/t3-e03-hosted.yml').read_text()
        self.assertIn("if: always() && steps.private_input.outcome != 'success'",text)
        self.assertIn(' transport-archive ',text)
        self.assertIn('path: ${{ runner.temp }}/t3-hosted-transport-hold.enc.json',text)
        self.assertNotIn('path: ${{ runner.temp }}/t3-host-proof',text)



    def test_actual_capacity_unknown_cli_retains_terminal_reason_before_key_creation(self):
        self.u.REVIEWER_CERT=self.runner['publicPem']
        identity={'GITHUB_REPOSITORY':'heke99/gridex-ops-platform','GITHUB_RUN_ID':'123','GITHUB_JOB':'physical-e03',
                  'GITHUB_SHA':'b'*40,'GITHUB_RUN_ATTEMPT':'1'}
        prepare=SimpleNamespace(canonical=lambda p:Path(p).resolve(strict=True),private=lambda p,*_:Path(p),
            capture=lambda _: 'c'*40,source=lambda *_:None,
            host_identity=lambda **_:(_ for _ in ()).throw(ValueError('capacity_hierarchy_unknown')))
        same=SimpleNamespace(docker_resources=lambda *_:self.fail('inventory must not run after unknown capacity'))
        api=SimpleNamespace(audit_home=None,call=lambda *_:self.fail('no ciphertext post after unknown capacity'))
        with patch.dict(self.u.os.environ,{'RUNNER_TEMP':str(self.directory),'GITHUB_WORKSPACE':str(self.directory)}),\
             patch.object(self.u,'hosted_identity',return_value=identity),patch.object(self.u,'GitHub',return_value=api),\
             patch.object(self.u,'observed_job',return_value={'job':{'started_at':datetime.now(timezone.utc).isoformat()}}),\
             patch.object(self.u,'load',side_effect=lambda name:prepare if name=='prepare' else same):
            home=self.directory/'t3-host-proof'
            with self.assertRaises(ValueError):self.u.main(['host-proof','--proof-home',str(home)])
            self.assertFalse((home/'ephemeral-input-key.private.pem').exists())
            encrypted=self.u.archive_transport_hold(home,prepare)
        members=self.decrypt_hold_archive(encrypted)
        failures=[json.loads(v) for k,v in members.items() if 'transport-failure-' in k]
        self.assertEqual(len(failures),1)
        self.assertEqual(failures[0]['stage'],'host-proof:host-capacity')
        self.assertEqual(failures[0]['reason'],'capacity_hierarchy_unknown')
        self.assertFalse(failures[0]['nativeExecuted'])



    def run_capacity_observation_cli(self, host):
        self.u.REVIEWER_CERT=self.runner['publicPem']
        identity={'GITHUB_REPOSITORY':'heke99/gridex-ops-platform','GITHUB_RUN_ID':'123','GITHUB_JOB':'physical-e03',
                  'GITHUB_SHA':'b'*40,'GITHUB_RUN_ATTEMPT':'1'}
        real_capacity=self.u.load('prepare').capacity
        observations=[];enforcements=[];posts=[]
        real_enforce=self.u.load('prepare').enforce_host_capacity
        def observe(*,enforce_capacity=True,observe_backend=False):
            observations.append(enforce_capacity)
            return host
        def enforce(*values):
            enforcements.append(values);real_capacity(*values)
        def enforce_host(host):
            if host['capacityObservation']['status']=='QUALIFIED':
                enforcements.append((host['driver'],host['effectiveRamBytes'],host['freeBytes']))
            real_enforce(host)
        prepare=SimpleNamespace(canonical=lambda p:Path(p).resolve(strict=True),private=lambda p,*_:Path(p),
            capture=lambda _: 'c'*40,source=lambda *_:None,host_identity=observe,capacity=enforce,enforce_host_capacity=enforce_host)
        same=SimpleNamespace(docker_resources=lambda *_:self.proof['inventory'])
        api=SimpleNamespace(audit_home=None,call=lambda *args:posts.append(args))
        proofhome=self.directory/'t3-host-proof'
        with patch.dict(self.u.os.environ,{'RUNNER_TEMP':str(self.directory),'GITHUB_WORKSPACE':str(self.directory)}),\
             patch.object(self.u,'hosted_identity',return_value=identity),patch.object(self.u,'GitHub',return_value=api),\
             patch.object(self.u,'observed_job',return_value={'job':{'started_at':datetime.now(timezone.utc).isoformat()}}),\
             patch.object(self.u,'load',side_effect=lambda name:prepare if name=='prepare' else same):
            try:self.u.main(['host-proof','--proof-home',str(proofhome)])
            except ValueError:pass
            encrypted=self.u.archive_transport_hold(proofhome,prepare)
        return self.decrypt_hold_archive(encrypted),observations,enforcements,posts,proofhome

    def test_unknown_capacity_complete_observation_subreason_retained_before_enforcement(self):
        host=deepcopy(self.proof['host'])
        host.update(capacityStatus='UNKNOWN',effectiveRamBytes=None,
            capacityObservation={'status':'UNKNOWN','effectiveRamBytes':None,'reason':'initial_cgroup_namespace_unproven',
                                 'kernelRelease':'6.14.0-FINITE','observedNamespaceInode':4026532205})
        members,observed,enforced,posts,home=self.run_capacity_observation_cli(host)
        self.assertEqual(observed,[False])
        self.assertEqual(enforced,[])
        self.assertEqual(posts,[])
        self.assertFalse((home/'ephemeral-input-key.private.pem').exists())
        self.assertEqual(json.loads(members['transport/capacity-observation.private.json']),host)
        failure=next(json.loads(v) for k,v in members.items() if 'transport-failure-' in k)
        self.assertEqual(failure['reason'],'capacity_hierarchy_unknown')
        self.assertEqual(failure['stage'],'host-proof:host-capacity')

    def test_qualified_capacity_original_floors_enforced_after_saved_observation(self):
        host=deepcopy(self.proof['host'])
        host['capacityObservation']={'status':'QUALIFIED','effectiveRamBytes':8*2**30,'reason':'FINITE_QUALIFIED_BOUNDARY'}
        members,observed,enforced,posts,home=self.run_capacity_observation_cli(host)
        self.assertEqual(observed,[False])
        self.assertEqual(enforced,[('overlay2',8*2**30,15*2**30)])
        self.assertEqual(len(posts),1)
        self.assertTrue((home/'ephemeral-input-key.private.pem').is_file())
        self.assertEqual(json.loads(members['transport/capacity-observation.private.json']),host)
        self.assertFalse(any('transport-failure-' in k for k in members))

    def test_qualified_status_does_not_override_original_ram_floor(self):
        host=deepcopy(self.proof['host']);host['effectiveRamBytes']=7*2**30
        members,observed,enforced,posts,home=self.run_capacity_observation_cli(host)
        self.assertEqual(observed,[False])
        self.assertEqual(enforced,[('overlay2',7*2**30,15*2**30)])
        self.assertEqual(posts,[])
        self.assertFalse((home/'ephemeral-input-key.private.pem').exists())
        self.assertEqual(json.loads(members['transport/capacity-observation.private.json']),host)
        failure=next(json.loads(v) for k,v in members.items() if 'transport-failure-' in k)
        self.assertEqual(failure['reason'],'effective_ram_below_8gib')



    def test_actual_hostproof_worker_qualified_backend_unknown_retains_both_and_stops(self):
        self.u.REVIEWER_CERT=self.runner['publicPem']
        host=deepcopy(self.proof['host']);host['capacityStatus']='UNKNOWN'
        host['backendCapacity']={'schema':'gridex-t2-shared-backend-capacity-v1','state':'UNKNOWN_HOLD',
            'backend':{'effectiveRAMBytes':2*2**30},'errors':['shared-backend-ram-below-minimum']}
        members,observed,enforced,posts,home=self.run_capacity_observation_cli(host)
        self.assertEqual(posts,[])
        self.assertFalse((home/'ephemeral-input-key.private.pem').exists())
        self.assertEqual(json.loads(members['transport/capacity-observation.private.json']),host)
        failure=next(json.loads(v) for k,v in members.items() if 'transport-failure-' in k)
        self.assertEqual(failure['reason'],'shared_backend_capacity_unqualified')
        self.assertEqual(failure['stage'],'host-proof:host-capacity')


if __name__ == '__main__':
    unittest.main()
