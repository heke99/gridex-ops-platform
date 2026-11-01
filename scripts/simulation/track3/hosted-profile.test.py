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


if __name__ == '__main__':
    unittest.main()
