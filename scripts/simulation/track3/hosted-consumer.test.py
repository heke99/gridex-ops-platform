"""Finite report/status/process-group tests only; no backend or native proof."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def load():
    spec = importlib.util.spec_from_file_location('consumer', Path(__file__).with_name('hosted-consumer.py'))
    unit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(unit)
    return unit


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.unit = load()
        self.item = {'scenario': 'ediel03-03', 'file': 'scenarios/ediel03-03.test.ts', 'exit': 0, 'harnessError': None,
            'vitest': {'success': True, 'numTotalTests': 2, 'numPassedTests': 2, 'numFailedTests': 0,
                       'numPendingTests': 0, 'numTodoTests': 0},
            'identity': {'assignmentSha256': 'a' * 64}, 'evidenceManifest': '/synthetic/evidence/MANIFEST.sha256',
            'steps': [{'name': name, 'scenarioId': 'EDIEL03.03', 'status': 'passed'} for name in self.unit.EXPECTED_NAMES]}
        self.report = {'exit': 0, 'scenarios': [self.item]}

    def test_both_original_variants_are_partial_scope_only(self):
        result = self.unit.validate_pilot(self.report, 'a' * 64)
        self.assertEqual(result['scope'], ['EDIEL03.03'])
        self.assertEqual(result['wholeSuiteAcceptance'], 'NOT_CLAIMED')

    def test_one_suffix_skipped_variant_foreign_identity_or_extra_case_never_passes(self):
        reports = []
        for key, value in [('numPassedTests', 1), ('numPendingTests', 1), ('success', False), ('numTotalTests', 3)]:
            report = deepcopy(self.report)
            report['scenarios'][0]['vitest'][key] = value
            reports.append(report)
        report = deepcopy(self.report); report['scenarios'][0]['steps'].pop(); reports.append(report)
        report = deepcopy(self.report); report['scenarios'][0]['steps'][0]['name'] = 'weaker substitute'; reports.append(report)
        report = deepcopy(self.report); report['scenarios'].append(deepcopy(self.item)); reports.append(report)
        report = deepcopy(self.report); report['scenarios'][0]['identity']['assignmentSha256'] = 'b' * 64; reports.append(report)
        report = deepcopy(self.report); report['scenarios'][0]['evidenceManifest'] = None; reports.append(report)
        for report in reports:
            with self.subTest(report=report), self.assertRaises(ValueError):
                self.unit.validate_pilot(report, 'a' * 64)

    def test_real_status_values_are_used_and_other_database_or_missing_keys_hold(self):
        plan = {'ports': {'api': 54321, 'db': 54322, 'app': 3103, 'control': 3199, 'smtp': 3125, 'imapTls': 3993, 'imapPlain': 3143}}
        status = {'API_URL': 'http://127.0.0.1:54321', 'DB_URL': 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
                  'ANON_KEY': 'synthetic-actual-status-port-anon', 'SERVICE_ROLE_KEY': 'synthetic-actual-status-port-service'}
        values = self.unit.environment_from_status(status, plan, 'test', Path('/synthetic/private'))
        self.assertEqual(values['NEXT_PUBLIC_SUPABASE_ANON_KEY'], status['ANON_KEY'])
        self.assertEqual(values['SUPABASE_SERVICE_ROLE_KEY'], status['SERVICE_ROLE_KEY'])
        for changed in [dict(status, DB_URL='postgresql://foreign/db'), dict(status, ANON_KEY=''), dict(status, API_URL='https://foreign')]:
            with self.assertRaises(ValueError):
                self.unit.environment_from_status(changed, plan, 'test', Path('/synthetic/private'))


class CancellationTests(unittest.TestCase):
    def test_actual_phase_group_does_not_survive_observation_exception(self):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            script = home / 'consumer.py'
            pidfile = home / 'pid'
            script.write_text("import os,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(os.environ['PIDFILE'],'w').write(str(os.getpid()))\ntime.sleep(10)\n")
            packet = SimpleNamespace(home=home, app=home, plan={'timeouts': {'down': 3}})
            original = os.waitid
            def fail(*args):
                if pidfile.exists():
                    raise OSError('finite observation error')
                return original(*args)
            try:
                with patch.object(unit.os, 'waitid', side_effect=fail), self.assertRaisesRegex(OSError, 'finite observation'):
                    unit.owned_command(packet, SimpleNamespace(), 'down', [sys.executable, str(script)], {'PIDFILE': str(pidfile)})
                pid = int(pidfile.read_text())
                command = Path(f'/proc/{pid}/cmdline')
                deadline = time.monotonic() + .5
                while command.exists() and command.read_bytes() and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertFalse(command.exists() and str(script).encode() in command.read_bytes())
            finally:
                if pidfile.exists():
                    pid = int(pidfile.read_text())
                    try:
                        if str(script).encode() in Path(f'/proc/{pid}/cmdline').read_bytes():
                            os.kill(pid, signal.SIGKILL)
                    except FileNotFoundError:
                        pass


class LifecycleTests(unittest.TestCase):
    def run_finite(self, failure=None, down_failure=False):
        unit = load()
        with tempfile.TemporaryDirectory() as directory:
            home, calls = Path(directory), []
            def phase(name):
                calls.append(name)
                if name == failure:
                    raise ValueError('finite primary failure')
                if name == 'up':
                    (home / 'cleanup-assignment.json').write_text('{}')
                if name == 'down' and down_failure:
                    raise OSError('finite cleanup failure')
            packet = SimpleNamespace(home=home, phase=phase)
            prepare = SimpleNamespace(save=lambda path, value: path.write_text(json.dumps(value)))
            def pilot(*_):
                calls.append('pilot')
                if failure == 'pilot':
                    raise ValueError('finite pilot failure')
                return {'scope': ['EDIEL03.03'], 'wholeSuiteAcceptance': 'NOT_CLAIMED'}
            with patch.object(unit, 'pilot_command', side_effect=pilot), \
                 patch.object(unit, 'seal_execution', side_effect=lambda *_: calls.append('execution-seal')), \
                 patch.object(unit, 'assert_fresh_fixture', side_effect=lambda *_: calls.append('fresh-fixture')), \
                 patch.object(unit, 'observe_fixture_actor', side_effect=lambda *_: calls.append('actor-readback')):
                result = unit.consume_phases(packet, prepare)
            self.assertEqual(json.loads((home / 'pilot-consumer-result.json').read_text()), result)
            return calls, result

    def test_success_orders_real_phase_ports_without_stopping_canonical_backend(self):
        calls, result = self.run_finite()
        self.assertEqual(calls, ['build', 'seal', 'execution-seal', 'fresh-fixture', 'up', 'actor-readback', 'pilot', 'down'])
        self.assertTrue(result['ok'])
        self.assertEqual(result['backendCleanup'], 'ORIGINAL_SHELL_EXIT_PENDING')
        self.assertEqual(result['wholeSuiteAcceptance'], 'NOT_CLAIMED')

    def test_build_failure_has_no_up_run_or_arbitrary_backend_cleanup(self):
        calls, result = self.run_finite('build')
        self.assertEqual(calls, ['build'])
        self.assertFalse(result['ok'])

    def test_partial_startup_without_full_birth_assignment_holds_instead_of_global_cleanup(self):
        calls, result = self.run_finite('up')
        self.assertEqual(calls, ['build', 'seal', 'execution-seal', 'fresh-fixture', 'up'])
        self.assertFalse(result['ok'])
        self.assertEqual(result['cleanupFailure']['state'], 'HOLD_APP_MAIL_REQUIRES_OWNED_RECOVERY')

    def test_primary_pilot_failure_survives_a_separate_cleanup_failure(self):
        calls, result = self.run_finite('pilot', down_failure=True)
        self.assertEqual(calls, ['build', 'seal', 'execution-seal', 'fresh-fixture', 'up', 'actor-readback', 'pilot', 'down'])
        self.assertEqual(result['primaryFailure']['type'], 'ValueError')
        self.assertEqual(result['cleanupFailure']['type'], 'OSError')
        self.assertFalse(result['ok'])

    def test_actual_cli_success_is_not_caught_as_a_failure(self):
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('hosted-consumer.py')), '--help'], capture_output=True)
        self.assertEqual(result.returncode, 0)


class ActualBackendContractTests(unittest.TestCase):
    def observed(self, variant='ok'):
        unit = load()
        network = {'id': 'd' * 64, 'name': 'synthetic-network', 'labels': {'sim.track': 'track3'}}
        plan = {'projectId': 't3-synthetic', 'environmentId': 't3-synthetic-environment', 'nodeBin': '/synthetic/node',
                '_host': {'socket': '/synthetic/docker.sock'}, '_network': network, 'ports': {'db': 54322, 'api': 54321}}
        containers = []
        for index, (service, inner, port) in enumerate([('db', '5432/tcp', '54322'), ('kong', '8000/tcp', '54321'), ('storage', '5000/tcp', '54329')]):
            label = 'foreign' if variant == 'foreign-project' and service == 'db' else plan['projectId']
            containers.append({'Id': str(index + 1) * 64, 'Name': '/supabase_' + service + '_' + plan['projectId'], 'Image': 'sha256:' + 'e' * 64, 'Created': 'FINITE_BIRTH_' + str(index),
                'State': {'Running': True}, 'Config': {'Labels': {'com.supabase.cli.project': label}, 'Image': 'synthetic/official-provider:locked-test'},
                'NetworkSettings': {'Ports': {inner: [{'HostIp': '0.0.0.0' if variant == 'public-binding' and service == 'kong' else '127.0.0.1', 'HostPort': port}]},
                    'Networks': {network['name']: {'NetworkID': 'f' * 64 if variant == 'wrong-network' else network['id']}}}})
        def capture(argv, **_):
            if argv[0] == 'psql':
                return json.dumps({'major': 16 if variant == 'wrong-major' else 17, 'database': 'postgres', 'systemIdentifier': '123456789'})
            if 'network' in argv:
                return json.dumps([{'Id': network['id'], 'Name': network['name'], 'Labels': network['labels'], 'Driver': 'bridge',
                    'Scope': 'local', 'Options': {'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1'}, 'Containers': {}}])
            if 'image' in argv:
                return json.dumps([{'Id': 'sha256:' + 'e' * 64, 'RepoDigests': ['synthetic/official-provider@sha256:' + 'e' * 64], 'Architecture': 'amd64', 'Os': 'linux'}])
            if 'ls' in argv:
                return '\n'.join(c['Id'] for c in containers)
            if argv[-1].startswith('supabase_'):
                return json.dumps([c for c in containers if c['Name'] == '/' + argv[-1]])
            return json.dumps(containers)
        prepare = SimpleNamespace(capture=capture, phase_environment=lambda *_: {},
            owned_backend_capacity=lambda host, project, births: {'state':'VERIFIED','containers':births})
        return unit.inspect_backend(prepare, plan)

    def test_actual_classified_containers_pg_identity_and_image_observations_bind_receipt(self):
        backend, api, storage, resources = self.observed()
        self.assertEqual(backend['systemIdentifier'], '123456789')
        self.assertEqual(backend['containerId'], '1' * 64)
        self.assertEqual([api, storage], ['2' * 64, '3' * 64])
        self.assertEqual(len(resources['containers']), 3)

    def test_reachable_url_or_shape_does_not_substitute_for_real_loopback_project_pg_and_network(self):
        for variant in ['public-binding', 'foreign-project', 'wrong-major', 'wrong-network']:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.observed(variant)


class ControlledUnderlayTests(unittest.TestCase):
    def test_frozen_order_and_matrix_are_separate_from_physical_pilot_and_whole_suite(self):
        unit = load()
        execution = {'purpose': 'controlled_issuer_underlay', 'scenarioFile': 'scenarios/issuer-underlay.test.ts',
                     'expectedTestNames': list(unit.UNDERLAY_NAMES), 'evidenceMatrix': deepcopy(unit.UNDERLAY_MATRIX)}
        item = {'scenario': 'issuer-underlay', 'file': execution['scenarioFile'], 'exit': 0, 'harnessError': None,
            'vitest': {'success': True, 'numTotalTests': 10, 'numPassedTests': 10, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0},
            'identity': {'assignmentSha256': 'a' * 64}, 'evidenceManifest': '/synthetic/evidence/MANIFEST.sha256',
            'observations': {'evidenceMatrix': execution['evidenceMatrix']},
            'steps': [{'name': name, 'status': 'passed'} for name in execution['expectedTestNames']]}
        report = {'exit': 0, 'scenarios': [item]}
        result = unit.validate_underlay(report, 'a' * 64, execution)
        self.assertEqual(result['issuerAuthorityAcceptance'], 'NOT_CLAIMED')
        self.assertEqual(result['wholeSuiteAcceptance'], 'NOT_CLAIMED')
        bad = []
        changed = deepcopy(report); changed['scenarios'][0]['steps'].reverse(); bad.append(changed)
        changed = deepcopy(report); changed['scenarios'][0]['steps'].pop(); bad.append(changed)
        changed = deepcopy(report); changed['scenarios'][0]['observations']['evidenceMatrix'] = {}; bad.append(changed)
        changed = deepcopy(report); changed['scenarios'][0]['vitest']['numPendingTests'] = 1; bad.append(changed)
        changed = deepcopy(report); changed['scenarios'][0]['file'] = 'scenarios/ediel03-03.test.ts'; bad.append(changed)
        for changed in bad:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                unit.validate_underlay(changed, 'a' * 64, execution)
        with self.assertRaises(ValueError):
            unit.validate_underlay(report, 'a' * 64, dict(execution, purpose='ediel03_physical'))


class ActorFoundationTests(unittest.TestCase):
    def test_existing_actor_or_company_cannot_be_adopted_and_no_auth_create_occurs(self):
        unit = load()
        packet = SimpleNamespace(home=Path('/synthetic/private'), env={'T3_DB_URL': 'synthetic-local-db'})
        for observation in [{'actors': 1, 'companies': 0}, {'actors': 0, 'companies': 1}, {'actors': False, 'companies': 0}]:
            prepare = SimpleNamespace(capture=lambda *_: json.dumps(observation), save=lambda *_: self.fail('must not write successful fresh receipt'))
            with self.subTest(observation=observation), self.assertRaises(ValueError):
                unit.assert_fresh_fixture(packet, prepare)

    def test_actual_auth_readback_must_agree_with_fixture_before_generic_profile_membership_evidence(self):
        unit = load()
        actor, company = '12345678-1234-4234-8234-123456789abc', '12345678-1234-4234-8234-123456789abd'
        packet = SimpleNamespace(home=Path('/synthetic/private'), fresh=lambda: None)
        saved = []
        fixture = {'actorUserId': actor, 'companyId': company}
        values = {'EDIEL_AUTOMATION_ACTOR_USER_ID': actor, 'SUPABASE_URL': 'http://127.0.0.1:54321',
                  'SUPABASE_SERVICE_ROLE_KEY': 'SYNTHETIC_FINITE_NOT_REAL_KEY', 'T3_DB_URL': 'synthetic-local-db'}
        prepare = SimpleNamespace(read_json=lambda path: fixture if path.name == 'fixture.json' else values,
            capture=lambda *_: json.dumps({'profile': True, 'membership': True}), save=lambda path, value: saved.append((path, value)))
        class Response:
            status = 200
            observed_actor = actor
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, *_): return json.dumps({'id': self.observed_actor, 'email': 't3sim-automation@t3.sim.invalid', 'created_at': '2026-11-01T00:00:00Z'}).encode()
        with patch.object(unit.urllib.request, 'build_opener', return_value=SimpleNamespace(open=lambda *_args, **_kwargs: Response())):
            unit.observe_fixture_actor(packet, prepare)
            self.assertEqual(saved[0][1]['actorUserId'], actor)
            self.assertNotIn('SYNTHETIC_FINITE_NOT_REAL_KEY', json.dumps(saved[0][1]))
            Response.observed_actor = company
            with self.assertRaises(ValueError):
                unit.observe_fixture_actor(packet, prepare)
            self.assertEqual(len(saved), 1)


class OwnedBackendParentTests(unittest.TestCase):
    def test_actual_complete_backend_inspect_must_qualify_parent_before_return(self):
        unit=load();project='t3-finite-only';network={'id':'f'*64,'name':'finite-owned-network','labels':{}}
        containers=[]
        for index,service in enumerate(['db','kong','storage'],1):
            containers.append({'Id':str(index)*64,'Name':'/supabase_'+service+'_'+project,'Created':'FINITE_ORIGINAL_BIRTH_'+str(index),
                'Image':'sha256:finite','Config':{'Labels':{'com.supabase.cli.project':project},'Image':'finite-image'},
                'State':{'Running':True},'NetworkSettings':{'Ports':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'54322'}],
                    '8000/tcp':[{'HostIp':'127.0.0.1','HostPort':'54321'}]},'Networks':{network['name']:{'NetworkID':network['id']}}}})
        plan={'projectId':project,'environmentId':'t3-finite-only','nodeBin':'/finite/node','ports':{'db':54322,'api':54321},'_host':{'socket':'/finite/docker.sock'},'_network':network}
        def capture(argv,**_):
            if argv[0]=='psql':return json.dumps({'major':17,'database':'postgres','systemIdentifier':'123456'})
            if 'network' in argv:return json.dumps([{}])
            if 'container' in argv and 'ls' in argv:return '\n'.join(c['Id'] for c in containers)
            if 'image' in argv:return json.dumps([{'Id':'sha256:finite','Architecture':'amd64','Os':'linux'}])
            if argv[-1].startswith('supabase_'):return json.dumps([next(c for c in containers if c['Name']=='/'+argv[-1])])
            return json.dumps(containers)
        calls=[]
        def qualify(host,requested_project,actual):
            calls.append((host,requested_project,actual))
            raise ValueError('backend_parent_below_floor')
        prepare=SimpleNamespace(phase_environment=lambda *_:{},capture=capture,owned_backend_capacity=qualify)
        with patch.object(unit,'load',return_value=SimpleNamespace(network_binding=lambda *_:None)),self.assertRaises(ValueError):
            unit.inspect_backend(prepare,plan)
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][1],project)
        self.assertEqual(calls[0][2],[{'id':c['Id'],'name':c['Name'],'created':c['Created']} for c in containers])



if __name__ == '__main__':
    unittest.main()
